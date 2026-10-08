import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Both children belong to this foreground command. Nothing is installed or
// detached; a child failure also stops its sibling.
export async function runTogether({ site, bot, ready, cwd = root }) {
  const children = new Set();
  const shutdown = new AbortController();
  let exitCode = 0;
  let resolveStopped;
  const stopped = new Promise(resolve => { resolveStopped = resolve; });

  function stop(code = 0) {
    if (shutdown.signal.aborted) return;
    exitCode = code;
    shutdown.abort();
    for (const child of children) child.kill('SIGTERM');
    const force = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
    }, 5000);
    force.unref();
    resolveStopped();
  }

  function launch(command) {
    const child = spawn(command.program, command.args, {
      cwd, env: command.env ?? process.env, stdio: 'inherit',
    });
    children.add(child);
    const closed = new Promise(resolve => {
      child.once('close', (code, signal) => {
        children.delete(child);
        if (!shutdown.signal.aborted) {
          if (code || signal) console.error('Один із процесів завершився. Зупиняю обидва.');
          stop(code ?? 1);
        }
        resolve();
      });
    });
    child.once('error', () => {
      console.error('Не вдалося запустити процес.');
      stop(1);
    });
    return closed;
  }

  const onSignal = () => stop(0);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const closed = [launch(site)];
  try {
    await ready(shutdown.signal);
    if (!shutdown.signal.aborted) {
      closed.push(launch(bot));
      console.log('Сайт і Telegram запущено разом. Зупинка — Ctrl+C.');
    }
  } catch {
    if (!shutdown.signal.aborted) {
      console.error('Локальний сайт не готовий до підключення Telegram. Зупиняю запуск.');
      stop(1);
    }
  }
  await stopped;
  await Promise.all(closed);
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  return exitCode;
}

async function main() {
  const args = process.argv.slice(2);
  const index = args.findIndex(arg => arg === '--port' || arg === '-p');
  const port = Number(index >= 0 ? args[index + 1] :
    args.find(arg => arg.startsWith('--port='))?.slice(7) ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Некоректний порт локального сервера.');
  }
  let botEnv, localEnv;
  try {
    botEnv = parseEnv(readFileSync(resolve(root, 'telegram/.env'), 'utf8'));
    localEnv = parseEnv(readFileSync(resolve(root, '.dev.vars'), 'utf8'));
  } catch {
    throw new Error('Для спільного запуску потрібні telegram/.env і .dev.vars.');
  }
  if (!botEnv.TELEGRAM_BOT_TOKEN || !localEnv.TELEGRAM_SERVICE_SECRET) {
    throw new Error('Додайте TELEGRAM_BOT_TOKEN у telegram/.env і TELEGRAM_SERVICE_SECRET у .dev.vars.');
  }
  const origin = `http://127.0.0.1:${port}`;
  const secret = localEnv.TELEGRAM_SERVICE_SECRET;
  const code = await runTogether({
    site: {
      program: process.execPath,
      args: [resolve(root, 'scripts/run-framework.mjs'), 'dev', '--hostname', '127.0.0.1', ...args],
    },
    bot: {
      program: process.execPath,
      args: [resolve(root, 'telegram/service.mjs')],
      env: {
        ...process.env, ...botEnv,
        SITE_URL: origin,
        TELEGRAM_SERVICE_SECRET: secret,
        SITES_ACCESS_TOKEN: '',
        TELEGRAM_STATE_DIR: resolve(root, '.telegram-state/local'),
      },
    },
    async ready(signal) {
      const deadline = Date.now() + 60000;
      while (!signal.aborted && Date.now() < deadline) {
        try {
          const response = await fetch(new URL('/api/service', origin), {
            method: 'POST', redirect: 'error',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
            body: JSON.stringify({ action: 'health' }),
            signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
          });
          if (response.ok && (await response.json()).ok) return;
          if (response.status === 403) {
            throw new Error('Local service secret does not match.');
          }
        } catch {
          if (signal.aborted) throw new Error('Stopped');
        }
        await pause(300, undefined, { signal });
      }
      throw new Error('Local site readiness timed out.');
    },
  });
  process.exitCode = code;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
