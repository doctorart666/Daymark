import {dayKey,dateLabel} from './models';
export function localTime(now:Date,tz:string){return new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);}
export type ReminderTask={id:string;title:string;due_at:string;reminder_version:number};
export function deadlineJobKey(t:ReminderTask){return `deadline:${t.id}:${t.reminder_version}:${t.due_at}`;}
export function needsDeadline(t:ReminderTask,now:Date){const due=Date.parse(t.due_at);return due>now.getTime() && due-now.getTime()<=30*60000;}
export function morningText(tasks:ReminderTask[],now:Date,tz:string){return `☀️ Фокус · ${dayKey(now,tz)}\n\nЗавдання з дедлайнами: ${tasks.length}\n\n`+tasks.slice(0,40).map((t,i)=>`${i+1}. ${t.title}\n   ${dateLabel(t.due_at,tz)}`).join('\n\n')+(tasks.length>40?`\n\nЩе ${tasks.length-40} — на сайті.`:'');}
