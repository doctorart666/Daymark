import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {messages,translate} from '../lib/translations.mjs';
for(const [key,values] of Object.entries(messages))for(const language of ['en','de']){
  assert.ok(values[language],`${language}: ${key}`);
  assert.deepEqual([...values[language].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort());
}
for(const file of ['app/workspace.tsx','app/workspace-access.tsx','app/login/login.tsx','app/language-provider.tsx','app/telegram-setup/instructions.tsx']){
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function visit(node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='t'&&ts.isStringLiteral(node.arguments[0]))assert.ok(messages[node.arguments[0].text],`${file}: missing ${node.arguments[0].text}`);ts.forEachChild(node,visit);}visit(source);
}
console.log('Complete English/German dictionaries and interpolation verified.');
const base=process.env.FOCUS_TEST_BASE_URL,secret=process.env.FOCUS_TEST_SERVICE_SECRET;
if(!base)process.exit(0);
if(!secret||new URL(base).port==='5173'||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Use an isolated local test server.');
function client(initial={}){
 const cookies=new Map(Object.entries(initial));
 return {cookies,async call(path,data,options={}){
  const res=await fetch(base+path,{method:data===undefined?'GET':'POST',redirect:'manual',headers:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...(data===undefined?{}:{Origin:options.origin??base,'Content-Type':'application/json'}),...options.headers},body:data===undefined?undefined:JSON.stringify(data)});
  for(const value of res.headers.getSetCookie()){const [key,...rest]=value.split(';')[0].split('=');const val=rest.join('=');if(val)cookies.set(key,val);else cookies.delete(key);}
  const text=await res.text();let body;try{body=JSON.parse(text);}catch{body=text;}
  return {res,body};
 }};
}
const browser=client(),bridge=client();
const service=async(action,args={})=>(await bridge.call('/api/service',{action,...args},{headers:{Authorization:`Bearer ${secret}`}})).body;
await service('heartbeat',{username:'daymark_test_bot'});
assert.equal((await browser.call('/api/language',{language:'fr'})).res.status,400);
assert.equal((await browser.call('/api/language',{language:'de'},{origin:'https://evil.invalid'})).res.status,403);
assert.equal(browser.cookies.size,0);
assert.equal((await browser.call('/api/language',{language:'de'})).res.status,200);
let page=await browser.call('/login');assert.ok(page.body.includes('lang="de"'));assert.ok(page.body.includes('Mit Telegram anmelden'));assert.ok(page.body.includes('Daymark'));
async function signIn(c,id){const link=(await c.call('/api/telegram',{action:'start'})).body;const confirmation=await service('confirm',{code:new URL(link.url).searchParams.get('start'),chatId:id,name:'Language QA'});assert.equal(confirmation.ok,true);assert.equal((await c.call('/api/telegram',{action:'complete'})).body.confirmed,true);return confirmation;}
assert.equal((await signIn(browser,'900000000000010')).message,translate('de','✅ Вхід підтверджено. Поверніться на сайт.'));
let workspace=(await browser.call('/api/workspace')).body;assert.equal(workspace.preferences.language,'de');assert.ok(!browser.cookies.has('daymark_language_choice'));
for(const language of ['en','uk','de']){
 assert.equal((await browser.call('/api/language',{language})).res.status,200);
 assert.equal((await browser.call('/api/workspace')).body.preferences.language,language);
 const validation=await browser.call('/api/entries',{});assert.equal(validation.res.status,400);assert.equal(validation.body.error,translate(language,'Перевірте назву, вміст і дні повторення завдання.'));
 for(const [path,title] of [['/tasks','Завдання'],['/notes','Нотатки'],['/learn','Навчання'],['/settings','Налаштування'],['/telegram-setup','Підключення Telegram']]){
  page=await browser.call(path);assert.equal(page.res.status,200);assert.ok(page.body.includes(`lang="${language}"`));assert.ok(page.body.includes(translate(language,title)),path+': '+language);
 }
 const entry=(await browser.call('/api/entries',{kind:'task',title:'Оригінальний текст',topic:'Deutsch / English',blocks:[{id:crypto.randomUUID(),type:'code',content:'const мова = "Українська";',language:'javascript'}],status:'todo',priority:'normal',dueAt:new Date(Date.now()+10*60000).toISOString()})).body;
 const jobs=(await service('tick')).jobs;assert.equal(jobs.length,1);assert.ok(jobs[0].message.includes(translate(language,'⏰ Наближається дедлайн')));assert.ok(jobs[0].message.includes('Оригінальний текст'));await service('ack',{id:jobs[0].id,status:'sent'});
 const saved=(await browser.call('/api/workspace')).body.entries.find(x=>x.id===entry.id);assert.equal(saved.blocks[0].content,'const мова = "Українська";');
 // DELETE is tested in check-api; marking complete here keeps reminder fixtures inactive.
 await browser.call('/api/entries',{...entry,status:'done'});
}
await browser.call('/api/language',{language:'en'});
// A new device gets its language from the account, even with an old browser cookie.
const newDevice=client({focus_session:browser.cookies.get('focus_session'),daymark_language:'uk'});
page=await newDevice.call('/tasks');assert.ok(page.body.includes('lang="en"'));assert.ok(page.body.includes('Tasks'));
await browser.call('/api/preferences',{...workspace.preferences,language:'uk',morningEnabled:false});assert.equal((await browser.call('/api/workspace')).body.preferences.language,'en','Other settings must not overwrite the language.');
await browser.call('/api/telegram',{action:'logout'});assert.ok((await browser.call('/login')).body.includes('Sign in with Telegram'));
const freshBrowser=client();await signIn(freshBrowser,'900000000000010');assert.equal((await freshBrowser.call('/api/workspace')).body.preferences.language,'en','Signing in elsewhere keeps account language.');
await freshBrowser.call('/api/telegram',{action:'logout'});await freshBrowser.call('/api/language',{language:'uk'});await signIn(freshBrowser,'900000000000010');assert.equal((await freshBrowser.call('/api/workspace')).body.preferences.language,'uk','Explicit language choice before sign-in takes effect.');
await freshBrowser.call('/api/telegram',{action:'logout'});
console.log('Language API passed: all routes, anonymous choice, authenticated persistence, cross-device sign-in, logout, origin protection, validation and Telegram reminders; user text/code preserved.');
