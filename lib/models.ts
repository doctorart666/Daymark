import {translate,locales,type Language} from './i18n';
export type Block = { id: string; type: 'text'|'heading'|'code'; content: string; language?: string };
export type Repeat = { days:number[]; time:string|null };
export type Entry = { id:string; kind:'task'|'note'|'topic'; title:string; topic:string; blocks:Block[]; status:'todo'|'progress'|'done'|'overdue'; priority:'normal'|'high'|'low'; dueAt:string|null; repeat:Repeat|null; statusDate:string|null; occurrenceDate:string|null; createdAt:string; updatedAt:string };
export type Preferences = { language:Language; timezone:string; morningTime:string; morningEnabled:boolean; deadlineEnabled:boolean; telegramId:string|null; telegramName:string|null; telegramRequired:boolean };
export type SharedWorkspace = { id:string; name:string; timezone:string; role:'owner'|'editor' };
export type WorkspaceData = { workspaces:SharedWorkspace[]; activeWorkspace:{id:string|null; name:string; timezone:string; role:'personal'|'owner'|'editor'}; entries:Entry[]; preferences:Preferences; telegram:{configured:boolean; username:string|null; online:boolean; lastSeen:number; gate:boolean}; displayName:string };
export const kinds = { task:'Завдання', note:'Нотатки', topic:'Навчання' };
export const statusLabels = { todo:'До виконання', progress:'У роботі', done:'Виконано', overdue:'Прострочено' };
export function dayKey(date:Date, timezone:string) { return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
export function dateLabel(value:string|null, timezone:string, language:Language='uk') { return value ? new Intl.DateTimeFormat(locales[language],{timeZone:timezone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : translate(language,'Без дедлайну'); }
export function localDateInput(value:string|null, timezone:string) { if(!value) return ''; const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)); return parts.replace(' ','T'); }
export function zonedToISO(value:string, timezone:string) { if(!value) return null; const target=Date.parse(value+'Z'); let instant=target; for(let i=0;i<4;i++){ const local=localDateInput(new Date(instant).toISOString(),timezone); instant+= target-Date.parse(local+'Z'); } const result=new Date(instant).toISOString(); if(localDateInput(result,timezone)!==value) throw new Error('Цього часу не існує через перехід на літній час. Оберіть інший.'); return result; }

// Completion always wins. Overdue is determined by the deadline, not a manual selection.
export function deadlineStatus(status:Entry['status'],dueAt:string|null,now=new Date()):Entry['status'] {
  if(status==='done')return 'done';
  if(dueAt&&Date.parse(dueAt)<=now.getTime())return 'overdue';
  return status==='overdue'?'todo':status;
}
