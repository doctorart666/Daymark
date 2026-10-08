import {translate,type Language} from './i18n';
import { dayKey, deadlineStatus, zonedToISO, type Entry, type Repeat } from './models';

export const weekdays = [
  { day: 1, short: 'Пн', label: 'Понеділок' }, { day: 2, short: 'Вт', label: 'Вівторок' },
  { day: 3, short: 'Ср', label: 'Середа' }, { day: 4, short: 'Чт', label: 'Четвер' },
  { day: 5, short: 'Пт', label: 'П’ятниця' }, { day: 6, short: 'Сб', label: 'Субота' },
  { day: 7, short: 'Нд', label: 'Неділя' },
];
export function addDays(date: string, count: number) {
  const instant = new Date(date + 'T12:00:00Z');
  instant.setUTCDate(instant.getUTCDate() + count);
  return instant.toISOString().slice(0, 10);
}
export function runsOn(repeat: Repeat, date: string) {
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay() || 7;
  return repeat.days.includes(weekday);
}
export function nextOccurrence(repeat: Repeat, from: string) {
  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(from, offset);
    if (runsOn(repeat, date)) return date;
  }
  throw new Error('Оберіть хоча б один день тижня.');
}
export function recurringDeadline(date: string, time: string | null, timezone: string) {
  if (!time) return null;
  // A clock time skipped by DST moves to the first valid local minute.
  for (let offset = 0; offset <= 180; offset++) {
    const wall = new Date(Date.parse(`${date}T${time}:00Z`) + offset * 60000).toISOString().slice(0, 16);
    if (!wall.startsWith(date)) break;
    try { return zonedToISO(wall, timezone); } catch { /* Try the next local minute. */ }
  }
  return null;
}
export function entryOnDate(entry: Entry, date: string, timezone: string, now = new Date()): Entry | null {
  if (!entry.repeat || !runsOn(entry.repeat, date)) return null;
  const dueAt=recurringDeadline(date,entry.repeat.time,timezone);
  const status=entry.statusDate===date?entry.status:'todo';
  return {...entry,occurrenceDate:date,dueAt,status:deadlineStatus(status,dueAt,now)};
}
export function projectEntry(entry: Entry, timezone: string, now = new Date()): Entry {
  if (!entry.repeat) return entry.kind==='task'?{...entry,status:deadlineStatus(entry.status,entry.dueAt,now)}:entry;
  return entryOnDate(entry, nextOccurrence(entry.repeat, dayKey(now, timezone)), timezone, now)!;
}
export function repeatLabel(repeat: Repeat,language:Language='uk') {
  return repeat.days.length === 7 ? translate(language,'Щодня') : weekdays.filter(day => repeat.days.includes(day.day)).map(day => translate(language,day.short)).join(', ');
}
