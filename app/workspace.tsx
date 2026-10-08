'use client';
import { useI18n, LanguageSelector } from './language-provider';
import { BRAND, locales, countLabel } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Check, CheckCheck, ClipboardList, Code2, Copy, FileText, Flag, Layers3, Plus, Settings2, Trash2, Sun, Clock3, Send, ChevronUp, ChevronDown, NotebookPen, CalendarDays, Loader2, LogOut, ShieldCheck, Repeat2 } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty';
import { Toaster, toast } from 'sonner';
import type { Entry, Block, WorkspaceData, Preferences } from '@/lib/models';
import { dateLabel, dayKey, kinds, localDateInput, statusLabels, zonedToISO } from '@/lib/models';
import { addDays, projectEntry, repeatLabel, weekdays } from '@/lib/recurrence';
const sections = [{ id: 'task', href: '/tasks', label: 'Завдання', icon: ClipboardList }, { id: 'note', href: '/notes', label: 'Нотатки', icon: NotebookPen }, { id: 'topic', href: '/learn', label: 'Навчання', icon: BookOpen }];
function Picker({ value, onChange, items, label }: {
    value: string;
    onChange: (v: string) => void;
    items: Record<string, string>;
    label: string;
}) { const { t } = useI18n(); return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(items).map(([v, label]) => <SelectItem value={v} key={v}>{t(label)}</SelectItem>)}</SelectContent></Select>; }
async function request<T>(path: string, data?: unknown, method = 'POST'): Promise<T> { const r = await fetch(path, { method: data === undefined ? 'GET' : method, headers: data === undefined ? undefined : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store' }); const result = await r.json() as T & {
    error?: string;
}; if (!r.ok) {
    if (r.status === 401)
        window.location.replace('/login?return_to=' + encodeURIComponent(window.location.pathname + window.location.search));
    throw new Error(result.error ?? 'Не вдалося виконати дію.');
} return result; }
export default function Workspace({ section = 'task' }: {
    section?: 'task' | 'note' | 'topic' | 'settings';
}) {
    const { t, language } = useI18n();
    const [data, setData] = useState<WorkspaceData | null>(null);
    const [loadError, setLoadError] = useState('');
    const [filter, setFilter] = useState('active');
    const [editor, setEditor] = useState<Partial<Entry> | null>(null);
    const [remove, setRemove] = useState<Entry | null>(null);
    const [busy, setBusy] = useState(false);
    const [telegramUrl, setTelegramUrl] = useState('');
    const [now, setNow] = useState(() => Date.now());
    const refresh = useCallback(async () => { try {
        const d = await request<WorkspaceData>('/api/workspace');
        setData(d);
        setLoadError('');
        return d;
    }
    catch (e) {
        setLoadError((e as Error).message);
        throw e;
    } }, []);
    useEffect(() => { let cancelled = false; void request<WorkspaceData>('/api/workspace').then(d => { if (cancelled)
        return; setData(d); const id = new URLSearchParams(window.location.search).get('entry'); const found = d.entries.find(x => x.id === id); if (found)
        setEditor(found); }).catch(e => { if (!cancelled)
        setLoadError(e.message); }); const clock = setInterval(() => setNow(Date.now()), 30000); return () => { cancelled = true; clearInterval(clock); }; }, []);
    const openEditor = useCallback((entry: Partial<Entry>) => { setEditor(entry); if (entry.id) {
        const url = new URL(window.location.href);
        url.searchParams.set('entry', entry.id);
        window.history.replaceState(null, '', url.pathname + url.search);
    } }, []);
    const closeEditor = () => { setEditor(null); const url = new URL(window.location.href); url.searchParams.delete('entry'); window.history.replaceState(null, '', url.pathname + url.search); };
    const create = useCallback(() => openEditor({ kind: section === 'settings' ? 'task' : section, title: '', topic: '', blocks: [{ id: crypto.randomUUID(), type: 'text', content: '' }], status: 'todo', priority: 'normal', dueAt: null, repeat: null }), [section, openEditor]);
    useEffect(() => { const context = (navigator as Navigator & {
        modelContext?: {
            registerTool: (tool: unknown, options: {
                signal: AbortSignal;
            }) => Promise<void>;
        };
    }).modelContext; if (!context?.registerTool)
        return; const lifecycle = new AbortController(); const tools = [{ name: 'list_entries', title: t("Список записів"), description: t("Прочитати збережені завдання, нотатки та навчальні теми."), inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async () => { const d = await refresh(); return { entries: d.entries }; } }, { name: 'start_entry_creation', title: t("Відкрити редактор"), description: t("Відкрити редактор нового запису. Запис ще не зберігається."), inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async () => { create(); return { editor: 'open', saved: false }; } }]; for (const tool of tools) {
        try {
            void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => { });
        }
        catch { }
    } return () => lifecycle.abort(); }, [refresh, create, t]);
    const save = async (e: Partial<Entry>) => { setBusy(true); try {
        const saved = await request<Entry>('/api/entries', e);
        setData(d => d ? { ...d, entries: [saved, ...d.entries.filter(x => x.id !== saved.id)] } : d);
        closeEditor();
        toast.success(t("Запис збережено"));
    }
    catch (error) {
        toast.error(t((error as Error).message));
    }
    finally {
        setBusy(false);
    } };
    const toggle = async (e: Entry) => { setBusy(true); try {
        const updated = await request<Entry>('/api/entries', { ...e, status: e.status === 'done' ? 'todo' : 'done' });
        setData(d => d ? { ...d, entries: d.entries.map(x => x.id === e.id ? updated : x) } : d);
    }
    catch (error) {
        toast.error(t((error as Error).message));
    }
    finally {
        setBusy(false);
    } };
    const deleteEntry = async () => { if (!remove)
        return; setBusy(true); try {
        await request('/api/entries', { id: remove.id }, 'DELETE');
        setData(d => d ? { ...d, entries: d.entries.filter(x => x.id !== remove.id) } : d);
        setRemove(null);
        toast.success(t("Запис видалено"));
    }
    catch (error) {
        toast.error(t((error as Error).message));
    }
    finally {
        setBusy(false);
    } };
    const connect = async () => { setBusy(true); try {
        const r = await request<{
            url: string;
        }>('/api/telegram', { action: 'start' });
        setTelegramUrl(r.url);
    }
    catch (error) {
        toast.error(t((error as Error).message));
    }
    finally {
        setBusy(false);
    } };
    useEffect(() => { if (!telegramUrl)
        return; let stopped = false; const timer = setInterval(() => { void request<{
        confirmed: boolean;
    }>('/api/telegram', { action: 'complete' }).then(async (r) => { if (r.confirmed && !stopped) {
        setTelegramUrl('');
        await refresh();
        toast.success(t("Telegram підтверджено"));
    } }).catch(() => { }); }, 2500); return () => { stopped = true; clearInterval(timer); }; }, [telegramUrl, refresh, t]);
    const timezone = data?.preferences.timezone ?? 'Europe/Berlin';
    const today = dayKey(new Date(now), timezone);
    const entries = (data?.entries ?? []).map(e => projectEntry(e, timezone, new Date(now)));
    const tasks = entries.filter(x => x.kind === 'task');
    const active = tasks.filter(x => x.status !== 'done');
    const overdue = active.filter(x => x.status==='overdue');
    const isToday = (entry: Entry) => entry.repeat ? entry.occurrenceDate === today : !!entry.dueAt && dayKey(new Date(entry.dueAt), timezone) === today;
    const todayTasks = active.filter(isToday);
    const next = [...active].filter(x => x.dueAt && Date.parse(x.dueAt) > now).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))[0];
    const scheduledLabel = (entry: Entry) => entry.dueAt ? dateLabel(entry.dueAt, timezone, language) : entry.repeat && entry.occurrenceDate ? (entry.occurrenceDate === today ? t("Сьогодні") : entry.occurrenceDate === addDays(today, 1) ? t("Завтра") : new Intl.DateTimeFormat(locales[language], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(entry.occurrenceDate + 'T12:00:00Z'))) : t("Без дедлайну");
    const sortDate = (entry: Entry) => entry.dueAt ? localDateInput(entry.dueAt, timezone) : entry.occurrenceDate ? entry.occurrenceDate + 'T23:59' : '9999';
    const filtered = entries.filter(x => x.kind === section).filter(x => section !== 'task' || filter === 'all' || filter === 'active' && x.status !== 'done' || filter === 'today' && isToday(x) || filter === 'recurring' && !!x.repeat || filter === 'done' && x.status === 'done').sort((a, b) => section === 'task' ? Number(a.status === 'done') - Number(b.status === 'done') || sortDate(a).localeCompare(sortDate(b)) : b.updatedAt.localeCompare(a.updatedAt));
    const title = t(section === 'settings' ? 'Налаштування' : kinds[section]);
    return <SidebarProvider style={{ '--sidebar-width': '16rem' } as React.CSSProperties}><Toaster richColors position="bottom-right"/><Sidebar className="focus-sidebar"><SidebarHeader><Link href="/tasks" className="brand"><span className="brand-symbol">D</span><span>{BRAND}<span className="brand-period">.</span></span></Link><div className="workspace-label"><span className="workspace-avatar">D</span><div>{t("Мій простір")}<small>{t("Особистий")}</small></div><Layers3 size={17}/></div></SidebarHeader><SidebarContent><div className="nav-label">{t("РОБОЧИЙ ПРОСТІР")}</div><SidebarMenu>{sections.map(s => <SidebarMenuItem key={s.id}><SidebarMenuButton asChild isActive={section === s.id}><Link href={s.href}><s.icon /><span>{t(s.label)}</span><span className="nav-count">{entries.filter(x => x.kind === s.id && (x.kind !== 'task' || x.status !== 'done')).length}</span></Link></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu><div className="sidebar-line"/><div className="sidebar-reminder"><Sun size={19}/><div>{t("Ранковий підсумок")}<strong>{data?.preferences.morningTime ?? '08:00'}</strong><small>{timezone.replace('Europe/', '')}</small></div></div></SidebarContent><SidebarFooter><Link href="/settings" className={`settings-link ${section === 'settings' ? 'selected' : ''}`}><Settings2 size={19}/>{t("Налаштування")}</Link><div className="profile"><span className="profile-avatar">{data?.displayName?.[0]?.toUpperCase() ?? 'D'}</span><div><strong>{data?.displayName ? data.displayName : t("Мій простір")}</strong><small>{t("Особистий кабінет")}</small></div><form action="/logout" method="post"><button type="submit" className="icon-button" aria-label={t("Вийти з акаунта")} title={t("Вийти з акаунта")}><LogOut size={17}/></button></form></div></SidebarFooter></Sidebar><SidebarInset><header className="topbar"><div className="breadcrumb"><SidebarTrigger /><span>{t("Мій простір")}</span><span className="crumb-slash">/</span><strong>{title}</strong></div><div className="topbar-tools"><LanguageSelector /><span className="today-date"><CalendarDays size={16}/>{new Intl.DateTimeFormat(locales[language], { timeZone: timezone, day: 'numeric', month: 'long', weekday: 'short' }).format(new Date(now))}</span></div></header><div className="workspace-main"><div className="page-heading"><div><div className="eyebrow">{section === 'task' ? t("ПЛАНУЙ. ВИКОНУЙ. РУХАЙСЯ ДАЛІ.") : section === 'note' ? t("ДУМКИ, ДО ЯКИХ ВАРТО ПОВЕРНУТИСЯ") : section === 'topic' ? t("ТВІЙ ПРОСТІР ДЛЯ ЗНАНЬ") : t("ОСОБИСТИЙ ПРОСТІР")}</div><h1>{title}<span className="title-dot">.</span></h1><p>{section === 'task' ? t("Усе, що потрібно зробити, — в одному місці.") : section === 'note' ? t("Зберігай ідеї, пояснення та фрагменти коду.") : section === 'topic' ? t("Розкривай теми крок за кроком, з прикладами та кодом.") : t("Нагадування та підключення Telegram.")}</p></div>{section !== 'settings' && <button className="primary-button" onClick={create} disabled={!data || data.telegram.gate}><Plus size={18}/>{section === 'task' ? t("Нове завдання") : section === 'note' ? t("Нова нотатка") : t("Нова тема")}</button>}</div>
 {loadError ? <div className="error-state" role="alert"><strong>{t("Не вдалося завантажити простір")}</strong><p>{t(loadError)}</p><button className="secondary-button" onClick={() => void refresh().catch(() => { })}>{t("Спробувати ще раз")}</button></div> : !data ? <div className="loading-grid"><Skeleton className="h-24"/><Skeleton className="h-24"/><Skeleton className="h-72 col-span-2"/></div> : data.telegram.gate ? <div className="auth-card"><ShieldCheck size={38}/><h2>{t("Підтвердьте вхід через Telegram")}</h2><p>{t("Використайте підключений акаунт, щоб відкрити свої записи.")}</p><button onClick={connect} disabled={busy || !data.telegram.online} className="primary-button"><Send size={18}/>{t("Підтвердити в Telegram")}</button>{!data.telegram.online && <p className="helper">{t("Бот офлайн. Запустіть сайт і Telegram разом через npm run dev.")}</p>}{telegramUrl && <div className="telegram-confirm"><a className="secondary-button" href={telegramUrl} target="_blank" rel="noreferrer">{t("Відкрити бота")}</a><span><Loader2 className="spin" size={16}/>{t("Очікую підтвердження…")}</span></div>}</div> : section === 'settings' ? <SettingsPanel key={JSON.stringify(data.preferences)} data={data} onRefresh={refresh} onConnect={connect} busy={busy} telegramUrl={telegramUrl}/> : <>
 {section === 'task' && <div className="stats-strip"><div><span className="stat-icon violet"><ClipboardList size={20}/></span><div><span>{t("До виконання")}</span><strong>{active.length.toString().padStart(2, '0')}</strong></div></div><div><span className="stat-icon blue"><Sun size={20}/></span><div><span>{t("На сьогодні")}</span><strong>{todayTasks.length.toString().padStart(2, '0')}</strong></div></div><div><span className="stat-icon orange"><Clock3 size={20}/></span><div><span>{t("Прострочено")}</span><strong>{overdue.length.toString().padStart(2, '0')}</strong></div></div><div><span className="stat-icon green"><CheckCheck size={20}/></span><div><span>{t("Виконано")}</span><strong>{tasks.filter(x => x.status === 'done').length.toString().padStart(2, '0')}</strong></div></div></div>}
 <div className="content-grid"><section className="records-panel"><div className="panel-toolbar">{section === 'task' ? <Tabs value={filter} onValueChange={setFilter}><TabsList variant="line"><TabsTrigger value="active">{t("Активні")}<span>{active.length}</span></TabsTrigger><TabsTrigger value="today">{t("Сьогодні")}</TabsTrigger><TabsTrigger value="recurring">{t("Постійні")}</TabsTrigger><TabsTrigger value="done">{t("Виконані")}</TabsTrigger><TabsTrigger value="all">{t("Усі")}</TabsTrigger></TabsList></Tabs> : <h2>{section === 'note' ? t("Мої нотатки") : t("Мої теми")} <span className="subtle-count">{filtered.length}</span></h2>}<span className="sort-label">{section === 'task' ? t("За дедлайном") : t("Нещодавно змінені")}</span></div>
 {section === 'task' && filtered.length > 0 && <div className="list-column-head"><span>{t("ЗАВДАННЯ")}</span><span>{t("СТАТУС")}</span><span>{t("КОЛИ")}</span></div>}
 {filtered.length === 0 ? <Empty className="workspace-empty"><EmptyHeader><EmptyMedia variant="icon">{section === 'task' ? <ClipboardList /> : section === 'note' ? <NotebookPen /> : <BookOpen />}</EmptyMedia><EmptyTitle>{section === 'task' ? (filter === 'done' ? t("Виконаних завдань ще немає") : filter === 'today' ? t("На сьогодні немає завдань") : filter === 'recurring' ? t("Додай своє перше постійне завдання") : filter === 'all' ? t("Почни з першого завдання") : t("Тут з’являться твої завдання")) : section === 'note' ? t("Збережи свою першу ідею") : t("Яку тему вивчатимеш далі?")}</EmptyTitle><EmptyDescription>{section === 'task' ? t("Додай опис, дедлайн або дні повторення та потрібні фрагменти коду.") : section === 'note' ? t("Додай текст, заголовки та блоки коду до нотатки.") : t("Створи тему й наповнюй її поясненнями та прикладами.")}</EmptyDescription></EmptyHeader><EmptyContent><button className="secondary-button" onClick={create}><Plus size={17}/>{section === 'task' ? t("Додати завдання") : section === 'note' ? t("Додати нотатку") : t("Додати тему")}</button></EmptyContent></Empty> : section === 'task' ? <div className="task-list">{filtered.map(e => <div className={`task-row ${e.status === 'done' ? 'is-done' : ''}`} key={e.id}><div className="task-name"><Checkbox checked={e.status === 'done'} disabled={busy} onCheckedChange={() => void toggle(e)} aria-label={t(e.status === 'done' ? 'Позначити «{title}» невиконаним' : 'Позначити «{title}» виконаним', { title: e.title })}/><button onClick={() => openEditor(e)}><strong>{e.title}</strong><span>{e.topic || t("Без теми")}{e.repeat && <><Repeat2 size={13}/>{repeatLabel(e.repeat, language)}</>}{e.blocks.some(b => b.type === 'code') && <><Code2 size={13}/>{t("Код")}</>}</span></button>{e.priority === 'high' && <Flag size={15} className="high-priority"/>}</div><span className={`status-tag ${e.status}`}>{t(statusLabels[e.status])}</span><div className="task-due"><span className={e.status==='overdue' ? 'overdue' : ''}>{scheduledLabel(e)}</span><button className="icon-button delete-hover" aria-label={t("Видалити {title}", { title: e.title })} onClick={() => setRemove(e)}><Trash2 size={15}/></button></div></div>)}</div> : <div className="note-grid">{filtered.map(e => <article className="note-card" key={e.id}><button className="note-open" onClick={() => openEditor(e)}><span className={`note-icon ${section === 'topic' ? 'violet' : 'blue'}`}>{section === 'topic' ? <BookOpen size={22}/> : <FileText size={22}/>}</span><span className="note-topic">{e.topic || (section === 'topic' ? t("Навчальна тема") : t("Нотатка"))}</span><h3>{e.title}</h3><p>{e.blocks.filter(x => x.type !== 'code').map(x => x.content).join(' ').slice(0, 160) || t("Додай пояснення та приклади.")}</p></button><footer><span>{e.blocks.some(x => x.type === 'code') ? <><Code2 size={14}/>{t("Є код")}</> : countLabel(e.blocks.length, 'block', language)}</span><button className="icon-button" aria-label={`Видалити ${e.title}`} onClick={() => setRemove(e)}><Trash2 size={15}/></button></footer></article>)}</div>}
 <div className="panel-footer"><span>{countLabel(filtered.length, section === 'task' ? 'task' : 'entry', language)}</span><span><ShieldCheck size={14}/>{t("Збережено у твоєму просторі")}</span></div></section><aside className="right-rail"><section className="telegram-card"><div className="rail-heading"><span className="telegram-icon"><Send size={21}/></span><span className={`connection-tag ${data.telegram.online && data.preferences.telegramId ? 'connected' : ''}`}>{!data.preferences.telegramId ? t("Не підключено") : data.telegram.online ? t("Підключено") : t("Сервіс офлайн")}</span></div><h2>{t("Daymark у Telegram")}</h2><p>{t("Твої плани на день і нагадування перед дедлайном.")}</p><div className="reminder-line"><Sun size={17}/><div>{t("Ранковий підсумок")}<strong>{data.preferences.morningTime}</strong></div></div><div className="reminder-line"><Clock3 size={17}/><div>{t("Перед дедлайном")}<strong>{t("За 30 хвилин")}</strong></div></div><Link className="rail-link" href="/settings"><Settings2 size={16}/>{data.preferences.telegramId ? t("Налаштувати нагадування") : t("Підключити Telegram")}</Link></section><section className="next-card"><div className="mini-heading"><Clock3 size={16}/>{t("НАЙБЛИЖЧИЙ ДЕДЛАЙН")}</div>{next ? <><h3>{next.title}</h3><p>{dateLabel(next.dueAt, timezone, language)}</p><button className="text-button" onClick={() => openEditor(next)}>{t("Відкрити завдання")}</button></> : <><h3>{t("Попереду — вільний простір")}</h3><p>{t("Нові дедлайни з’являться тут.")}</p></>}</section><div className="rail-tip"><Code2 size={20}/><p>{t("Код теж має своє місце.")}<br /><span>{t("Додавай блоки коду до будь-якого запису.")}</span></p></div></aside></div></>}
 </div><footer className="app-footer"><span>{BRAND}. <span>{t("Місце для твоїх планів і знань.")}</span></span><span>{timezone}</span></footer></SidebarInset>
 <Dialog open={!!editor} onOpenChange={open => { if (!open && !busy)
        closeEditor(); }}><DialogContent className="editor-dialog" onInteractOutside={e => e.preventDefault()}><DialogHeader><DialogTitle>{editor?.id ? t("Редагувати запис") : editor?.kind === 'task' ? t("Нове завдання") : editor?.kind === 'note' ? t("Нова нотатка") : t("Нова навчальна тема")}</DialogTitle><DialogDescription>{t("Текст, пояснення та код в одному записі.")}</DialogDescription></DialogHeader>{editor && <Editor key={editor.id ?? 'new'} initial={editor} timezone={timezone} busy={busy} onSave={save} onClose={closeEditor}/>}</DialogContent></Dialog>
 <AlertDialog open={!!remove} onOpenChange={open => { if (!open && !busy)
        setRemove(null); }}><AlertDialogContent><AlertDialogTitle>{t("Видалити запис?")}</AlertDialogTitle><AlertDialogDescription>{t('«{title}» буде видалено разом з усіма блоками. Цю дію не можна скасувати.', { title: remove?.title ?? '' })}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("Залишити")}</AlertDialogCancel><AlertDialogAction className="danger-button" disabled={busy} onClick={e => { e.preventDefault(); void deleteEntry(); }}>{t("Видалити")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></SidebarProvider>;
}
function Editor({ initial, timezone, busy, onSave, onClose }: {
    initial: Partial<Entry>;
    timezone: string;
    busy: boolean;
    onSave: (e: Partial<Entry>) => Promise<void>;
    onClose: () => void;
}) {
    const { t } = useI18n();
    const [draft, setDraft] = useState(initial);
    const [deadline, setDeadline] = useState(localDateInput(initial.dueAt ?? null, timezone));
    const [mode, setMode] = useState('edit');
    const blocks = draft.blocks ?? [];
    const updateBlock = (id: string, patch: Partial<Block>) => setDraft({ ...draft, blocks: blocks.map(b => b.id === id ? { ...b, ...patch } : b) });
    const add = (type: Block['type']) => setDraft({ ...draft, blocks: [...blocks, { id: crypto.randomUUID(), type, content: '', ...(type === 'code' ? { language: 'javascript' } : {}) }] });
    const move = (index: number, delta: number) => { const b = [...blocks]; [b[index], b[index + delta]] = [b[index + delta], b[index]]; setDraft({ ...draft, blocks: b }); };
    return <form onSubmit={e => { e.preventDefault(); try {
        void onSave({ ...draft, dueAt: draft.kind === 'task' && !draft.repeat ? zonedToISO(deadline, timezone) : null, repeat: draft.kind === 'task' ? draft.repeat ?? null : null });
    }
    catch (error) {
        toast.error(t((error as Error).message));
    } }}><div className="editor-scroll"><label className="field-label" htmlFor="entry-title">{t("Назва")}</label><input id="entry-title" className="title-input" value={draft.title ?? ''} onChange={e => setDraft({ ...draft, title: e.target.value })} required maxLength={240} placeholder={draft.kind === 'task' ? t("Що потрібно зробити?") : t("Про що цей запис?")} autoFocus/><div className="editor-fields"><div><label className="field-label" htmlFor="entry-topic">{t("Тема")}</label><input id="entry-topic" className="form-input" value={draft.topic ?? ''} onChange={e => setDraft({ ...draft, topic: e.target.value })} maxLength={100} placeholder={t("Наприклад, JavaScript")}/></div>{draft.kind === 'task' && <><div><span className="field-label">{t("Статус")}</span><Picker label={t("Статус")} value={draft.status ?? 'todo'} onChange={v => setDraft({ ...draft, status: v as Entry['status'] })} items={draft.status==='overdue'?statusLabels:{todo:statusLabels.todo,progress:statusLabels.progress,done:statusLabels.done}}/></div><div><span className="field-label">{t("Пріоритет")}</span><Picker label={t("Пріоритет")} value={draft.priority ?? 'normal'} onChange={v => setDraft({ ...draft, priority: v as Entry['priority'] })} items={{ normal: t("Звичайний"), high: t("Високий"), low: t("Низький") }}/></div></>}</div>{draft.kind === 'task' && <RepeatFields value={draft.repeat ?? null} onChange={repeat => setDraft({ ...draft, repeat })} timezone={timezone}/>}
    {draft.kind === 'task' && !draft.repeat && <div className="deadline-field"><label className="field-label" htmlFor="entry-deadline">{t("Дедлайн")}<span>({timezone})</span></label><input id="entry-deadline" type="datetime-local" className="form-input" value={deadline} onChange={e => setDeadline(e.target.value)}/>{deadline && <button type="button" className="text-button" onClick={() => setDeadline('')}>{t("Прибрати дедлайн")}</button>}</div>}<div className="editor-content-heading"><h3>{t("Вміст запису")}</h3><Tabs value={mode} onValueChange={setMode}><TabsList><TabsTrigger value="edit">{t("Редактор")}</TabsTrigger><TabsTrigger value="preview">{t("Перегляд")}</TabsTrigger></TabsList></Tabs></div>{mode === 'preview' ? <div className="block-preview">{blocks.every(b => !b.content) && <p className="helper">{t("Додайте вміст у редакторі.")}</p>}{blocks.map(b => b.type === 'heading' ? <h3 key={b.id}>{b.content}</h3> : b.type === 'code' ? <CodeBlock key={b.id} block={b}/> : <p key={b.id}>{b.content}</p>)}</div> : <div className="blocks-editor">{blocks.map((b, index) => <div className={`editable-block ${b.type === 'code' ? 'code-edit' : ''}`} key={b.id}><div className="block-tools"><span>{b.type === 'text' ? t("Текст") : b.type === 'heading' ? t("Заголовок") : t("Код")}</span>{b.type === 'code' && <Picker label={t("Мова програмування")} value={b.language ?? 'javascript'} onChange={v => updateBlock(b.id, { language: v })} items={{ javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', html: 'HTML', css: 'CSS', sql: 'SQL', bash: 'Bash', json: 'JSON', text: t("Текст") }}/>}<div className="block-actions"><button type="button" className="icon-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("Підняти блок")}><ChevronUp size={16}/></button><button type="button" className="icon-button" disabled={index === blocks.length - 1} onClick={() => move(index, 1)} aria-label={t("Опустити блок")}><ChevronDown size={16}/></button><button type="button" className="icon-button" aria-label={t("Прибрати блок")} onClick={() => setDraft({ ...draft, blocks: blocks.filter(x => x.id !== b.id) })}><Trash2 size={15}/></button></div></div><textarea aria-label={t('{type} блоку {index}', { type: t(b.type === 'code' ? 'Код' : b.type === 'heading' ? 'Заголовок' : 'Текст'), index: index + 1 })} className={b.type === 'heading' ? 'heading-textarea' : ''} value={b.content} onChange={e => updateBlock(b.id, { content: e.target.value })} rows={b.type === 'code' ? 6 : b.type === 'heading' ? 2 : 4} placeholder={b.type === 'code' ? t("// Вставте код тут…") : b.type === 'heading' ? t("Заголовок розділу") : t("Запишіть пояснення, план або ідею…")} maxLength={100000} spellCheck={b.type !== 'code'} onKeyDown={e => { if (b.type === 'code' && e.key === 'Tab') {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart, end = el.selectionEnd;
        updateBlock(b.id, { content: b.content.slice(0, start) + '  ' + b.content.slice(end) });
        requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
    } }}/></div>)}<div className="add-blocks"><button type="button" onClick={() => add('text')}><Plus size={15}/>{t("Текст")}</button><button type="button" onClick={() => add('heading')}><Plus size={15}/>{t("Заголовок")}</button><button type="button" onClick={() => add('code')}><Code2 size={16}/>{t("Блок коду")}</button></div></div>}</div><div className="editor-footer"><span><ShieldCheck size={15}/>{t("Зміни зберігаються після натискання")}</span><div><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{t("Скасувати")}</button><button type="submit" className="primary-button" disabled={busy || !draft.title?.trim() || !!draft.repeat && !draft.repeat.days.length}>{busy ? <Loader2 size={17} className="spin"/> : <Check size={17}/>}{t("Зберегти")}</button></div></div></form>;
}
function RepeatFields({ value, onChange, timezone }: {
    value: Entry['repeat'];
    onChange: (value: Entry['repeat']) => void;
    timezone: string;
}) {
    const { t } = useI18n();
    return <section className="repeat-fields"><div className="repeat-toggle"><div><label htmlFor="entry-repeat"><Repeat2 size={17}/>{t("Постійне завдання")}</label><p>{t("Повторюється у вибрані дні тижня.")}</p></div><Switch id="entry-repeat" checked={!!value} onCheckedChange={checked => onChange(checked ? { days: [1, 2, 3, 4, 5, 6, 7], time: null } : null)}/></div>{value && <div className="repeat-options"><fieldset><legend className="field-label">{t("Дні виконання")}</legend><div className="weekdays"><button type="button" className="everyday-button" aria-pressed={value.days.length === 7} onClick={() => onChange({ ...value, days: [1, 2, 3, 4, 5, 6, 7] })}>{t("Щодня")}</button>{weekdays.map(day => <button key={day.day} type="button" aria-label={t(day.label)} aria-pressed={value.days.includes(day.day)} onClick={() => onChange({ ...value, days: value.days.includes(day.day) ? value.days.filter(n => n !== day.day) : [...value.days, day.day].sort((a, b) => a - b) })}>{t(day.short)}</button>)}</div>{!value.days.length && <p className="repeat-error" role="alert">{t("Оберіть хоча б один день.")}</p>}</fieldset><div className="repeat-time"><label className="field-label" htmlFor="entry-repeat-time">{t("Час виконання")}<span>{t('(необов’язково, {timezone})', { timezone })}</span></label><div><input id="entry-repeat-time" type="time" className="form-input" value={value.time ?? ''} onChange={event => onChange({ ...value, time: event.target.value || null })}/>{value.time && <button type="button" className="text-button" onClick={() => onChange({ ...value, time: null })}>{t("Прибрати час")}</button>}</div></div><p className="repeat-help">{t("Виконання відмічається для окремого дня. У наступний вибраний день завдання знову стане активним. З указаним часом бот нагадає за 30 хвилин.")}</p></div>}</section>;
}
function CodeBlock({ block }: {
    block: Block;
}) { const { t } = useI18n(); return <div className="rendered-code"><div><span>{block.language}</span><button type="button" onClick={() => void navigator.clipboard.writeText(block.content).then(() => toast.success(t("Код скопійовано"))).catch(() => toast.error(t("Не вдалося скопіювати код.")))}><Copy size={14}/>{t("Копіювати")}</button></div><pre><code>{block.content}</code></pre></div>; }
function SettingsPanel({ data, onRefresh, onConnect, busy, telegramUrl }: {
    data: WorkspaceData;
    onRefresh: () => Promise<WorkspaceData>;
    onConnect: () => Promise<void>;
    busy: boolean;
    telegramUrl: string;
}) {
    const { t } = useI18n();
    const [p, setP] = useState<Preferences>(data.preferences);
    const [saving, setSaving] = useState(false);
    const save = async () => { setSaving(true); try {
        await request('/api/preferences', p);
        await onRefresh();
        toast.success(t("Налаштування збережено"));
    }
    catch (e) {
        toast.error(t((e as Error).message));
    }
    finally {
        setSaving(false);
    } };
    return <div className="settings-grid"><section className="settings-card language-settings"><h2>{t("Мова інтерфейсу")}</h2><p>{t("Мова зберігається автоматично.")}</p><LanguageSelector /></section><section className="settings-card"><div className="settings-card-title"><Sun size={22}/><div><h2>{t("Нагадування")}</h2><p>{t("Завдання з дедлайнами та постійні завдання на сьогодні.")}</p></div></div><div className="settings-row"><div><strong>{t("Ранковий підсумок")}</strong><p>{t("Одне повідомлення з невиконаними завданнями з дедлайном і постійними завданнями на сьогодні.")}</p></div><Switch aria-label={t("Ранковий підсумок")} checked={p.morningEnabled} onCheckedChange={v => setP({ ...p, morningEnabled: v })}/></div><div className="settings-fields"><div><label className="field-label" htmlFor="morning-time">{t("Час підсумку")}</label><input id="morning-time" type="time" className="form-input" value={p.morningTime} onChange={e => setP({ ...p, morningTime: e.target.value })}/></div><div><span className="field-label">{t("Часовий пояс")}</span><Picker label={t("Часовий пояс")} value={p.timezone} onChange={v => setP({ ...p, timezone: v })} items={{ 'Europe/Berlin': 'Europe/Berlin', 'Europe/Kyiv': 'Europe/Kyiv', 'Europe/Warsaw': 'Europe/Warsaw', 'Europe/London': 'Europe/London', 'UTC': 'UTC' }}/></div></div><div className="settings-row"><div><strong>{t("Нагадування про дедлайн")}</strong><p>{t("Одне повідомлення за 30 хвилин до дедлайну та одне після прострочення невиконаного завдання.")}</p></div><Switch aria-label={t("Нагадування про дедлайн")} checked={p.deadlineEnabled} onCheckedChange={v => setP({ ...p, deadlineEnabled: v })}/></div><div className="settings-row"><div><strong>{t("Вхід через Telegram")}</strong><p>{t("Доступ до записів відкривається після підтвердження через бота. Сесія діє 30 днів або до виходу.")}</p></div><ShieldCheck size={22}/></div><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="spin" size={17}/> : <Check size={17}/>}{t("Зберегти налаштування")}</button></section><section className="settings-card telegram-settings"><span className="telegram-icon large"><Send size={27}/></span><h2>{t("Твій Telegram-бот")}</h2><span className="connection-tag">{p.telegramId ? t("Акаунт підключено") : t("Очікує підключення")}</span>{p.telegramName && <p className="telegram-name">{p.telegramName}</p>}<p>{t("Підтверджуй вхід і отримуй нагадування у приватному чаті з ботом.")}</p><dl><div><dt>{t("Бот")}</dt><dd>{data.telegram.username ? '@' + data.telegram.username : t("Ще не налаштовано")}</dd></div><div><dt>Telegram</dt><dd>{data.telegram.online ? t("Працює") : t("Офлайн")}</dd></div></dl><button className="primary-button" disabled={busy || !data.telegram.online} onClick={() => void onConnect()}><Send size={17}/>{p.telegramId ? t("Підтвердити Telegram") : t("Підключити Telegram")}</button>{telegramUrl && <div className="telegram-confirm"><a className="secondary-button" href={telegramUrl} target="_blank" rel="noreferrer">{t("Відкрити бота")}</a><span><Loader2 className="spin" size={16}/>{t("Очікую підтвердження…")}</span></div>}{!data.telegram.online && <div className="setup-note"><strong>{t("Потрібен запуск сервісу")}</strong><p>{t("Запустіть сайт і бота разом через npm run dev. Після підключення бота можна підтвердити вхід.")}</p><a href="/telegram-setup" className="text-button">{t("Інструкція підключення")}</a></div>}</section></div>;
}
