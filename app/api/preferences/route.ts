import { authorized, checkOrigin, db, failure } from '@/lib/server';
import { z } from 'zod';
const schema = z.object({ timezone: z.string().max(100), morningTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), morningEnabled: z.boolean(), deadlineEnabled: z.boolean() });
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const user = await authorized();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) throw new Error('VALIDATION:Перевірте налаштування.');
    const p = parsed.data;
    try { new Intl.DateTimeFormat('en', { timeZone: p.timezone }); }
    catch { throw new Error('VALIDATION:Некоректний часовий пояс.'); }
    await db().prepare(`UPDATE preferences SET timezone = ?, morning_time = ?, morning_enabled = ?, deadline_enabled = ?, telegram_required = 1 WHERE owner = ?`)
      .bind(p.timezone, p.morningTime, Number(p.morningEnabled), Number(p.deadlineEnabled), user.userId).run();
    return Response.json({ ok: true });
  } catch (e) { return failure(e); }
}
