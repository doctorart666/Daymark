import { authorized, checkOrigin, db, entryFromRow, failure, preferences, toEntry } from '@/lib/server';
import { dayKey,deadlineStatus } from '@/lib/models';
import { nextOccurrence, projectEntry,recurringDeadline } from '@/lib/recurrence';
import { z } from 'zod';

const block = z.object({ id: z.string().min(1).max(80), type: z.enum(['text','heading','code']), content: z.string().max(100000), language: z.string().max(30).optional() });
const repeat = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine(days => new Set(days).size === days.length),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
});
const schema = z.object({
  id: z.string().uuid().optional(), kind: z.enum(['task','note','topic']), title: z.string().trim().min(1).max(240),
  topic: z.string().trim().max(100), blocks: z.array(block).max(100), status: z.enum(['todo','progress','done','overdue']),
  priority: z.enum(['normal','high','low']), dueAt: z.string().datetime().nullable(), repeat: repeat.nullable().optional(),
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const user = await authorized();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) throw new Error('VALIDATION:Перевірте назву, вміст і дні повторення завдання.');
    const input = parsed.data;
    if (JSON.stringify(input.blocks).length > 500000) throw new Error('VALIDATION:Запис завеликий.');
    const now = new Date();
    const settings = await preferences(user.userId);
    const previous = input.id ? await db().prepare('SELECT * FROM records WHERE id = ? AND owner = ? AND kind = ?')
      .bind(input.id, user.userId, input.kind).first<Record<string, unknown>>() : null;
    if (input.id && !previous) throw new Error('VALIDATION:Запис не знайдено.');
    const raw = previous ? entryFromRow(previous) : null;
    const recurrence = input.repeat === undefined ? raw?.repeat ?? null : input.repeat;
    if (recurrence && input.kind !== 'task') throw new Error('VALIDATION:Повторення доступне лише для завдань.');
    if (recurrence) recurrence.days.sort((a, b) => a - b);
    const changed = !!raw && JSON.stringify(raw.repeat) !== JSON.stringify(recurrence);
    if (raw?.repeat && recurrence && !changed && input.occurrenceDate !== projectEntry(raw, settings.timezone, now).occurrenceDate)
      throw new Error('VALIDATION:День завдання змінився. Оновіть список перед збереженням.');
    const date = recurrence ? nextOccurrence(recurrence, dayKey(now, settings.timezone)) : null;
    const requestedStatus = changed && recurrence ? 'todo' : input.status;
    const deadline = input.kind === 'task' && !recurrence ? input.dueAt : null;
    const status=input.kind==='task'?deadlineStatus(requestedStatus,recurrence?recurringDeadline(date!,recurrence.time,settings.timezone):deadline,now):requestedStatus==='overdue'?'todo':requestedStatus;
    const days = recurrence ? JSON.stringify(recurrence.days) : null;
    const time = recurrence?.time ?? null;
    const id = input.id ?? crypto.randomUUID();
    const values = [input.title, input.topic, JSON.stringify(input.blocks), status, input.priority];
    let row: Record<string, unknown> | null;
    if (previous) {
      row = await db().prepare(`UPDATE records SET title = ?, topic = ?, blocks = ?, status = ?, priority = ?,
        reminder_version = CASE WHEN due_at IS NOT ? OR repeat_days IS NOT ? OR repeat_time IS NOT ? THEN reminder_version + 1 ELSE reminder_version END,
        due_at = ?, repeat_days = ?, repeat_time = ?, status_date = ?, updated_at = ?
        WHERE id = ? AND owner = ? AND kind = ? RETURNING *`)
        .bind(...values, deadline, days, time, deadline, days, time, date, now.toISOString(), id, user.userId, input.kind).first<Record<string, unknown>>();
    } else {
      row = await db().prepare(`INSERT INTO records (id, owner, kind, title, topic, blocks, status, priority, due_at, repeat_days, repeat_time, status_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
        .bind(id, user.userId, input.kind, ...values, deadline, days, time, date, now.toISOString(), now.toISOString()).first<Record<string, unknown>>();
    }
    if (!row) throw new Error('VALIDATION:Запис не знайдено.');
    return Response.json(toEntry(row, settings.timezone, now));
  } catch (error) { return failure(error); }
}
export async function DELETE(req: Request) {
  try {
    checkOrigin(req);
    const user = await authorized();
    const parsed = z.object({ id: z.string().uuid() }).safeParse(await req.json());
    if (!parsed.success) throw new Error('VALIDATION:Некоректний запис.');
    await db().prepare('DELETE FROM records WHERE id = ? AND owner = ?').bind(parsed.data.id, user.userId).run();
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
