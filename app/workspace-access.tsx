'use client';
import { useEffect, useRef, useState } from 'react';
import { Copy, Link2, Loader2, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { useI18n } from './language-provider';
import type { SharedWorkspace } from '@/lib/models';
type Access = {workspace:SharedWorkspace;members:{userId:string;name:string|null;role:'owner'|'editor'}[];invites:{id:string;createdAt:string;expiresAt:number}[]};
async function api<T>(path:string,data?:unknown):Promise<T> {
  const response=await fetch(path,{method:data?'POST':'GET',cache:'no-store',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});
  const result=await response.json() as T & {error?:string};
  if(!response.ok)throw new Error(result.error??'Не вдалося виконати дію.');
  return result;
}
async function load(id:string){return api<Access>('/api/workspaces?workspace='+id);}
export function workspaceHref(path:string,id?:string|null) {return path+(id?'?workspace='+encodeURIComponent(id):'');}
export default function WorkspaceAccess({open,onClose,workspaces,activeId}:{open:boolean;onClose:()=>void;workspaces:SharedWorkspace[];activeId:string|null}) {
  const {t,language}=useI18n();
  const [name,setName]=useState(''),[selection,setSelected]=useState(activeId??workspaces[0]?.id??'');
  const selected=workspaces.find(w=>w.id===selection)?.id??activeId??workspaces[0]?.id??'';
  const [access,setAccess]=useState<Access|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [link,setLink]=useState<{id:string;url:string;expiresAt:number}|null>(null);
  const actionBusy=useRef(false);
  const [remove,setRemove]=useState<Access['members'][number]|null>(null);
  useEffect(()=>{
    if(!open||!selected)return;
    let cancelled=false;
    const reload=async()=>{
      if(actionBusy.current||document.visibilityState!=='visible')return;
      try{const result=await load(selected);if(!cancelled&&!actionBusy.current){setAccess(result);setError('');}}
      catch(e){if(!cancelled&&!actionBusy.current)setError((e as Error).message);}
    };
    void reload();
    const timer=setInterval(()=>void reload(),10000);
    const focus=()=>void reload();window.addEventListener('focus',focus);
    return ()=>{cancelled=true;clearInterval(timer);window.removeEventListener('focus',focus);};
  },[open,selected]);
  async function run(action:()=>Promise<void>){actionBusy.current=true;setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{actionBusy.current=false;setBusy(false);}}
  const create=()=>run(async()=>{
    const created=await api<SharedWorkspace>('/api/workspaces',{action:'create',name});
    window.location.assign(workspaceHref('/tasks',created.id));
  });
  const invite=()=>run(async()=>{
    const created=await api<{id:string;url:string;expiresAt:number}>('/api/workspaces',{action:'invite',workspaceId:selected});
    // Keep the one-time URL visible even if refreshing the list fails.
    setLink(created);setAccess(await load(selected));
  });
  const revoke=(id:string)=>run(async()=>{
    await api('/api/workspaces',{action:'revokeInvite',workspaceId:selected,inviteId:id});
    if(link?.id===id)setLink(null);
    setAccess(await load(selected));
  });
  const removeMember=()=>run(async()=>{
    if(!remove)return;
    await api('/api/workspaces',{action:'removeMember',workspaceId:selected,userId:remove.userId});
    setRemove(null);setAccess(await load(selected));toast.success(t('Доступ відкликано'));
  });
  const copy=async()=>{if(!link)return;try{await navigator.clipboard.writeText(link.url);toast.success(t('Посилання скопійовано'));}catch{setError(t('Скопіюйте посилання з поля вручну.'));}};
  const date=(value:number)=>new Intl.DateTimeFormat(language==='de'?'de-DE':language==='en'?'en-GB':'uk-UA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  return <Dialog open={open} onOpenChange={value=>{if(!value&&!busy)onClose();}}><DialogContent className="workspace-access-dialog"><DialogHeader><DialogTitle>{t('Спільні простори')}</DialogTitle><DialogDescription>{t('Запрошуйте людей через Telegram і керуйте доступом до записів.')}</DialogDescription></DialogHeader>
    <form className="workspace-create" onSubmit={e=>{e.preventDefault();void create();}}><label className="field-label" htmlFor="workspace-name">{t('Новий спільний простір')}</label><div><input id="workspace-name" className="form-input" required maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder={t('Назва простору')} disabled={busy}/><button className="primary-button" disabled={busy||!name.trim()}><Plus size={17}/>{t('Створити')}</button></div></form>
    {workspaces.length>0&&<div className="workspace-access-section"><label className="field-label" htmlFor="managed-workspace">{t('Простір')}</label><select id="managed-workspace" className="form-input" value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setAccess(null);setLink(null);setError('');}}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
    {!access&&!error&&<p className="access-loading"><Loader2 size={17} className="spin"/>{t('Завантажую…')}</p>}
    {access&&<><div className="access-workspace-heading"><span>{t(access.workspace.role==='owner'?'Власник':'Учасник')} · {access.workspace.timezone}</span><a className="text-button" href={workspaceHref('/tasks',selected)}>{t('Відкрити простір')}</a></div>
    {access.workspace.role==='owner'?<><div className="access-section-heading"><h3><Users size={18}/>{t('Учасники')}</h3><button className="secondary-button" type="button" disabled={busy} onClick={()=>void invite()}><Link2 size={17}/>{t('Створити запрошення')}</button></div>
    <p className="access-help">{t('Одноразове посилання діє 7 днів. Для кожної людини створіть окреме запрошення.')}</p>
    {link&&<div className="invite-result"><label className="field-label" htmlFor="workspace-invite-link">{t('Посилання запрошення')}</label><div><input id="workspace-invite-link" className="form-input" readOnly value={link.url} onFocus={e=>e.currentTarget.select()}/><button type="button" className="secondary-button" onClick={()=>void copy()}><Copy size={16}/>{t('Копіювати')}</button></div><p>{t('Діє до {date}',{date:date(link.expiresAt)})}</p></div>}
    <ul className="workspace-member-list">{access.members.map(m=><li key={m.userId}><div><strong>{m.name??t('Учасник')}</strong><span>{t(m.role==='owner'?'Власник':'Учасник')}</span></div>{m.role==='editor'&&<button type="button" className="text-button revoke-access" disabled={busy} onClick={()=>setRemove(m)}>{t('Прибрати доступ')}</button>}</li>)}</ul>
    {access.invites.length>0&&<><h3 className="pending-invites-heading">{t('Невикористані запрошення')}</h3><ul className="workspace-invite-list">{access.invites.map(i=><li key={i.id}><span>{t('Діє до {date}',{date:date(i.expiresAt)})}</span><button className="text-button revoke-access" disabled={busy} onClick={()=>void revoke(i.id)}>{t('Відкликати')}</button></li>)}</ul></>}
    </>:<p className="access-help">{t('Ви можете створювати й редагувати записи. Запрошеннями та доступами керує власник.')}</p>}</>}
    </div>}
    {!workspaces.length&&<p className="access-help">{t('Створіть простір або прийміть запрошення в Telegram.')}</p>}
    {error&&<p className="login-error" role="alert">{t(error)}</p>}
    <AlertDialog open={!!remove} onOpenChange={value=>{if(!value&&!busy)setRemove(null);}}><AlertDialogContent><AlertDialogTitle>{t('Прибрати доступ?')}</AlertDialogTitle><AlertDialogDescription>{t('«{name}» втратить доступ до цього простору. Для повернення знадобиться нове запрошення.',{name:remove?.name??t('Учасник')})}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel disabled={busy}>{t('Залишити')}</AlertDialogCancel><AlertDialogAction className="danger-button" disabled={busy} onClick={e=>{e.preventDefault();void removeMember();}}>{t('Прибрати доступ')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </DialogContent></Dialog>;
}
