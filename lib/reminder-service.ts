import {languageValue,translate} from './i18n';
import { db, entryFromRow,syncTaskStatuses } from './server';
import { dayKey, dateLabel, type Entry } from './models';
import { entryOnDate, projectEntry } from './recurrence';
import { deadlineOccurrences, deadlineJobKey, localTime, morningText, needsDeadline,overdueJobKey,needsOverdue,overdueOccurrences, type ReminderTask } from './reminders';

type Job = { id: string; message: string; taskId?: string; deadline?: string; version?: number };
export async function tickReminders(now = new Date()) {
  const stamp = now.toISOString();
  const users = (await db().prepare('SELECT * FROM preferences WHERE telegram_id IS NOT NULL AND owner NOT LIKE \'pending:%\'')
    .all<{ owner: string; telegram_id: string; timezone: string; morning_time: string; morning_enabled: number; deadline_enabled: number;language:string }>()).results;
  const current = new Map<string, { entry: Entry; timezone: string; version: number;deadlineEnabled:boolean }>();
  for (const settings of users) {
    const language=languageValue(settings.language);
    const t=(key:string,params?:Record<string,string|number>)=>translate(language,key,params);
    await syncTaskStatuses(settings.owner,settings.timezone,now);
    const rows = (await db().prepare("SELECT * FROM records WHERE owner = ? AND kind = 'task' ORDER BY due_at")
      .bind(settings.owner).all<Record<string, unknown>>()).results;
    const today = dayKey(now, settings.timezone);
    const morning: ReminderTask[] = [];
    const jobs: Job[] = [];
    for (const row of rows) {
      const entry = entryFromRow(row);
      const version = Number(row.reminder_version);
      current.set(`${settings.owner}:${entry.id}`, { entry, timezone: settings.timezone, version,deadlineEnabled:!!settings.deadline_enabled });
      const projected = projectEntry(entry, settings.timezone, now);
      if (projected.status !== 'done' && (entry.repeat ? projected.occurrenceDate === today : !!projected.dueAt)) {
        morning.push({ id: entry.id, title: entry.title, due_at: projected.dueAt, reminder_version: version });
      }
      if (settings.deadline_enabled) {
        for (const occurrence of deadlineOccurrences(entry, now, settings.timezone)) {
          const task = { id: entry.id, title: entry.title, due_at: occurrence.dueAt, reminder_version: version };
          if (occurrence.status === 'done' || !needsDeadline(task, now) || !task.due_at) continue;
          jobs.push({ id: deadlineJobKey(task), taskId: entry.id, deadline: task.due_at, version,
            message: `${t('⏰ Наближається дедлайн')}\n\n${entry.title}\n${dateLabel(task.due_at, settings.timezone,language)}\n\n${t('Залишилося {minutes} хв.',{minutes:Math.ceil((Date.parse(task.due_at)-now.getTime())/60000)})}` });
        }
        for(const occurrence of overdueOccurrences(entry,now,settings.timezone)){
          const task={id:entry.id,title:entry.title,due_at:occurrence.dueAt,reminder_version:version};
          if(!needsOverdue(task,now)||!task.due_at)continue;
          jobs.push({id:overdueJobKey(task),taskId:entry.id,deadline:task.due_at,version,
            message:`${t('⚠️ Завдання прострочено')}\n\n${entry.title}\n${t('Термін виконання: {deadline}',{deadline:dateLabel(task.due_at,settings.timezone,language)})}\n\n${t('Завдання не виконано вчасно. Статус: «Прострочено».')}`});
        }
      }
    }
    const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const clock = minute(localTime(now, settings.timezone));
    const morningStart = minute(settings.morning_time);
    if (settings.morning_enabled && clock >= morningStart && clock < morningStart + 60 && morning.length) {
      jobs.unshift({ id: `morning:${settings.owner}:${today}`, message: morningText(morning, now, settings.timezone,language) });
    }
    if (jobs.length) await db().batch(jobs.map(job => db().prepare(`INSERT OR IGNORE INTO outbox
      (id, owner, chat_id, message, status, created_at, updated_at, task_id, deadline, reminder_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(job.id, settings.owner, settings.telegram_id, job.message.slice(0, 4000), 'pending', stamp, stamp, job.taskId ?? null, job.deadline ?? null, job.version ?? null)));
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
  // Never re-claim sending/unknown rows: Telegram sendMessage has no idempotency key.
  await db().prepare("UPDATE outbox SET status='unknown',error='Delivery uncertain after service interruption',updated_at=? WHERE status='sending' AND updated_at<?")
    .bind(stamp, new Date(now.getTime() - 120000).toISOString()).run();
  const jobs = (await db().prepare("UPDATE outbox SET status='sending',updated_at=? WHERE id IN (SELECT id FROM outbox WHERE status='pending' ORDER BY created_at LIMIT 20) RETURNING id,chat_id,message")
    .bind(stamp).all()).results;
  return { jobs };
}
