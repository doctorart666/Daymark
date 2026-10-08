import { z } from 'zod';
import {languageValue} from '@/lib/i18n';
import { cookies } from 'next/headers';
import { logout } from '@/lib/logout';
import { restoreConfirmedLogin } from '@/lib/telegram-login';
import { checkOrigin, db, failure, hash, nonce, telegramStatus, requestLanguage, LANGUAGE_COOKIE, LANGUAGE_CHOICE_COOKIE, SESSION_COOKIE, CHALLENGE_COOKIE } from '@/lib/server';

export async function GET() {
  try { return Response.json(await telegramStatus(), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (e) { return failure(e); }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const parsed = z.object({ action: z.enum(['start', 'complete', 'logout']) }).safeParse(await req.json());
    if (!parsed.success) throw new Error('VALIDATION:Невідома дія.');
    const { action } = parsed.data;
    const jar = await cookies();
    const secure = new URL(req.url).protocol === 'https:';
    if (action === 'logout') {
      await logout();
      return Response.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (action === 'start') {
      const state = await telegramStatus();
      if (!state.configured || !state.username || !state.online)
        throw new Error('VALIDATION:Telegram ще не готовий. Перевірте, що npm run dev запустив бота.');
      const oldBrowser = jar.get(CHALLENGE_COOKIE)?.value;
      if (oldBrowser) await db().prepare('DELETE FROM auth_links WHERE browser_hash = ?').bind(await hash(oldBrowser)).run();
      await db().prepare('DELETE FROM auth_links WHERE expires_at < ?').bind(Date.now()).run();
      const code = nonce().slice(0, 48);
      const browser = nonce();
      // Only the previous local browser can claim its former test-account data.
      // The marker is server-owned and is never accepted from the request body.
      const hostname = new URL(req.url).hostname;
      const legacy = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
        && jar.get('__sites_local_auth')?.value === '1';
      await db().prepare('INSERT INTO auth_links (hash, owner, browser_hash, expires_at, language) VALUES (?, ?, ?, ?, ?)')
        .bind(await hash(code), `pending:${legacy ? 'legacy-local:' : ''}${nonce()}`, await hash(browser), Date.now() + 600000, await requestLanguage()).run();
      jar.set(CHALLENGE_COOKIE, browser, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 600 });
      return Response.json({ url: `https://t.me/${state.username}?start=${code}` });
    }
    const browser = jar.get(CHALLENGE_COOKIE)?.value;
    if (!browser) return Response.json({ confirmed: false });
    const browserHash = await hash(browser);
    await restoreConfirmedLogin(browserHash);
    const row = await db().prepare(`UPDATE auth_links SET used = 1
      WHERE browser_hash = ? AND confirmed = 1 AND used = 0 AND expires_at > ?
      AND owner NOT LIKE 'pending:%' RETURNING owner`)
      .bind(browserHash, Date.now()).first<{ owner: string }>();
    if (!row) return Response.json({ confirmed: false });
    if(jar.get(LANGUAGE_CHOICE_COOKIE)?.value==='1'){
      await db().prepare('UPDATE preferences SET language = ? WHERE owner = ?').bind(languageValue(jar.get(LANGUAGE_COOKIE)?.value),row.owner).run();
      jar.delete(LANGUAGE_CHOICE_COOKIE);
    }
    const token = nonce();
    await db().prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
    await db().prepare('INSERT INTO sessions (hash, owner, expires_at) VALUES (?, ?, ?)')
      .bind(await hash(token), row.owner, Date.now() + 30 * 86400000).run();
    jar.set(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 30 * 86400 });
    const setting=await db().prepare('SELECT language FROM preferences WHERE owner = ?').bind(row.owner).first<{language:string}>();
    jar.set(LANGUAGE_COOKIE,languageValue(setting?.language),{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:365*86400});
    jar.delete(CHALLENGE_COOKIE);
    jar.delete('__sites_local_auth');
    jar.delete('focus_telegram_session');
    jar.delete('focus_telegram_challenge');
    return Response.json({ confirmed: true });
  } catch (e) { return failure(e); }
}
