import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Entry, Preferences, WorkspaceData, SharedWorkspace } from './models';
import { projectEntry } from './recurrence';
import { overdueOccurrences } from './reminders';
import { languageValue,translate } from './i18n';

export const SESSION_COOKIE = 'focus_session';
export const CHALLENGE_COOKIE = 'focus_login_challenge';
export const LANGUAGE_COOKIE = 'daymark_language';
export const LANGUAGE_CHOICE_COOKIE = 'daymark_language_choice';
export function db() {
  if (!env.DB) throw new Error('База даних тимчасово недоступна. Спробуйте ще раз.');
  return env.DB;
}
export function rawEnv() { return env as Cloudflare.Env & { TELEGRAM_SERVICE_SECRET?: string }; }
export async function hash(value: string) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, '0')).join('');
}
export function nonce() { return crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''); }
export function safeReturnTo(value: string) {
  if (!value.startsWith('/') || value.startsWith('//')) return '/tasks';
  try {
    const url = new URL(value, 'https://focus.local');
    return url.origin === 'https://focus.local' && ['/', '/tasks', '/notes', '/learn', '/settings', '/telegram-setup'].includes(url.pathname)
      ? url.pathname + url.search : '/tasks';
  } catch { return '/tasks'; }
}
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await db().prepare(`SELECT sessions.owner, preferences.telegram_id, preferences.telegram_name, preferences.language
    FROM sessions JOIN preferences ON preferences.owner = sessions.owner
    WHERE sessions.hash = ? AND sessions.expires_at > ? AND preferences.telegram_id IS NOT NULL
    AND sessions.owner NOT LIKE 'pending:%'`)
    .bind(await hash(token), Date.now()).first<{ owner: string; telegram_id: string; telegram_name: string | null; language:string }>();
  return user ? { userId: user.owner, telegramId: user.telegram_id, fullName: user.telegram_name, language:languageValue(user.language) } : null;
}
export async function requestLanguage(){
  try{const user=await currentUser();if(user)return user.language;}catch{/* Keep the login page readable during database outages. */}
  return languageValue((await cookies()).get(LANGUAGE_COOKIE)?.value);
}
export async function owner() {
  const user = await currentUser();
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}
export async function requireUser(returnTo: string) {
  const user = await currentUser();
  if (!user) redirect('/login?return_to=' + encodeURIComponent(safeReturnTo(returnTo)));
  return user;
}
export const authorized = owner;
export async function preferences(id: string): Promise<Preferences> {
  const row = await db().prepare('SELECT * FROM preferences WHERE owner = ?').bind(id).first<Record<string, unknown>>();
  return { language:languageValue(row?.language),timezone: String(row?.timezone ?? 'Europe/Berlin'), morningTime: String(row?.morning_time ?? '08:00'),
    morningEnabled: row?.morning_enabled !== 0, deadlineEnabled: row?.deadline_enabled !== 0,
    telegramId: row?.telegram_id ? String(row.telegram_id) : null,
    telegramName: row?.telegram_name ? String(row.telegram_name) : null, telegramRequired: true };
}
export async function telegramStatus() {
  const state = await db().prepare('SELECT username, heartbeat FROM service_state WHERE id = ?')
    .bind('telegram').first<{ username: string; heartbeat: number }>();
  return { configured: !!rawEnv().TELEGRAM_SERVICE_SECRET, username: state?.username ?? null,
    online: !!state && Date.now() - state.heartbeat < 90000, lastSeen: state?.heartbeat ?? 0, gate: false };
}
export function checkOrigin(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin) throw new Error('FORBIDDEN');
}
export async function failure(err: unknown) {
  const msg = err instanceof Error ? err.message : 'Помилка сервера';
  const status = msg === 'UNAUTHORIZED' ? 401 : msg === 'FORBIDDEN' ? 403 : msg.startsWith('VALIDATION:') ? 400 : 503;
  if (status === 503) console.error('Workspace operation failed');
  const message=status===503?'Не вдалося виконати дію. Ваші зміни залишилися в редакторі. Спробуйте ще раз.':msg.replace(/^VALIDATION:/,'');
  return Response.json({error:translate(await requestLanguage(),message)},{status});
}
export function entryFromRow(row: Record<string, unknown>): Entry {
  return { id: String(row.id), kind: row.kind as Entry['kind'], title: String(row.title), topic: String(row.topic),
    blocks: JSON.parse(String(row.blocks)), status: row.status as Entry['status'], priority: row.priority as Entry['priority'],
    dueAt: row.due_at ? String(row.due_at) : null,
    repeat: row.repeat_days ? { days: JSON.parse(String(row.repeat_days)), time: row.repeat_time ? String(row.repeat_time) : null } : null,
    statusDate: row.status_date ? String(row.status_date) : null, occurrenceDate: null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
export function toEntry(row: Record<string, unknown>, timezone = 'Europe/Berlin', now = new Date()): Entry {
  return projectEntry(entryFromRow(row), timezone, now);
}
// Persist automatic task statuses when the bot ticks or the workspace is read.
// Guard against a task being edited or completed after this snapshot was taken.
export async function syncTaskStatuses(id:string,timezone:string,now=new Date()) {
  const rows=(await db().prepare("SELECT * FROM records WHERE owner = ? AND kind = 'task'").bind(id).all<Record<string,unknown>>()).results;
  const updates=[];
  for(const row of rows){
    const entry=entryFromRow(row);
    let projected=projectEntry(entry,timezone,now);
    // Keep the previous day's completion until the next day is acted on.
    // The next occurrence is projected as active without overwriting that marker.
    if(entry.repeat&&projected.status!=='overdue'){
      const missed=overdueOccurrences(entry,now,timezone)[0];
      if(!missed)continue;
      projected=missed;
    }
    const date=entry.repeat?projected.occurrenceDate:null;
    if(entry.status===projected.status&&entry.statusDate===date)continue;
    updates.push(db().prepare(`UPDATE records SET status = ?, status_date = ?, updated_at = ?
      WHERE id = ? AND owner = ? AND kind = 'task' AND updated_at = ?
      AND reminder_version = ? AND status = ? AND status_date IS ?`)
      .bind(projected.status,date,now.toISOString(),entry.id,id,entry.updatedAt,row.reminder_version,entry.status,entry.statusDate));
  }
  if(updates.length)await db().batch(updates);
}
// The records.owner namespace keeps personal records untouched; shared records
// live under workspace:<uuid>. The acting user's identity is always separate.
export async function sharedWorkspaces(userId:string):Promise<SharedWorkspace[]> {
  const rows = (await db().prepare(`SELECT w.id,w.name,w.timezone,
    CASE WHEN w.owner = ? THEN 'owner' ELSE 'editor' END AS role FROM workspaces w
    WHERE w.owner = ? OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ?)
    ORDER BY w.created_at,w.id`).bind(userId,userId,userId).all<SharedWorkspace>()).results;
  return rows;
}
export function scopeGuard(userId:string,workspaceId:string|null,ownerOnly=false) {
  if (!workspaceId) return { sql:'1 = 1', args:[] as string[] };
  return { sql:`EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ? AND
    (w.owner = ? ${ownerOnly ? '' : 'OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ?)'}))`,
    args:ownerOnly ? [workspaceId,userId] : [workspaceId,userId,userId] };
}
export async function recordScope(userId:string,workspaceId:string|null) {
  if (!workspaceId) return { id:userId,workspace:null,timezone:(await preferences(userId)).timezone };
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(workspaceId)) throw new Error('FORBIDDEN');
  const guard=scopeGuard(userId,workspaceId);
  const shared=await db().prepare(`SELECT id,name,timezone,CASE WHEN owner = ? THEN 'owner' ELSE 'editor' END AS role
    FROM workspaces WHERE id = ? AND ${guard.sql}`).bind(userId,workspaceId,...guard.args).first<SharedWorkspace>();
  if (!shared) throw new Error('FORBIDDEN');
  return { id:'workspace:'+shared.id,workspace:shared,timezone:shared.timezone };
}
export async function workspace(workspaceId:string|null=null): Promise<WorkspaceData> {
  const user = await owner();
  const settings = await preferences(user.userId);
  const scope = await recordScope(user.userId,workspaceId);
  await syncTaskStatuses(scope.id,scope.timezone);
  const guard=scopeGuard(user.userId,workspaceId);
  const rows = await db().prepare(`SELECT * FROM records WHERE owner = ? AND ${guard.sql} ORDER BY updated_at DESC`)
    .bind(scope.id,...guard.args).all<Record<string, unknown>>();
  // Recheck after the read so a concurrent removal cannot return a stale snapshot.
  if (workspaceId) await recordScope(user.userId,workspaceId);
  return { entries: rows.results.map(row => toEntry(row,scope.timezone)), preferences: settings,
    workspaces:await sharedWorkspaces(user.userId),
    activeWorkspace:scope.workspace ?? {id:null,name:translate(user.language,'Мій простір'),role:'personal',timezone:settings.timezone},
    telegram: await telegramStatus(), displayName: user.fullName ?? translate(user.language,'Мій простір') };
}
