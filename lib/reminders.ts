import {BRAND,translate,type Language} from './i18n';
import {dayKey,dateLabel} from './models';
import type { Entry } from './models';
import { addDays, entryOnDate } from './recurrence';
export function localTime(now:Date,tz:string){return new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);}
export type ReminderTask={id:string;title:string;due_at:string|null;reminder_version:number};
export function deadlineJobKey(t:ReminderTask){return `deadline:${t.id}:${t.reminder_version}:${t.due_at}`;}
export function needsDeadline(t:ReminderTask,now:Date){if(!t.due_at)return false;const due=Date.parse(t.due_at);return due>now.getTime() && due-now.getTime()<=30*60000;}
export function morningText(tasks:ReminderTask[],now:Date,tz:string,language:Language='uk'){
  const t=(key:string,params?:Record<string,string|number>)=>translate(language,key,params);
  return `☀️ ${BRAND} · ${dayKey(now,tz)}\n\n${t('Твій список завдань: {count}',{count:tasks.length})}\n\n`+
    tasks.slice(0,40).map((task,i)=>`${i+1}. ${task.title}\n   ${task.due_at?dateLabel(task.due_at,tz,language):t('Сьогодні · постійне завдання')}`).join('\n\n')+
    (tasks.length>40?`\n\n${t('Ще {count} — на сайті.',{count:tasks.length-40})}`:'');
}
export function deadlineOccurrences(entry: Entry, now: Date, timezone: string) {
  if (!entry.repeat) return [entry];
  const today = dayKey(now, timezone);
  return [today, addDays(today, 1)].map(date => entryOnDate(entry, date, timezone,now)).filter((value): value is Entry => !!value);
}

export function overdueJobKey(task:ReminderTask){return `overdue:${task.id}:${task.reminder_version}:${task.due_at}`;}
export function needsOverdue(task:ReminderTask,now:Date){return !!task.due_at&&Date.parse(task.due_at)<=now.getTime();}
// Recover the latest missed occurrence after a manual restart, including midnight.
// A newer completion marker means the older day's state is no longer available.
export function overdueOccurrences(entry:Entry,now:Date,timezone:string):Entry[]{
  if(!entry.repeat)return entry.status==='done'?[]:[entry];
  if(!entry.repeat.time)return [];
  const today=dayKey(now,timezone);
  const created=dayKey(new Date(entry.createdAt),timezone);
  for(let offset=0;offset<=7;offset++){
    const date=addDays(today,-offset);
    if(date<created||entry.statusDate&&date<entry.statusDate)return [];
    const occurrence=entryOnDate(entry,date,timezone,now);
    if(!occurrence?.dueAt||Date.parse(occurrence.dueAt)>now.getTime())continue;
    return occurrence.status==='done'?[]:[occurrence];
  }
  return [];
}
