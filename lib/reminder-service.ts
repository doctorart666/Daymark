import {languageValue,translate} from './i18n';
import { db, entryFromRow,syncTaskStatuses,sharedWorkspaces,scopeGuard } from './server';
import { dayKey, dateLabel, type Entry } from './models';
import { entryOnDate, projectEntry } from './recurrence';
import { deadlineOccurrences, deadlineJobKey, localTime, morningText, needsDeadline,overdueJobKey,needsOverdue,overdueOccurrences, type ReminderTask } from './reminders';

type Job = { id: string; message: string; taskId?: string; deadline?: string; version?: number };
export async function tickReminders(now = new Date()) {
  const stamp = now.toISOString();
  const users = (await db().prepare('SELECT * FROM preferences WHERE telegram_id IS NOT NULL AND owner NOT LIKE \'pending:%\'')
    .all<{ owner: string; telegram_id: string; timezone: string; morning_time: string; morning_enabled: number; deadline_enabled: number;language:string }>()).results;
  const current = new Map<string, { entry: Entry; timezone: string; version: number;deadlineEnabled:boolean }>();
  for (const recipient of users) {
    const shared=await sharedWorkspaces(recipient.owner);
    const scopes=[{id:recipient.owner,workspaceId:null as string|null,name:'',timezone:recipient.timezone},
      ...shared.map(w=>({id:'workspace:'+w.id,workspaceId:w.id,name:w.name,timezone:w.timezone}))];
    const morningAll:ReminderTask[]=[],morningWorkspaceIds:string[]=[];
    for(const scope of scopes){
    const settings={...recipient,timezone:scope.timezone};
    const recipientKey=(key:string)=>scope.workspaceId?key+':recipient:'+recipient.owner:key;
    const title=(value:string)=>scope.workspaceId?'['+scope.name+'] '+value:value;
    const language=languageValue(settings.language);
    const t=(key:string,params?:Record<string,string|number>)=>translate(language,key,params);
    await syncTaskStatuses(scope.id,settings.timezone,now);
    const guard=scopeGuard(recipient.owner,scope.workspaceId);
    const rows = (await db().prepare(`SELECT * FROM records WHERE owner = ? AND kind = 'task' AND ${guard.sql} ORDER BY due_at`)
      .bind(scope.id,...guard.args).all<Record<string, unknown>>()).results;
    const today = dayKey(now, settings.timezone);
    const morning: ReminderTask[] = [];
    const jobs: Job[] = [];
    for (const row of rows) {
      const entry = entryFromRow(row);
      const version = Number(row.reminder_version);
      current.set(`${settings.owner}:${entry.id}`, { entry, timezone: settings.timezone, version,deadlineEnabled:!!settings.deadline_enabled });
      const projected = projectEntry(entry, settings.timezone, now);
      if (projected.status !== 'done' && (entry.repeat ? projected.occurrenceDate === today : !!projected.dueAt)) {
        morning.push({ id: entry.id, title: title(entry.title), due_at: projected.dueAt, reminder_version: version });
      }
      if (settings.deadline_enabled) {
        for (const occurrence of deadlineOccurrences(entry, now, settings.timezone)) {
          const task = { id: entry.id, title: entry.title, due_at: occurrence.dueAt, reminder_version: version };
          if (occurrence.status === 'done' || !needsDeadline(task, now) || !task.due_at) continue;
          jobs.push({ id: recipientKey(deadlineJobKey(task)), taskId: entry.id, deadline: task.due_at, version,
            message: `${t('⏰ Наближається дедлайн')}\n\n${title(entry.title)}\n${dateLabel(task.due_at, settings.timezone,language)}\n\n${t('Залишилося {minutes} хв.',{minutes:Math.ceil((Date.parse(task.due_at)-now.getTime())/60000)})}` });
        }
        for(const occurrence of overdueOccurrences(entry,now,settings.timezone)){
          const task={id:entry.id,title:entry.title,due_at:occurrence.dueAt,reminder_version:version};
          if(!needsOverdue(task,now)||!task.due_at)continue;
          jobs.push({id:recipientKey(overdueJobKey(task)),taskId:entry.id,deadline:task.due_at,version,
            message:`${t('⚠️ Завдання прострочено')}\n\n${title(entry.title)}\n${t('Термін виконання: {deadline}',{deadline:dateLabel(task.due_at,settings.timezone,language)})}\n\n${t('Завдання не виконано вчасно. Статус: «Прострочено».')}`});
        }
      }
    }
    morningAll.push(...morning);
    if(morning.length&&scope.workspaceId)morningWorkspaceIds.push(scope.workspaceId);
    if (jobs.length) await db().batch(jobs.map(job => db().prepare(`INSERT OR IGNORE INTO outbox
      (id, owner, chat_id, message, status, created_at, updated_at, task_id, deadline, reminder_version,workspace_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`)
      .bind(job.id, settings.owner, settings.telegram_id, job.message.slice(0, 4000), 'pending', stamp, stamp, job.taskId ?? null, job.deadline ?? null, job.version ?? null,scope.workspaceId,...guard.args)));
    }
    const minute=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
    const clock=minute(localTime(now,recipient.timezone)),start=minute(recipient.morning_time);
    if(recipient.morning_enabled&&clock>=start&&clock<start+60&&morningAll.length){
      const ids=JSON.stringify(morningWorkspaceIds);
      await db().prepare(`INSERT OR IGNORE INTO outbox(id,owner,chat_id,message,status,created_at,updated_at,workspace_ids)
        SELECT ?,?,?,?,'pending',?,?,? WHERE NOT EXISTS(SELECT 1 FROM json_each(?) source WHERE NOT EXISTS(
          SELECT 1 FROM workspaces w WHERE w.id=source.value AND (w.owner=? OR EXISTS(
            SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=?))))`)
        .bind(`morning:${recipient.owner}:${dayKey(now,recipient.timezone)}`,recipient.owner,recipient.telegram_id,
          morningText(morningAll,now,recipient.timezone,languageValue(recipient.language)).slice(0,4000),stamp,stamp,ids,ids,recipient.owner,recipient.owner).run();
    }
  }
  const pending = (await db().prepare("SELECT id, owner, task_id, deadline, reminder_version FROM outbox WHERE status = 'pending' AND task_id IS NOT NULL")
    .all<{ id: string; owner: string; task_id: string; deadline: string; reminder_version: number }>()).results;
  const cancelled = pending.filter(job => {
    const task = current.get(`${job.owner}:${job.task_id}`);
    if (!task || !task.deadlineEnabled || task.version !== job.reminder_version) return true;
    if(job.id.startsWith('overdue:'))return Date.parse(job.deadline)>now.getTime()||!overdueOccurrences(task.entry,now,task.timezone).some(occurrence=>occurrence.dueAt===job.deadline&&occurrence.status!=='done');
    if(Date.parse(job.deadline)<=now.getTime())return true;
    const occurrence = task.entry.repeat ? entryOnDate(task.entry, dayKey(new Date(job.deadline), task.timezone), task.timezone,now) : task.entry;
    return !occurrence || occurrence.status === 'done' || occurrence.dueAt !== job.deadline;
  });
  if (cancelled.length) await db().batch(cancelled.map(job => db().prepare("UPDATE outbox SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'").bind(stamp, job.id)));
  const sharedAccess=`EXISTS (SELECT 1 FROM workspaces w WHERE w.id=outbox.workspace_id AND
    (w.owner=outbox.owner OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=outbox.owner)))`;
  const morningAccess=`NOT EXISTS(SELECT 1 FROM json_each(outbox.workspace_ids) source WHERE NOT EXISTS(
    SELECT 1 FROM workspaces w WHERE w.id=source.value AND (w.owner=outbox.owner OR EXISTS(
      SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=outbox.owner))))`;
  await db().prepare(`UPDATE outbox SET status='cancelled',updated_at=? WHERE status='pending' AND
    ((workspace_id IS NOT NULL AND NOT ${sharedAccess}) OR NOT ${morningAccess})`).bind(stamp).run();
  // Never re-claim sending/unknown rows: Telegram sendMessage has no idempotency key.
  await db().prepare("UPDATE outbox SET status='unknown',error='Delivery uncertain after service interruption',updated_at=? WHERE status='sending' AND updated_at<?")
    .bind(stamp, new Date(now.getTime() - 120000).toISOString()).run();
  const jobs = (await db().prepare(`UPDATE outbox SET status='sending',updated_at=? WHERE id IN (SELECT id FROM outbox WHERE status='pending' AND (workspace_id IS NULL OR ${sharedAccess}) AND ${morningAccess} ORDER BY created_at LIMIT 20) RETURNING id,chat_id,message`)
    .bind(stamp).all()).results;
  return { jobs };
}
