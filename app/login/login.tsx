'use client';
import { useI18n, LanguageSelector } from '../language-provider';
import { BRAND } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Send, Loader2, ShieldCheck } from 'lucide-react';
type Status = {
    username: string | null;
    online: boolean;
};
async function action(name: string) {
    const res = await fetch('/api/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name }) });
    const body = await res.json() as {
        error?: string;
        url?: string;
        confirmed?: boolean;
    };
    if (!res.ok)
        throw new Error(body.error?.replace(/^VALIDATION:/, '') ?? 'Не вдалося підтвердити вхід.');
    return body;
}
export default function Login({ returnTo }: {
    returnTo: string;
}) {
    const { t } = useI18n();
    const [status, setStatus] = useState<Status | null>(null);
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetch('/api/telegram', { cache: 'no-store' });
                if (!res.ok)
                    throw new Error("Не вдалося перевірити підключення бота.");
                const body = await res.json() as Status;
                if (!cancelled) {
                    setStatus(body);
                    setError('');
                }
            }
            catch (e) {
                if (!cancelled)
                    setError((e as Error).message);
            }
        };
        void load();
        const timer = setInterval(() => void load(), 5000);
        return () => { cancelled = true; clearInterval(timer); };
    }, []);
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const result = await action('complete');
                if (!cancelled && result.confirmed)
                    window.location.replace(returnTo);
            }
            catch (e) {
                if (!cancelled)
                    setError((e as Error).message);
            }
            if (!cancelled)
                timer = setTimeout(() => void poll(), 2000);
        };
        // The private challenge cookie survives reloads and returning from Telegram.
        // Continue completion even when the temporary link state has been reset.
        void poll();
        return () => { cancelled = true; clearInterval(timer); };
    }, [returnTo]);
    const start = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await action('start');
            setUrl(result.url ?? '');
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    return <main className="login-page"><section className="login-panel"><div className="login-language"><LanguageSelector /></div>
    <div className="brand"><span className="brand-symbol">D</span><span>{BRAND}<span className="brand-period">.</span></span></div>
    <span className="login-shield"><ShieldCheck size={32}/></span>
    <h1>{t("Твій особистий простір")}</h1>
    <p>{t("Увійди через Telegram, щоб відкрити свої завдання, нотатки та навчальні теми.")}</p>
    {url ? <div className="login-confirm"><a className="primary-button" href={url} target="_blank" rel="noreferrer"><Send size={18}/>{t("Відкрити Telegram")}</a>
      <p>{t("Відкрий бота й натисни «Start». Після підтвердження сайт відкриється автоматично.")}</p>
      <span className="login-wait"><Loader2 size={16} className="spin"/>{t("Очікую підтвердження…")}</span>
      <button className="text-button" onClick={() => void start()} disabled={busy}>{t("Створити нове посилання")}</button></div>
            : <button className="primary-button" onClick={() => void start()} disabled={busy || !status?.online}>{busy ? <Loader2 size={18} className="spin"/> : <Send size={18}/>}{t("Увійти через Telegram")}</button>}
    {!status ? <p className="login-service">{t("Перевіряю підключення бота…")}</p> : !status.online ? <p className="login-service">{t('Бот ще не підключений. Запустіть сайт і Telegram разом через {command}.', { command: 'npm run dev' })}</p> : <p className="login-service">{t('Бот: @{username}', { username: status.username ?? '' })}</p>}
    {error && <p role="alert" className="login-error">{t(error)}</p>}
  </section></main>;
}
