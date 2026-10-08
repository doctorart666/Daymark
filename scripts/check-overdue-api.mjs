import assert from 'node:assert/strict';
const base=process.env.FOCUS_TEST_BASE_URL,secret=process.env.FOCUS_TEST_SERVICE_SECRET;
if(!base||!secret||new URL(base).port==='5173'||!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Use an isolated local test database.');
const cookies=new Map();
async function call(path,data,method=data===undefined?'GET':'POST'){
 const res=await fetch(base+path,{method,headers:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...(data===undefined?{}:{'Content-Type':'application/json',Origin:base})},body:data===undefined?undefined:JSON.stringify(data)});
 for(const value of res.headers.getSetCookie()){const [k,v]=value.split(';')[0].split('=');if(v)cookies.set(k,v);else cookies.delete(k);}
 const result=await res.json();assert.ok(res.ok,JSON.stringify(result));return result;
}
async function service(action,args={}){const r=await fetch(base+'/api/service',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({action,...args})});assert.ok(r.ok);return r.json();}
async function tick(){const jobs=(await service('tick')).jobs;for(const job of jobs)await service('ack',{id:job.id,status:'sent'});return jobs;}
await service('heartbeat',{username:'daymark_qa_bot'});
const link=await call('/api/telegram',{action:'start'});await service('confirm',{code:new URL(link.url).searchParams.get('start'),chatId:'900000000000030',name:'Overdue QA'});await call('/api/telegram',{action:'complete'});
let preferences=(await call('/api/workspace')).preferences;await call('/api/preferences',{...preferences,morningEnabled:false});
const fixture={kind:'task',title:'Expiry transition',topic:'',blocks:[{id:crypto.randomUUID(),type:'code',language:'javascript',content:'const deadline = true;'}],status:'progress',priority:'normal',dueAt:new Date(Date.now()+5000).toISOString(),repeat:null};
let entry=await call('/api/entries',fixture);assert.equal(entry.status,'progress');
let jobs=await tick();assert.equal(jobs.length,1);assert.ok(jobs[0].id.startsWith('deadline:'));
await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(entry.dueAt)-Date.now()+100)));
// Opening the workspace changes and saves the status even before a bot tick.
entry=(await call('/api/workspace')).entries.find(e=>e.id===entry.id);assert.equal(entry.status,'overdue');
jobs=await tick();assert.equal(jobs.length,1);assert.ok(jobs[0].id.startsWith('overdue:'));assert.ok(jobs[0].message.includes('Expiry transition'));assert.equal((await tick()).length,0);
entry=await call('/api/entries',{...entry,title:'Edited overdue task'});assert.equal(entry.status,'overdue');assert.equal((await tick()).length,0,'Editing text must not send another overdue message.');
entry=await call('/api/entries',{...entry,status:'done'});assert.equal(entry.status,'done');assert.equal((await tick()).length,0);
entry=await call('/api/entries',{...entry,status:'todo'});assert.equal(entry.status,'overdue');assert.equal((await tick()).length,0,'Reopening must not repeat the same notification.');
entry=await call('/api/entries',{...entry,dueAt:new Date(Date.now()+2*3600000).toISOString()});assert.equal(entry.status,'todo');assert.equal((await tick()).length,0);
entry=await call('/api/entries',{...entry,dueAt:new Date(Date.now()-1000).toISOString()});assert.equal(entry.status,'overdue');jobs=await tick();assert.equal(jobs.length,1);assert.ok(jobs[0].id.startsWith('overdue:'));assert.equal((await tick()).length,0);
entry=await call('/api/entries',{...entry,dueAt:null});assert.equal(entry.status,'todo');assert.equal((await tick()).length,0);
await call('/api/entries',{id:entry.id},'DELETE');
const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
entry=await call('/api/entries',{...fixture,id:undefined,title:'Daily overdue task',dueAt:null,repeat:{days:[1,2,3,4,5,6,7],time},status:'todo'});assert.equal(entry.status,'overdue');assert.equal(entry.statusDate,entry.occurrenceDate);
jobs=await tick();assert.equal(jobs.length,1);assert.ok(jobs[0].id.startsWith('overdue:'));assert.equal((await tick()).length,0);
entry=await call('/api/entries',{...entry,status:'done'});assert.equal(entry.status,'done');assert.equal((await tick()).length,0);
await call('/api/entries',{id:entry.id},'DELETE');
await call('/api/preferences',{...preferences,deadlineEnabled:false,morningEnabled:false});entry=await call('/api/entries',{...fixture,title:'Disabled messages',status:'todo',dueAt:new Date(Date.now()-1000).toISOString()});assert.equal(entry.status,'overdue');assert.equal((await tick()).length,0);
await call('/api/entries',{id:entry.id},'DELETE');await call('/api/telegram',{action:'logout'});
console.log('Overdue API passed: real expiry transition, persisted workspace status, single notification, edits/completion/reopening, changed deadline, cleared deadline, daily occurrence and disabled messages.');
