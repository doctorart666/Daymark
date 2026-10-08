import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
try {
const sql=new DatabaseSync(':memory:');
for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8').replaceAll('--> statement-breakpoint',''));
// Execute the production domain, persistence and outbox code against SQLite.
// No Telegram credentials, network calls or changes to the user's database.
const database={prepare(query){
 const stmt=sql.prepare(query);
 const bound=(args=[])=>({async all(){return {results:stmt.all(...args)};},async first(){return stmt.get(...args)??null;},async run(){stmt.run(...args);return {success:true};}});
 return {...bound(),bind(...args){return bound(args);}};
},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__daymarkTestDatabase=database;
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=file=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const i18n=url(compile('lib/i18n.ts').replace("'./translations.mjs'",JSON.stringify(pathToFileURL(process.cwd()+'/lib/translations.mjs').href)));
const models=url(compile('lib/models.ts').replace("'./i18n'",JSON.stringify(i18n)));
const recurrence=url(compile('lib/recurrence.ts').replace("'./i18n'",JSON.stringify(i18n)).replace("'./models'",JSON.stringify(models)));
const reminders=url(compile('lib/reminders.ts').replace("'./i18n'",JSON.stringify(i18n)).replace("'./models'",JSON.stringify(models)).replace("'./recurrence'",JSON.stringify(recurrence)));
const cloudflare=url('export const env={DB:globalThis.__daymarkTestDatabase};');
const headers=url('export async function cookies(){throw Error("Test does not use browser authentication");}');
const navigation=url('export function redirect(){throw Error("Test does not redirect");}');
let serverSource=compile('lib/server.ts');
for(const [name,reference] of Object.entries({'cloudflare:workers':cloudflare,'next/headers':headers,'next/navigation':navigation,'./models':models,'./recurrence':recurrence,'./reminders':reminders,'./i18n':i18n}))serverSource=serverSource.replace(`'${name}'`,JSON.stringify(reference));
const server=url(serverSource);
let serviceSource=compile('lib/reminder-service.ts');
for(const [name,reference] of Object.entries({'./server':server,'./models':models,'./recurrence':recurrence,'./reminders':reminders,'./i18n':i18n}))serviceSource=serviceSource.replace(`'${name}'`,JSON.stringify(reference));
const {tickReminders}=await import(url(serviceSource));
const {syncTaskStatuses}=await import(server);
const {projectEntry}=await import(recurrence);
const {entryFromRow}=await import(server);
const owner='telegram:test',tz='Europe/Berlin';
const fixed=new Date('2026-10-07T06:30:00Z');
function reset(language='uk'){sql.exec('DELETE FROM records; DELETE FROM outbox; DELETE FROM preferences;');sql.prepare('INSERT INTO preferences(owner,telegram_id,language,morning_enabled,deadline_enabled) VALUES(?,?,?,0,1)').run(owner,'123',language);}
function insert({id='task',status='todo',due='2026-10-07T06:30:00.000Z',repeat=null,statusDate=null,created='2026-10-01T00:00:00.000Z'}={}){
 sql.prepare(`INSERT INTO records(id,owner,kind,title,status,due_at,repeat_days,repeat_time,status_date,created_at,updated_at) VALUES(?,?,'task',?,?,?,?,?,?,?,?)`).run(id,owner,'Unchanged title',status,repeat?null:due,repeat?JSON.stringify(repeat.days):null,repeat?.time??null,statusDate,created,created);
}
const row=(id='task')=>sql.prepare('SELECT * FROM records WHERE id = ?').get(id);
const ack=jobs=>{for(const job of jobs)sql.prepare("UPDATE outbox SET status='sent' WHERE id=?").run(job.id);};
reset();insert({status:'progress'});
let jobs=(await tickReminders(new Date(fixed.getTime()-1))).jobs;assert.equal(jobs.length,1);assert.ok(jobs[0].id.startsWith('deadline:'));ack(jobs);
assert.equal(row().status,'progress');
jobs=(await tickReminders(fixed)).jobs;assert.equal(jobs.length,1);assert.ok(jobs[0].id.startsWith('overdue:'));assert.ok(jobs[0].message.includes('⚠️ Завдання прострочено'));assert.equal(row().status,'overdue');ack(jobs);
assert.equal((await tickReminders(new Date(fixed.getTime()+1000))).jobs.length,0);
sql.prepare("UPDATE records SET status='done' WHERE id='task'").run();assert.equal((await tickReminders(fixed)).jobs.length,0);assert.equal(row().status,'done');
sql.prepare("UPDATE records SET status='todo' WHERE id='task'").run();assert.equal((await tickReminders(fixed)).jobs.length,0,'Reopening must not repeat the same overdue notification.');
sql.prepare("UPDATE records SET due_at='2026-10-08T06:30:00.000Z',reminder_version=1 WHERE id='task'").run();await syncTaskStatuses(owner,tz,fixed);assert.equal(row().status,'todo');
sql.prepare("UPDATE records SET due_at='2026-10-07T06:29:00.000Z',reminder_version=2 WHERE id='task'").run();jobs=(await tickReminders(fixed)).jobs;assert.equal(jobs.length,1);ack(jobs);
sql.prepare("UPDATE records SET due_at=NULL WHERE id='task'").run();await syncTaskStatuses(owner,tz,fixed);assert.equal(row().status,'todo');
reset();insert({status:'done'});insert({id:'untimed',due:null});assert.equal((await tickReminders(fixed)).jobs.length,0);assert.equal(row('untimed').status,'todo');
reset();insert({repeat:{days:[1,2,3,4,5,6,7],time:'08:30'},statusDate:'2026-10-07'});jobs=(await tickReminders(fixed)).jobs;assert.equal(jobs.length,1);assert.equal(row().status,'overdue');assert.equal(row().status_date,'2026-10-07');ack(jobs);
assert.equal((await tickReminders(fixed)).jobs.length,0);
const nextDay=new Date('2026-10-08T06:29:59Z');assert.equal(projectEntry(entryFromRow(row()),tz,nextDay).status,'todo');jobs=(await tickReminders(nextDay)).jobs;assert.equal(jobs.length,1);assert.ok(jobs[0].id.startsWith('deadline:'));ack(jobs);
jobs=(await tickReminders(new Date('2026-10-08T06:30:00Z'))).jobs;assert.equal(jobs.length,1);assert.ok(jobs[0].id.startsWith('overdue:'));assert.equal(row().status_date,'2026-10-08');ack(jobs);
reset();insert({repeat:{days:[1,2,3,4,5,6,7],time:'23:59'},statusDate:'2026-10-07'});jobs=(await tickReminders(new Date('2026-10-07T22:00:00Z'))).jobs;assert.equal(jobs.length,1,'Overdue occurrence must survive midnight.');assert.equal(row().status,'overdue');assert.equal(row().status_date,'2026-10-07');ack(jobs);
assert.equal(projectEntry(entryFromRow(row()),tz,new Date('2026-10-07T22:00:00Z')).status,'todo');
reset();insert({repeat:{days:[1,2,3,4,5,6,7],time:'23:59'},statusDate:'2026-10-07',status:'done'});assert.equal((await tickReminders(new Date('2026-10-07T22:00:00Z'))).jobs.length,0,'Do not report yesterday\'s completed task.');
reset();insert({repeat:{days:[1],time:'08:30'},statusDate:'2026-10-05'});jobs=(await tickReminders(fixed)).jobs;assert.equal(jobs.length,1,'Recover latest missed weekly occurrence after restarting.');ack(jobs);assert.equal((await tickReminders(fixed)).jobs.length,0);
for(const [language,heading] of [['uk','Завдання прострочено'],['en','Task overdue'],['de','Aufgabe überfällig']]){reset(language);insert();jobs=(await tickReminders(fixed)).jobs;assert.equal(jobs.length,1);assert.ok(jobs[0].message.includes(heading));assert.ok(jobs[0].message.includes('Unchanged title'));}
reset();insert();sql.prepare('UPDATE preferences SET deadline_enabled=0').run();assert.equal((await tickReminders(fixed)).jobs.length,0);assert.equal(row().status,'overdue','Status changes even if messages are disabled.');
sql.prepare('UPDATE preferences SET deadline_enabled=1').run();jobs=(await tickReminders(fixed)).jobs;assert.equal(jobs.length,1);ack(jobs);
// Pending jobs must be cancelled after completion, rescheduling, deletion or opt-out.
for(const action of ["UPDATE records SET status='done'",'DELETE FROM records',"UPDATE records SET due_at='2026-10-08T06:30:00.000Z',reminder_version=1",'UPDATE preferences SET deadline_enabled=0']){
 reset();insert();sql.prepare(`INSERT INTO outbox(id,owner,chat_id,message,status,created_at,updated_at,task_id,deadline,reminder_version) VALUES(?,?,?,'stale','pending',?,?,?,'2026-10-07T06:30:00.000Z',0)`).run('overdue:task:0:2026-10-07T06:30:00.000Z',owner,'123',fixed.toISOString(),fixed.toISOString(),'task');sql.exec(action);await tickReminders(fixed);assert.equal(sql.prepare('SELECT status FROM outbox WHERE message=\'stale\'').get().status,'cancelled');
}
sql.close();delete globalThis.__daymarkTestDatabase;
console.log('SQLite overdue integration passed: stored statuses, boundary, single delivery, completion, rescheduling, recurrence/next day, midnight/restart recovery, translated messages and stale-job cancellation.');

}catch(error){console.error(error.message);process.exitCode=1;}
