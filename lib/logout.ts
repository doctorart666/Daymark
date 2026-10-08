import { cookies } from 'next/headers';
import { CHALLENGE_COOKIE, SESSION_COOKIE, db, hash } from './server';

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const challenge = jar.get(CHALLENGE_COOKIE)?.value;
  const statements = [];
  if (token) statements.push(db().prepare('DELETE FROM sessions WHERE hash = ?').bind(await hash(token)));
  if (challenge) statements.push(db().prepare('DELETE FROM auth_links WHERE browser_hash = ?').bind(await hash(challenge)));
  if (statements.length) await db().batch(statements);
  for (const name of [SESSION_COOKIE, CHALLENGE_COOKIE, '__sites_local_auth', 'focus_telegram_session', 'focus_telegram_challenge']) {
    jar.set(name, '', { path: '/', httpOnly: true, sameSite: 'strict', maxAge: 0, expires: new Date(0) });
  }
}
