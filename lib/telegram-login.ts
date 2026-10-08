import { db, hash } from './server';
import {languageValue,translate} from './i18n';

export async function telegramOwner(chatId: string) {
  const existing = await db().prepare('SELECT owner FROM preferences WHERE telegram_id = ?')
    .bind(chatId).first<{ owner: string }>();
  if (!existing) return `telegram:${chatId}`;
  if (!existing.owner.startsWith('pending:')) return existing.owner;
  // An older running handler could store the verified Telegram account under
  // the temporary challenge owner. It cannot be used as a session owner.
  const userId = `telegram:${chatId}`;
  await db().batch([
    db().prepare('UPDATE preferences SET owner = ?, telegram_required = 1 WHERE owner = ? AND telegram_id = ?')
      .bind(userId, existing.owner, chatId),
    db().prepare('UPDATE records SET owner = ? WHERE owner = ?').bind(userId, existing.owner),
    db().prepare('UPDATE auth_links SET owner = ? WHERE owner = ? AND confirmed = 1').bind(userId, existing.owner),
    db().prepare('DELETE FROM sessions WHERE owner = ?').bind(existing.owner),
    db().prepare("UPDATE outbox SET status = 'cancelled' WHERE owner = ? AND status = 'pending'").bind(existing.owner),
  ]);
  return userId;
}

export async function restoreConfirmedLogin(browserHash: string) {
  // Recovery requires both the browser's private challenge cookie and a
  // Telegram confirmation already stored by the trusted bot handler.
  const link = await db().prepare(`SELECT preferences.telegram_id FROM auth_links
    JOIN preferences ON preferences.owner = auth_links.owner
    WHERE auth_links.browser_hash = ? AND auth_links.confirmed = 1 AND auth_links.used = 0
    AND auth_links.expires_at > ? AND auth_links.owner LIKE 'pending:%'
    AND preferences.telegram_id IS NOT NULL`)
    .bind(browserHash, Date.now()).first<{ telegram_id: string }>();
  if (link) await telegramOwner(link.telegram_id);
}

export async function confirmTelegramLogin(input: { code: string; chatId: string; name: string;language?:'de'|'en'|'uk' }, localRequest: boolean) {
  const now = Date.now();
  const linkHash = await hash(input.code);
  const link = await db().prepare(`SELECT owner, language FROM auth_links
    WHERE hash = ? AND expires_at > ? AND used = 0 AND confirmed = 0 AND owner LIKE 'pending:%'`)
    .bind(linkHash, now).first<{ owner: string;language:string }>();
  if (!link) return { ok: false, message:translate(languageValue(input.language),'Посилання застаріло. Створіть нове на сайті.') };
  const userId = await telegramOwner(input.chatId);
  const transferLegacy = import.meta.env.DEV && localRequest && link.owner.startsWith('pending:legacy-local:');
  const legacy = transferLegacy ? await db().prepare(`SELECT timezone, morning_time, morning_enabled, deadline_enabled
    FROM preferences WHERE owner = 'local_seedy'`).first<{ timezone: string; morning_time: string; morning_enabled: number; deadline_enabled: number }>() : null;
  const statements = [
    db().prepare(`INSERT INTO preferences (owner, telegram_id, telegram_name, telegram_required, timezone, morning_time, morning_enabled, deadline_enabled, language)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(owner) DO UPDATE SET telegram_name = excluded.telegram_name, telegram_required = 1`)
      .bind(userId, input.chatId, input.name, legacy?.timezone ?? 'Europe/Berlin', legacy?.morning_time ?? '08:00', legacy?.morning_enabled ?? 1, legacy?.deadline_enabled ?? 1, languageValue(link.language)),
    db().prepare(`UPDATE auth_links SET confirmed = 1, owner = ?
      WHERE hash = ? AND owner = ? AND confirmed = 0 AND used = 0 AND expires_at > ? RETURNING owner`)
      .bind(userId, linkHash, link.owner, now),
  ];
  if (transferLegacy) {
    statements.push(db().prepare(`UPDATE records SET owner = ? WHERE owner = 'local_seedy'
      AND EXISTS (SELECT 1 FROM auth_links WHERE hash = ? AND owner = ? AND confirmed = 1 AND used = 0)`)
      .bind(userId, linkHash, userId));
    statements.push(db().prepare(`UPDATE outbox SET status = 'cancelled' WHERE owner = 'local_seedy' AND status = 'pending'
      AND EXISTS (SELECT 1 FROM auth_links WHERE hash = ? AND owner = ? AND confirmed = 1 AND used = 0)`)
      .bind(linkHash, userId));
  }
  const results = await db().batch(statements);
  if (!results[1].results.length) return { ok: false, message: translate(languageValue(link.language),'Це посилання вже підтверджено. Створіть нове на сайті.') };
  return { ok: true, message: translate(languageValue(link.language),'✅ Вхід підтверджено. Поверніться на сайт.') };
}
