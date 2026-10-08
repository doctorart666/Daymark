import {BRAND,languageValue,translate} from '../lib/translations.mjs';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import {resolve} from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
const {TELEGRAM_BOT_TOKEN,SITE_URL,SITES_ACCESS_TOKEN,TELEGRAM_SERVICE_SECRET}=process.env;
if(!TELEGRAM_BOT_TOKEN||!SITE_URL||!TELEGRAM_SERVICE_SECRET)throw new Error('Set TELEGRAM_BOT_TOKEN, SITE_URL and TELEGRAM_SERVICE_SECRET in your private env file.');
const site=new URL(SITE_URL);
const local=['localhost','127.0.0.1','[::1]'].includes(site.hostname);
if(site.protocol!=='https:' && !local)throw new Error('HTTPS required.');
if(!local&&!SITES_ACCESS_TOKEN)throw new Error('Set SITES_ACCESS_TOKEN for the private hosted site.');
const shutdown=new AbortController();
let running=true;
function stop(){running=false;shutdown.abort();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
async function api(action,args={}){const res=await fetch(new URL('/api/service',site),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Authorization':`Bearer ${TELEGRAM_SERVICE_SECRET}`,...(!local?{'OAI-Sites-Authorization':`Bearer ${SITES_ACCESS_TOKEN}`}:{})},body:JSON.stringify({action,...args}),signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(30000)])});if(!res.ok)throw new Error(`Site returned ${res.status}`);return res.json();}
async function bot(method,args={}){const res=await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(35000)])});let data;try{data=await res.json();}catch{throw new Error('Telegram response uncertain');}if(!data.ok){const error=new Error(`Telegram error ${data.error_code}`);error.definitive=true;throw error;}return data.result;}
try {
const identity=await bot('getMe');const webhook=await bot('getWebhookInfo');if(webhook.url)throw new Error('This bot already uses a webhook. Use a dedicated bot or remove its webhook after checking the existing integration.');
const stateDir=resolve(process.env.TELEGRAM_STATE_DIR??'.telegram-state');mkdirSync(stateDir,{recursive:true,mode:0o700});const stateFile=resolve(stateDir,'offset.json');let offset=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')).offset:0;
function saveOffset(value){writeFileSync(stateFile+'.tmp',JSON.stringify({offset:value}),{mode:0o600});renameSync(stateFile+'.tmp',stateFile);offset=value;}
async function reminders(){while(running){try{await api('heartbeat',{username:identity.username});const {jobs}=await api('tick');for(const job of jobs){if(!running)break;let status='sent',error;try{await bot('sendMessage',{chat_id:job.chat_id,text:job.message});}catch(e){status=e.definitive?'failed':'unknown';error=e.message;}await api('ack',{id:job.id,status,error});}}catch{if(!running)break;console.error('Reminder service unavailable; retrying on next tick.');}await pause(15000,undefined,{signal:shutdown.signal}).catch(()=>{});}}
async function updates(){while(running){try{const batch=await bot('getUpdates',{offset,timeout:20,allowed_updates:['message']});for(const update of batch){if(!running)break;const message=update.message;if(message?.chat?.type==='private'&&message.from?.id===message.chat.id){const language=languageValue(message.from.language_code?.split('-')[0]);const match=/^\/start(?:@\w+)? ([a-f0-9]{48})$/.exec(message.text??'');if(match){const result=await api('confirm',{code:match[1],chatId:String(message.chat.id),name:message.from.first_name??message.from.username??'Telegram',language});await bot('sendMessage',{chat_id:message.chat.id,text:result.message??translate(language,'Відкрийте нове посилання на сайті.')});}else if(/^\/start/.test(message.text??'')){await bot('sendMessage',{chat_id:message.chat.id,text:BRAND+' · '+translate(language,'Щоб увійти, відкрийте сторінку входу Daymark, натисніть «Увійти через Telegram», потім «Відкрити Telegram» та «Start». Звичайна команда /start без посилання не підтверджує вхід.')});}}saveOffset(update.update_id+1);}}catch{if(!running)break;console.error('Bot polling unavailable; retrying.');await pause(5000,undefined,{signal:shutdown.signal}).catch(()=>{});}}}
console.log(`Telegram companion started for @${identity.username}.`);
await Promise.all([reminders(),updates()]);
} catch {
  if(!shutdown.signal.aborted){console.error('Не вдалося запустити Telegram. Перевірте налаштування бота та доступ до мережі.');process.exitCode=1;}
}
