import { acceptWorkspaceInvite, canDeliverJob } from '@/lib/shared-workspaces';
import { confirmTelegramLogin } from '@/lib/telegram-login';
import { db,rawEnv,hash } from '@/lib/server';
import { tickReminders } from '@/lib/reminder-service';
import {z} from 'zod';
export async function POST(req:Request){const secret=rawEnv().TELEGRAM_SERVICE_SECRET;const supplied=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!secret||!supplied||await hash(secret)!==await hash(supplied))return Response.json({error:'Forbidden'},{status:403});try{const body=z.object({action:z.string(),username:z.string().optional()}).passthrough().parse(await req.json());const now=new Date();const stamp=now.toISOString();if(body.action==='heartbeat'){if(!z.string().regex(/^[a-zA-Z0-9_]{5,32}$/).safeParse(body.username).success)return Response.json({error:'Invalid username'},{status:400});await db().prepare('INSERT INTO service_state (id,username,heartbeat) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,heartbeat=excluded.heartbeat').bind('telegram',body.username,now.getTime()).run();return Response.json({ok:true});}
if(body.action==='confirm'){
 const parsed=z.object({code:z.string().regex(/^[a-f0-9]{48}$/),chatId:z.string().regex(/^\d{1,20}$/),name:z.string().max(200),language:z.enum(['de','en','uk']).optional()}).safeParse(body);
 if(!parsed.success)return Response.json({ok:false});
 const localRequest=['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname);
 return Response.json(await confirmTelegramLogin(parsed.data,localRequest));
}
if(body.action==='joinWorkspace'){
 const parsed=z.object({code:z.string().regex(/^[a-f0-9]{48}$/),chatId:z.string().regex(/^\d{1,20}$/),name:z.string().max(200),language:z.enum(['de','en','uk']).optional()}).safeParse(body);
 if(!parsed.success)return Response.json({ok:false});
 return Response.json(await acceptWorkspaceInvite(parsed.data));
}
if(body.action==='delivery'){
 const parsed=z.object({id:z.string().min(1).max(300)}).safeParse(body);
 if(!parsed.success)return Response.json({ok:false});
 return Response.json({ok:await canDeliverJob(parsed.data.id)});
}
if(body.action==='tick')return Response.json(await tickReminders(now));
if(body.action==='ack'){const parsed=z.object({id:z.string().max(300),status:z.enum(['sent','failed','unknown']),error:z.string().max(300).optional()}).safeParse(body);if(!parsed.success)return Response.json({error:'Invalid acknowledgement'},{status:400});await db().prepare("UPDATE outbox SET status=?,error=?,updated_at=? WHERE id=? AND status='sending'").bind(parsed.data.status,parsed.data.error??null,stamp,parsed.data.id).run();return Response.json({ok:true});}if(body.action==='health')return Response.json({ok:true});return Response.json({error:'Unknown action'},{status:400});}catch{console.error('Telegram service operation failed');return Response.json({error:'Service operation failed'},{status:503});}}
