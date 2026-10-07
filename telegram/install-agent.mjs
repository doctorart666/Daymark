import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
if(process.platform!=='darwin')throw new Error('This installer supports macOS. Use systemd or an equivalent supervisor on a server.');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const label='com.focus.tasks-notes.telegram';
const agent=resolve(homedir(),'Library','LaunchAgents',label+'.plist');
const state=resolve(root,'.telegram-state');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
await mkdir(dirname(agent),{recursive:true});await mkdir(state,{recursive:true,mode:0o700});
const plist=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>--env-file=${escape(resolve(root,'telegram/.env'))}</string><string>${escape(resolve(root,'telegram/service.mjs'))}</string></array>\n<key>WorkingDirectory</key><string>${escape(root)}</string>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>ThrottleInterval</key><integer>30</integer>\n<key>StandardOutPath</key><string>${escape(resolve(state,'service.log'))}</string>\n<key>StandardErrorPath</key><string>${escape(resolve(state,'service-error.log'))}</string>\n</dict></plist>\n`;
await writeFile(agent,plist,{mode:0o600});
const domain=`gui/${process.getuid()}`;
const existing=spawnSync('/bin/launchctl',['print',`${domain}/${label}`],{encoding:'utf8'});
if(existing.status===0){console.log(JSON.stringify({installed:true,alreadyRunning:true,label,agent}));}else{const result=spawnSync('/bin/launchctl',['bootstrap',domain,agent],{encoding:'utf8'});if(result.status!==0)throw new Error('launchctl bootstrap failed: '+result.stderr.trim());console.log(JSON.stringify({installed:true,label,agent}));}
