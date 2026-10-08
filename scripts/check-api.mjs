import assert from 'node:assert/strict';
const base = process.env.FOCUS_TEST_BASE_URL;
const secret = process.env.FOCUS_TEST_SERVICE_SECRET;
if (!base || !secret || new URL(base).port === '5173' || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Run only against an isolated local test database, with FOCUS_TEST_BASE_URL and FOCUS_TEST_SERVICE_SECRET.');
function client(initialCookie = '') {
  let cookie = initialCookie;
  return async (path, data, options = {}) => {
    const res = await fetch(base + path, {
      method: options.method ?? (data === undefined ? 'GET' : 'POST'), redirect: 'manual',
      headers: { Cookie: cookie, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(data !== undefined || options.method === 'POST' ? { Origin: options.origin ?? base } : {}), ...options.headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    for (const value of res.headers.getSetCookie()) {
      const part = value.split(';')[0], name = part.split('=')[0];
      cookie = cookie.split('; ').filter(x => !x.startsWith(name + '=')).concat(part).join('; ');
    }
    const text = await res.text();
    let result; try { result = JSON.parse(text); } catch { result = { text }; }
    if (!options.allowError) assert.ok(res.ok, `${path}: ${res.status} ${JSON.stringify(result)}`);
    return { res, result, cookie };
  };
}
const a = client('__sites_local_auth=1; focus_telegram_session=old-fake-session');
const b = client();
const bridge = client();
const recovered = client('focus_login_challenge=confirmed-legacy-browser; focus_session=pending-owner-session');
async function service(action, args = {}) {
  return (await bridge('/api/service', { action, ...args }, { headers: { Authorization: `Bearer ${secret}` } })).result;
}
for (const path of ['/', '/tasks', '/notes', '/learn', '/settings']) {
  const { res } = await a(path, undefined, { allowError: true });
  assert.equal(res.status, 307);
  assert.ok(res.headers.get('location').startsWith('/login'));
}
assert.equal((await a('/api/workspace', undefined, { allowError: true })).res.status, 401);
assert.equal((await b('/api/workspace', undefined, { allowError: true, headers: { 'oai-authenticated-user-id': 'local_seedy', 'oai-authenticated-user-email': 'spoof@example.com' } })).res.status, 401);
assert.equal((await a('/api/entries', {}, { allowError: true })).res.status, 401);
assert.equal((await a('/api/preferences', {}, { allowError: true })).res.status, 401);
assert.equal((await bridge('/api/service', { action: 'health' }, { allowError: true })).res.status, 403);
const login = await a('/login');
assert.ok(login.result.text.includes('Увійти через Telegram'));
assert.ok(!login.result.text.includes('signin-with-chatgpt'));
assert.equal((await recovered('/api/workspace', undefined, { allowError: true })).res.status, 401, 'A temporary account must never grant access.');
assert.equal((await b('/api/telegram', { action: 'complete' })).result.confirmed, false);
assert.equal((await recovered('/api/telegram', { action: 'complete' })).result.confirmed, true, 'A browser-bound Telegram confirmation stored under a temporary owner must complete.');
assert.equal((await recovered('/api/telegram', { action: 'complete' })).result.confirmed, false);
const recoveredWorkspace = (await recovered('/api/workspace')).result;
assert.equal(recoveredWorkspace.preferences.telegramId, '900000000000003');
assert.equal(recoveredWorkspace.displayName, 'QA recovery');
assert.ok(recoveredWorkspace.entries.some(e => e.title === 'Recovered fixture'));
await recovered('/api/telegram', { action: 'logout' });
await service('heartbeat', { username: 'focus_test_bot' });
assert.equal((await a('/api/telegram', { action: 'complete' })).result.confirmed, false);
const start = (await a('/api/telegram', { action: 'start' })).result;
const code = new URL(start.url).searchParams.get('start');
assert.equal((await service('confirm', { code: 'f'.repeat(48), chatId: '900000000000001', name: 'QA A' })).ok, false);
assert.equal((await service('confirm', { code, chatId: '900000000000001', name: 'QA A' })).ok, true);
assert.equal((await service('confirm', { code, chatId: '900000000000002', name: 'QA B' })).ok, false);
assert.equal((await b('/api/telegram', { action: 'complete' })).result.confirmed, false);
assert.equal((await a('/api/workspace', undefined, { allowError: true })).res.status, 401);
const completed = await a('/api/telegram', { action: 'complete' });
assert.equal(completed.result.confirmed, true);
assert.ok(completed.res.headers.getSetCookie().some(value => value.startsWith('focus_session=') && value.toLowerCase().includes('httponly') && value.toLowerCase().includes('samesite=strict')));
assert.equal((await a('/api/telegram', { action: 'complete' })).result.confirmed, false);
let workspace = (await a('/api/workspace')).result;
assert.equal(workspace.displayName, 'QA A');
assert.ok(workspace.entries.some(e => e.title === 'Legacy fixture'), 'Former local record must survive verified Telegram login.');
assert.equal(workspace.preferences.telegramId, '900000000000001');
await a('/api/preferences', { ...workspace.preferences, morningEnabled: false, telegramRequired: false });
assert.equal((await a('/api/workspace')).result.preferences.telegramRequired, true);
const created = [];
for (const kind of ['task', 'note', 'topic']) {
  created.push((await a('/api/entries', { kind, title: `Test ${kind}`, topic: 'QA', blocks: [{ id: crypto.randomUUID(), type: 'code', content: 'const test = true;', language: 'typescript' }], status: 'todo', priority: 'normal', dueAt: kind === 'task' ? new Date(Date.now() + 15 * 60000).toISOString() : null })).result);
}
workspace = (await a('/api/workspace')).result;
for (const entry of created) assert.ok(workspace.entries.some(e => e.id === entry.id && e.blocks[0].content === 'const test = true;'));
let task = (await a('/api/entries', { ...created[0], title: 'Edited task' })).result;
assert.equal(task.title, 'Edited task');
assert.equal((await a('/api/entries', { ...task, title: '' }, { allowError: true })).res.status, 400);
assert.equal((await a('/api/entries', task, { origin: 'https://evil.invalid', allowError: true })).res.status, 403);
const bStart = (await b('/api/telegram', { action: 'start' })).result;
await service('confirm', { code: new URL(bStart.url).searchParams.get('start'), chatId: '900000000000002', name: 'QA B' });
assert.equal((await b('/api/telegram', { action: 'complete' })).result.confirmed, true);
assert.equal((await b('/api/workspace')).result.entries.length, 0);
assert.equal((await b('/api/entries', { ...task, title: 'Stolen' }, { allowError: true })).res.status, 400);
await b('/api/entries', { id: task.id }, { method: 'DELETE' });
assert.ok((await a('/api/workspace')).result.entries.some(e => e.id === task.id && e.title === 'Edited task'));
let jobs = (await service('tick')).jobs;
assert.equal(jobs.length, 1); assert.equal(jobs[0].chat_id, '900000000000001');
await service('ack', { id: jobs[0].id, status: 'sent' });
assert.equal((await service('tick')).jobs.length, 0);
task = (await a('/api/entries', { ...task, dueAt: new Date(Date.now() + 20 * 60000).toISOString() })).result;
jobs = (await service('tick')).jobs; assert.equal(jobs.length, 1);
await service('ack', { id: jobs[0].id, status: 'sent' });
await a('/api/entries', { ...task, status: 'done' });
assert.equal((await service('tick')).jobs.length, 0);
const signedLogin = await a('/login?return_to=https://evil.invalid', undefined, { allowError: true });
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const weekday = new Date(day + 'T12:00:00Z').getUTCDay() || 7;
const baseRepeat = { ...created[0], id: undefined, dueAt: null, status: 'todo', title: 'Daily recurring', repeat: { days: [1,2,3,4,5,6,7], time: null } };
let daily = (await a('/api/entries', baseRepeat)).result;
assert.deepEqual(daily.repeat, baseRepeat.repeat); assert.equal(daily.occurrenceDate, day); assert.equal(daily.dueAt, null);
let weekly = (await a('/api/entries', { ...baseRepeat, title: 'Weekly recurring', repeat: { days: [weekday % 7 + 1], time: null } })).result;
assert.notEqual(weekly.occurrenceDate, day);
for (const repeat of [{ days: [], time: null }, { days: [0], time: null }, { days: [1,1], time: null }, { days: [1], time: '25:00' }])
  assert.equal((await a('/api/entries', { ...baseRepeat, repeat }, { allowError: true })).res.status, 400);
assert.equal((await a('/api/entries', { ...baseRepeat, kind: 'note' }, { allowError: true })).res.status, 400);
assert.equal((await a('/api/entries', { ...daily, status: 'done', occurrenceDate: '2000-01-01' }, { allowError: true })).res.status, 400);
assert.equal((await b('/api/entries', { ...daily, title: 'Stolen recurring' }, { allowError: true })).res.status, 400);
await a('/api/preferences', { ...workspace.preferences, morningEnabled: true, morningTime: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()) });
const morningJobs = (await service('tick')).jobs;
assert.equal(morningJobs.length, 1); assert.ok(morningJobs[0].id.startsWith('morning:'));
assert.ok(morningJobs[0].message.includes('Daily recurring')); assert.ok(!morningJobs[0].message.includes('Weekly recurring'));
await service('ack', { id: morningJobs[0].id, status: 'sent' });
assert.equal((await service('tick')).jobs.length, 0);
await a('/api/preferences', { ...workspace.preferences, morningEnabled: false });
daily = (await a('/api/entries', { ...daily, status: 'done' })).result;
assert.equal(daily.status, 'done'); assert.equal(daily.statusDate, day);
assert.equal((await a('/api/workspace')).result.entries.find(entry => entry.id === daily.id).status, 'done');
const slot = new Date(Date.now() + 15 * 60000);
const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(slot);
let timed = (await a('/api/entries', { ...baseRepeat, title: 'Timed recurring', repeat: { days: [1,2,3,4,5,6,7], time } })).result;
const timedJobs = (await service('tick')).jobs;
assert.equal(timedJobs.length, 1); assert.ok(timedJobs[0].message.includes('Timed recurring'));
await service('ack', { id: timedJobs[0].id, status: 'sent' });
assert.equal((await service('tick')).jobs.length, 0);
weekly = (await a('/api/entries', { ...weekly, repeat: { days: [weekday], time: null } })).result;
assert.equal(weekly.occurrenceDate, day); assert.equal(weekly.status, 'todo');
timed = (await a('/api/entries', { ...timed, repeat: null, dueAt: null })).result;
assert.equal(timed.repeat, null); assert.equal(timed.occurrenceDate, null); assert.equal(timed.statusDate, null);
created.push(daily, weekly, timed);
assert.equal(signedLogin.res.status, 307); assert.equal(signedLogin.res.headers.get('location'), '/tasks');
const protectedPage = await a('/tasks');
assert.match(protectedPage.result.text, /<form[^>]*action="\/logout"[^>]*method="post"/);
const pending = (await a('/api/telegram', { action: 'start' })).result;
const replay = client((await a('/api/workspace')).cookie);
assert.equal((await a('/logout', undefined, { method: 'POST', origin: 'https://evil.invalid', allowError: true })).res.status, 403);
assert.equal((await a('/api/workspace')).res.status, 200);
const loggedOut = await a('/logout', undefined, { method: 'POST', allowError: true });
assert.equal(loggedOut.res.status, 303);
assert.equal(loggedOut.res.headers.get('location'), '/login');
assert.equal(loggedOut.res.headers.get('cache-control'), 'private, no-store');
for (const name of ['focus_session', 'focus_login_challenge']) {
  assert.ok(loggedOut.res.headers.getSetCookie().some(value => value.startsWith(name + '=;') && value.toLowerCase().includes('max-age=0') && value.toLowerCase().includes('path=/')));
}
assert.equal((await replay('/api/workspace', undefined, { allowError: true })).res.status, 401, 'A retained cookie must not revive a revoked session.');
assert.equal((await service('confirm', { code: new URL(pending.url).searchParams.get('start'), chatId: '900000000000001', name: 'QA A' })).ok, false, 'Logout must invalidate an outstanding login link.');
assert.equal((await replay('/api/telegram', { action: 'complete' })).result.confirmed, false);
assert.equal((await a('/api/workspace', undefined, { allowError: true })).res.status, 401);
assert.equal((await a('/api/entries', task, { allowError: true })).res.status, 401);
assert.equal((await a('/tasks', undefined, { allowError: true })).res.status, 307);
assert.equal((await a('/login')).res.status, 200);
assert.equal((await a('/logout', undefined, { method: 'POST', allowError: true })).res.status, 303, 'Logout should also work after session expiration.');
const again = (await a('/api/telegram', { action: 'start' })).result;
await service('confirm', { code: new URL(again.url).searchParams.get('start'), chatId: '900000000000001', name: 'QA A' });
await a('/api/telegram', { action: 'complete' });
assert.ok((await a('/api/workspace')).result.entries.some(e => e.id === task.id));
for (const entry of created) await a('/api/entries', { id: entry.id }, { method: 'DELETE' });
const apiReplay = client((await a('/api/workspace')).cookie);
await a('/api/telegram', { action: 'logout' });
assert.equal((await apiReplay('/api/workspace', undefined, { allowError: true })).res.status, 401);
console.log('Passed: recurring CRUD/weekday validation/day-specific completion/morning/deadline deduplication; recovery of confirmed temporary account; new login after temporary account; native form logout/redirect; revoked-cookie replay denied; pending login cancelled; idempotent logout; pages/API require Telegram; account isolation; logout/re-login; former record preserved; CRUD/code blocks; reminder deduplication.');
