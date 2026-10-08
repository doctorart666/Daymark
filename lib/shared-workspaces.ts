import { db, hash, nonce, preferences, recordScope, sharedWorkspaces, scopeGuard, telegramStatus } from './server';
import { telegramOwner } from './telegram-login';
import { languageValue, translate, type Language } from './i18n';

export async function createWorkspace(userId:string,name:string) {
  const id=crypto.randomUUID();
  const settings=await preferences(userId);
  await db().prepare('INSERT INTO workspaces(id,owner,name,timezone,created_at) VALUES(?,?,?,?,?)')
    .bind(id,userId,name,settings.timezone,new Date().toISOString()).run();
  return {id,name,timezone:settings.timezone,role:'owner' as const};
}
export async function workspaceAccess(userId:string,id:string) {
  const scope=await recordScope(userId,id);
  const ownerOnly=scope.workspace!.role==='owner';
  const members=ownerOnly?(await db().prepare(`SELECT w.owner AS userId,p.telegram_name AS name,'owner' AS role,w.created_at AS joinedAt
    FROM workspaces w JOIN preferences p ON p.owner=w.owner WHERE w.id=? AND w.owner=?
    UNION ALL SELECT m.user_id AS userId,p.telegram_name AS name,'editor' AS role,m.joined_at AS joinedAt
    FROM workspace_members m JOIN preferences p ON p.owner=m.user_id
    JOIN workspaces w ON w.id=m.workspace_id WHERE w.id=? AND w.owner=? ORDER BY role DESC,joinedAt`)
    .bind(id,userId,id,userId).all()).results:[];
  const invites=ownerOnly?(await db().prepare(`SELECT i.id,i.created_at AS createdAt,i.expires_at AS expiresAt FROM workspace_invites i
    JOIN workspaces w ON w.id=i.workspace_id WHERE w.id=? AND w.owner=? AND i.used_by IS NULL AND i.revoked_at IS NULL
    AND i.expires_at>? ORDER BY i.created_at DESC`).bind(id,userId,Date.now()).all()).results:[];
  await recordScope(userId,id);
  return {workspace:scope.workspace,members,invites};
}
export async function createInvite(userId:string,id:string) {
  const state=await telegramStatus();
  if(!state.configured||!state.username||!state.online)
    throw new Error('VALIDATION:Telegram ще не готовий. Перевірте, що npm run dev запустив бота.');
  const token=nonce().slice(0,48),inviteId=crypto.randomUUID(),expiresAt=Date.now()+7*86400000;
  const row=await db().prepare(`INSERT INTO workspace_invites(id,hash,workspace_id,created_by,created_at,expires_at)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=? AND owner=?) RETURNING id`)
    .bind(inviteId,await hash(token),id,userId,new Date().toISOString(),expiresAt,id,userId).first();
  if(!row)throw new Error('FORBIDDEN');
  return {id:inviteId,url:`https://t.me/${state.username}?start=ws_${token}`,expiresAt};
}
export async function revokeInvite(userId:string,workspaceId:string,inviteId:string) {
  const row=await db().prepare(`UPDATE workspace_invites SET revoked_at=? WHERE id=? AND workspace_id=? AND
    EXISTS(SELECT 1 FROM workspaces WHERE id=? AND owner=?) RETURNING id`)
    .bind(Date.now(),inviteId,workspaceId,workspaceId,userId).first();
  if(!row)throw new Error('FORBIDDEN');
}
export async function removeMember(userId:string,workspaceId:string,memberId:string) {
  const guard=scopeGuard(userId,workspaceId,true);
  // Membership deletion and cancellation of queued notifications are one transaction.
  // Existing sessions remain valid for that person's own workspace only.
  const result=await db().batch([
    db().prepare(`DELETE FROM workspace_members WHERE workspace_id=? AND user_id=? AND ${guard.sql} RETURNING user_id`)
      .bind(workspaceId,memberId,...guard.args),
    db().prepare(`UPDATE outbox SET status='cancelled',updated_at=? WHERE (workspace_id=? OR EXISTS(SELECT 1 FROM json_each(outbox.workspace_ids) WHERE value=?)) AND owner=? AND status='pending' AND ${guard.sql}`)
      .bind(new Date().toISOString(),workspaceId,workspaceId,memberId,...guard.args),
  ]);
  if(!result[0].results.length)throw new Error('FORBIDDEN');
}
export async function acceptWorkspaceInvite(input:{code:string;chatId:string;name:string;language?:Language}) {
  const language=languageValue(input.language),t=(key:string)=>translate(language,key);
  const tokenHash=await hash(input.code),now=Date.now();
  const invite=await db().prepare(`SELECT i.workspace_id,w.name,w.owner FROM workspace_invites i JOIN workspaces w ON w.id=i.workspace_id
    WHERE i.hash=? AND i.expires_at>? AND i.revoked_at IS NULL AND i.used_by IS NULL`)
    .bind(tokenHash,now).first<{workspace_id:string;name:string;owner:string}>();
  const invalid=()=>({ok:false,message:t('Запрошення використане, відкликане або застаріле. Попросіть власника створити нове.')});
  if(!invite)return invalid();
  const userId=await telegramOwner(input.chatId);
  if(userId===invite.owner)return {ok:false,message:t('Ви вже є власником цього простору.')};
  const claim=nonce();
  const result=await db().batch([
    db().prepare(`INSERT INTO preferences(owner,telegram_id,telegram_name,telegram_required,language)
      SELECT ?,?,?,1,? WHERE EXISTS(SELECT 1 FROM workspace_invites WHERE hash=? AND expires_at>? AND revoked_at IS NULL AND used_by IS NULL)
      ON CONFLICT(owner) DO UPDATE SET telegram_name=excluded.telegram_name,telegram_required=1`)
      .bind(userId,input.chatId,input.name,language,tokenHash,now),
    db().prepare(`UPDATE workspace_invites SET used_by=?,claim_id=? WHERE hash=? AND expires_at>? AND revoked_at IS NULL AND used_by IS NULL`)
      .bind(userId,claim,tokenHash,now),
    // A unique claim id prevents replay after a member has been removed.
    db().prepare(`INSERT INTO workspace_members(workspace_id,user_id,joined_at)
      SELECT workspace_id,?,? FROM workspace_invites WHERE hash=? AND used_by=? AND claim_id=?
      ON CONFLICT(workspace_id,user_id) DO NOTHING`)
      .bind(userId,new Date(now).toISOString(),tokenHash,userId,claim),
  ]);
  if(!result[1].meta.changes)return invalid();
  return {ok:true,message:translate(language,'✅ Доступ до «{name}» надано. Відкрийте сайт і увійдіть через Telegram.',{name:invite.name}),
    path:'/tasks?workspace='+invite.workspace_id,language};
}
export { sharedWorkspaces };

// Check again immediately before the companion sends a claimed message.
// Membership may have changed after the queue was claimed on the previous tick.
export async function canDeliverJob(id:string) {
  const access=`(outbox.workspace_id IS NULL OR EXISTS(SELECT 1 FROM workspaces w WHERE w.id=outbox.workspace_id AND
    (w.owner=outbox.owner OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=outbox.owner))))
    AND NOT EXISTS(SELECT 1 FROM json_each(outbox.workspace_ids) source WHERE NOT EXISTS(SELECT 1 FROM workspaces w
      WHERE w.id=source.value AND (w.owner=outbox.owner OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=outbox.owner))))`;
  const row=await db().prepare(`SELECT id FROM outbox WHERE id=? AND status='sending' AND ${access}`).bind(id).first();
  if(row)return true;
  await db().prepare(`UPDATE outbox SET status='cancelled',updated_at=? WHERE id=? AND status='sending' AND NOT (${access})`)
    .bind(new Date().toISOString(),id).run();
  return false;
}
