import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Real route handlers and SQL, isolated from local data and Telegram.
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
const state={cookies:new Map(),beforeQuery:null};
const database={prepare(query){
  const execute=(args=[])=>({
    async all(){state.beforeQuery?.(query);return {results:sql.prepare(query).all(...args)};},
    async first(){state.beforeQuery?.(query);return sql.prepare(query).get(...args)??null;},
    async run(){state.beforeQuery?.(query);const statement=sql.prepare(query);const rows=statement.columns().length?statement.all(...args):[];if(!statement.columns().length)statement.run(...args);return {results:rows,success:true,meta:{changes:sql.prepare('SELECT changes() AS n').get().n}};}
  });return {...execute(),bind(...args){return execute(args);}};
},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__workspaceQA={database,state};
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const external={
 'cloudflare:workers':dataUrl('export const env={DB:globalThis.__workspaceQA.database,TELEGRAM_SERVICE_SECRET:"workspace-test-secret"};'),
 'next/headers':dataUrl('export async function cookies(){const c=globalThis.__workspaceQA.state.cookies;return {get:key=>c.has(key)?{value:c.get(key)}:undefined,set:(key,value)=>c.set(key,value),delete:key=>c.delete(key)};}'),
 'next/navigation':dataUrl('export function redirect(path){throw Object.assign(new Error("Redirect"),{path});}'),
 'zod':import.meta.resolve('zod')
};
const compiled=new Map();
function moduleUrl(file){
 file=resolve(file);if(compiled.has(file))return compiled.get(file);
 let source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replaceAll('import.meta.env.DEV','true');
 source=source.replace(/(from\s+|import\s+)(['"])([^'"]+)\2/g,(all,prefix,quote,name)=>{
   if(external[name])return prefix+JSON.stringify(external[name]);
   if(name.endsWith('.mjs'))return prefix+JSON.stringify(pathToFileURL(resolve(dirname(file),name)).href);
   if(name.startsWith('./')||name.startsWith('../')||name.startsWith('@/')){
     const target=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(file),name);
     return prefix+JSON.stringify(moduleUrl(target+'.ts'));
   }
   throw Error('Unmapped test import: '+name);
 });
 const url=dataUrl(source);compiled.set(file,url);return url;
}
try{
 const server=await import(moduleUrl('lib/server.ts'));
 const entries=await import(moduleUrl('app/api/entries/route.ts'));
 const workspaces=await import(moduleUrl('app/api/workspaces/route.ts'));
 const workspace=await import(moduleUrl('app/api/workspace/route.ts'));
 const service=await import(moduleUrl('app/api/service/route.ts'));
 const auth=await import(moduleUrl('app/api/telegram/route.ts'));
 const {tickReminders}=await import(moduleUrl('lib/reminder-service.ts'));
 const root='http://127.0.0.1:5999';
 const sessions=new Map();
 async function account(chatId,name,language='en',timezone='Europe/Berlin'){
   const user='telegram:'+chatId,token=crypto.randomUUID();
   sql.prepare('INSERT INTO preferences(owner,telegram_id,telegram_name,language,timezone,morning_enabled) VALUES(?,?,?,?,?,0) ON CONFLICT(owner) DO NOTHING').run(user,chatId,name,language,timezone);
   sql.prepare('INSERT INTO sessions(hash,owner,expires_at) VALUES(?,?,?)').run(await server.hash(token),user,Date.now()+86400000);
   sessions.set(user,token);return user;
 }
 function use(user){state.cookies.clear();if(user)state.cookies.set(server.SESSION_COOKIE,sessions.get(user));}
 async function call(route,method,path,body,headers={}){
   const response=await route[method](new Request(root+path,{method,headers:{Origin:root,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}));
   return {status:response.status,body:await response.json()};
 }
 const wsGet=id=>call(workspace,'GET','/api/workspace'+(id?'?workspace='+id:''));
 const manage=body=>call(workspaces,'POST','/api/workspaces',body);
 const bridge=body=>call(service,'POST','/api/service',body,{Authorization:'Bearer workspace-test-secret'});
 const input=(patch={})=>({kind:'task',title:'Shared task',topic:'JS',blocks:[{id:crypto.randomUUID(),type:'code',content:'console.log("unchanged");',language:'javascript'}],status:'todo',priority:'normal',dueAt:null,...patch});
 const save=body=>call(entries,'POST','/api/entries',body);
 const deleteRecord=body=>call(entries,'DELETE','/api/entries',body);
 const owner=await account('101','Owner'),outsider=await account('303','Other');
 use(null);assert.equal((await manage({action:'create',name:'No access'})).status,401);
 assert.equal((await wsGet()).status,401);
 use(owner);
 assert.equal((await call(workspaces,'POST','/api/workspaces',{action:'create',name:'CSRF'},{Origin:'https://evil.invalid'})).status,403);
 assert.equal((await manage({action:'create',name:'  '})).status,400);
 const personal=(await save(input({title:'Private owner task'}))).body;
 const created=await manage({action:'create',name:'  Team Alpha  ',owner:outsider});assert.equal(created.status,200);
 const id=created.body.id;assert.equal(created.body.name,'Team Alpha');assert.equal(created.body.timezone,'Europe/Berlin');
 assert.equal(sql.prepare('SELECT owner FROM workspaces WHERE id=?').get(id).owner,owner);
 assert.equal((await wsGet(id)).body.entries.length,0);
 assert.equal((await wsGet()).body.entries.length,1);
 const task=(await save(input({workspaceId:id}))).body;
 assert.ok(task.id);assert.equal(task.blocks[0].content,'console.log("unchanged");');
 assert.equal((await wsGet(id)).body.entries[0].id,task.id);
 assert.equal((await wsGet()).body.entries[0].id,personal.id);
 use(outsider);
 assert.equal((await wsGet(id)).status,403);
 assert.equal((await save(input({workspaceId:id}))).status,403);
 assert.equal((await save({...task,workspaceId:id,title:'Intrusion'})).status,403);
 assert.equal((await deleteRecord({id:task.id,workspaceId:id})).status,403);
 assert.equal((await manage({action:'invite',workspaceId:id})).status,400,'Offline bot gives a clear error.');
 sql.prepare("INSERT INTO service_state(id,username,heartbeat) VALUES('telegram','daymark_test_bot',?)").run(Date.now());
 assert.equal((await manage({action:'invite',workspaceId:id})).status,403);
 use(owner);
 async function newInvite(workspaceId=id){const result=await manage({action:'invite',workspaceId});assert.equal(result.status,200);const payload=new URL(result.body.url).searchParams.get('start');assert.ok(/^ws_[a-f0-9]{48}$/.test(payload));assert.ok(payload.length<=64);return {...result.body,code:payload.slice(3)};}
 const invite=await newInvite();
 const stored=sql.prepare('SELECT * FROM workspace_invites WHERE id=?').get(invite.id);assert.equal(stored.hash,await server.hash(invite.code));assert.ok(!Object.values(stored).includes(invite.code));
 const memberChat='202',join={action:'joinWorkspace',code:invite.code,chatId:memberChat,name:'Member',language:'de'};
 assert.equal((await call(service,'POST','/api/service',join,{Authorization:'Bearer fake'})).status,403);
 use(null);
 const joined=await bridge(join);assert.equal(joined.body.ok,true);assert.equal(joined.body.path,'/tasks?workspace='+id);assert.ok(joined.body.message.includes('Zugriff'));assert.ok(!state.cookies.has(server.SESSION_COOKIE),'An invitation never creates an unbound browser session.');
 assert.equal((await bridge(join)).body.ok,false,'One-time invitation cannot replay.');
 assert.equal((await bridge({...join,chatId:'404'})).body.ok,false,'Second recipient cannot use consumed link.');
 assert.equal(sql.prepare('SELECT count(*) AS n FROM preferences WHERE telegram_id=\'404\'').get().n,0);
 const member=await account(memberChat,'Member','de','Europe/Kyiv');
 use(member);
 let snapshot=(await wsGet(id)).body;assert.equal(snapshot.entries.length,1);assert.equal(snapshot.activeWorkspace.timezone,'Europe/Berlin');assert.equal(snapshot.preferences.timezone,'Europe/Berlin','Invite account starts with default timezone.');
 sql.prepare('UPDATE preferences SET timezone=\'Europe/Kyiv\' WHERE owner=?').run(member);
 snapshot=(await wsGet(id)).body;assert.equal(snapshot.activeWorkspace.timezone,'Europe/Berlin');assert.equal(snapshot.preferences.timezone,'Europe/Kyiv');
 assert.equal(snapshot.activeWorkspace.role,'editor');assert.equal((await wsGet()).body.entries.length,0);
 assert.equal((await manage({action:'invite',workspaceId:id})).status,403);
 assert.equal((await manage({action:'removeMember',workspaceId:id,userId:owner})).status,403);
 assert.equal((await manage({action:'revokeInvite',workspaceId:id,inviteId:invite.id})).status,403);
 assert.equal((await call(workspaces,'GET','/api/workspaces?workspace='+id)).body.members.length,0,'Only owner can list participants.');
 const edited=(await save({...task,workspaceId:id,title:'Edited by member',status:'done'})).body;assert.equal(edited.title,'Edited by member');
 assert.equal((await deleteRecord({id:task.id,workspaceId:id})).status,403,'Editor cannot delete whole records.');
 const note=(await save(input({workspaceId:id,kind:'note',title:'Shared note'}))).body;assert.ok(note.id);
 const topic=(await save(input({workspaceId:id,kind:'topic',title:'Shared learning'}))).body;assert.ok(topic.id);
 assert.equal((await save({...personal,workspaceId:id,title:'Cross-scope modification'})).status,400);
 assert.equal((await save({...task,workspaceId:null,title:'Cross-scope modification'})).status,400);
 const memberPrivate=(await save(input({title:'Private member task'}))).body;
 use(owner);assert.equal((await wsGet()).body.entries.length,1);
 snapshot=(await wsGet(id)).body;assert.equal(snapshot.entries.length,3);assert.ok(snapshot.entries.some(e=>e.title==='Edited by member'));
 const access=(await call(workspaces,'GET','/api/workspaces?workspace='+id)).body;assert.equal(access.members.length,2);assert.equal(access.members.find(m=>m.userId===owner).role,'owner');
 assert.equal((await manage({action:'removeMember',workspaceId:id,userId:owner})).status,403,'Owner cannot remove themselves.');
 const revoked=await newInvite();await manage({action:'revokeInvite',workspaceId:id,inviteId:revoked.id});assert.equal((await bridge({...join,code:revoked.code})).body.ok,false);
 const expired=await newInvite();sql.prepare('UPDATE workspace_invites SET expires_at=? WHERE id=?').run(Date.now()-1,expired.id);assert.equal((await bridge({...join,code:expired.code})).body.ok,false);
 // A deadline produces exactly one reminder per current member, with translated text.
 const deadline=new Date(Date.now()+20*60000);
 const upcoming=(await save({...edited,workspaceId:id,status:'todo',dueAt:deadline.toISOString()})).body;
 let jobs=(await tickReminders(new Date())).jobs;assert.equal(jobs.length,2);assert.deepEqual(jobs.map(j=>j.chat_id).sort(),['101','202']);assert.ok(jobs.every(j=>j.message.includes('[Team Alpha]')));
 for(const job of jobs)sql.prepare('UPDATE outbox SET status=\'sent\' WHERE id=?').run(job.id);
 assert.equal((await tickReminders(new Date())).jobs.length,0,'Per-recipient deduplication.');
 // One morning message combines personal and shared tasks for each person.
 sql.prepare('UPDATE records SET due_at=? WHERE id IN (?,?)').run(new Date(Date.now()+2*86400000).toISOString(),personal.id,memberPrivate.id);
 sql.prepare('UPDATE preferences SET morning_enabled=1,morning_time=?,deadline_enabled=0,timezone=\'Europe/Berlin\'').run(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()));
 jobs=(await tickReminders(new Date())).jobs;assert.equal(jobs.length,2,'One morning summary for each user.');assert.ok(jobs.every(j=>j.id.startsWith('morning:')));
 assert.ok(jobs.find(j=>j.chat_id==='101').message.includes('Private owner task'));assert.ok(jobs.find(j=>j.chat_id==='101').message.includes('[Team Alpha]'));
 for(const job of jobs)sql.prepare('UPDATE outbox SET status=\'sent\' WHERE id=?').run(job.id);
 assert.equal((await tickReminders(new Date())).jobs.length,0);
 // Removing a person cancels both deadline messages and combined morning summaries.
 const stamp=new Date().toISOString();
 sql.prepare(`INSERT INTO outbox(id,owner,chat_id,message,status,created_at,updated_at,workspace_id) VALUES('queued-shared',?,'202','shared','pending',?,?,?)`).run(member,stamp,stamp,id);
 sql.prepare(`INSERT INTO outbox(id,owner,chat_id,message,status,created_at,updated_at,workspace_ids) VALUES('queued-morning',?,'202','morning','pending',?,?,?)`).run(member,stamp,stamp,JSON.stringify([id]));
 sql.prepare(`INSERT INTO outbox(id,owner,chat_id,message,status,created_at,updated_at,workspace_id) VALUES('claimed-shared',?,'202','claimed','sending',?,?,?)`).run(member,stamp,stamp,id);
 sql.prepare(`INSERT INTO outbox(id,owner,chat_id,message,status,created_at,updated_at,workspace_ids) VALUES('claimed-morning',?,'202','claimed morning','sending',?,?,?)`).run(member,stamp,stamp,JSON.stringify([id]));
 assert.equal((await bridge({action:'delivery',id:'claimed-morning'})).body.ok,true);
 assert.equal((await bridge({action:'delivery',id:'claimed-shared'})).body.ok,true);
 assert.equal((await manage({action:'removeMember',workspaceId:id,userId:member})).status,200);
 assert.equal((await bridge({action:'delivery',id:'claimed-shared'})).body.ok,false,'A claimed job must recheck membership before delivery.');
 assert.equal(sql.prepare("SELECT status FROM outbox WHERE id='claimed-shared'").get().status,'cancelled');
 assert.equal((await bridge({action:'delivery',id:'claimed-morning'})).body.ok,false);
 assert.equal(sql.prepare("SELECT status FROM outbox WHERE id='claimed-morning'").get().status,'cancelled');
 assert.equal(sql.prepare("SELECT status FROM outbox WHERE id='queued-shared'").get().status,'cancelled');assert.equal(sql.prepare("SELECT status FROM outbox WHERE id='queued-morning'").get().status,'cancelled');
 assert.equal((await bridge(join)).body.ok,false,'Used invitation cannot restore revoked access.');
 use(member);
 assert.equal((await wsGet(id)).status,403);assert.equal((await save({...upcoming,workspaceId:id,title:'After removal'})).status,403);
 assert.equal((await save(input({workspaceId:id}))).status,403);assert.equal((await deleteRecord({id:task.id,workspaceId:id})).status,403);
 assert.equal((await wsGet()).body.entries[0].id,memberPrivate.id,'Personal data and session survive removal.');assert.equal((await wsGet()).body.workspaces.length,0);
 use(owner);
 assert.equal((await wsGet(id)).body.entries.length,3,'Records created by removed member remain in workspace.');
 const fresh=await newInvite();assert.equal((await bridge({...join,code:fresh.code})).body.ok,true,'Owner can invite someone again with a new link.');
 // A concurrent revoke between authorization and the INSERT must still block the write.
 use(member);let injected=false;
 state.beforeQuery=query=>{if(!injected&&query.startsWith('INSERT INTO records')){injected=true;sql.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(id,member);}};
 const race=await save(input({workspaceId:id,title:'Should not be stored'}));state.beforeQuery=null;assert.ok(race.status>=400);assert.equal(sql.prepare("SELECT count(*) AS n FROM records WHERE title='Should not be stored'").get().n,0);
 // Refreshing revoked pending messages cannot leak shared content to the old recipient.
 sql.prepare('UPDATE preferences SET morning_enabled=0,deadline_enabled=1').run();
 sql.prepare('UPDATE records SET due_at=?,status=\'todo\',reminder_version=reminder_version+1 WHERE id=?').run(new Date(Date.now()+10*60000).toISOString(),task.id);
 jobs=(await tickReminders(new Date())).jobs;assert.equal(jobs.length,1);assert.equal(jobs[0].chat_id,'101');
 use(owner);assert.equal((await deleteRecord({id:note.id,workspaceId:id})).status,200);
 // Invited users still use the existing browser-bound Telegram sign-in flow.
 use(null);const start=await call(auth,'POST','/api/telegram',{action:'start'});const code=new URL(start.body.url).searchParams.get('start');
 assert.equal((await bridge({action:'confirm',code,chatId:memberChat,name:'Member',language:'de'})).body.ok,true);
 assert.equal((await call(auth,'POST','/api/telegram',{action:'complete'})).body.confirmed,true);
 assert.equal((await wsGet()).status,200);assert.equal(server.safeReturnTo('/tasks?workspace='+id),'/tasks?workspace='+id);
 console.log('Shared-workspace integration passed: authentication/origin protection, ownership, isolated personal/shared records, invite acceptance/expiry/revocation/replay, editor CRUD permissions, removal/re-invitation, concurrent revocation, shared timezones, per-recipient reminders and one combined morning summary.');
}finally{sql.close();delete globalThis.__workspaceQA;}
