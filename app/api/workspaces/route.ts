import { z } from 'zod';
import { authorized, checkOrigin, failure, sharedWorkspaces } from '@/lib/server';
import { createWorkspace, workspaceAccess, createInvite, revokeInvite, removeMember } from '@/lib/shared-workspaces';
const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),name:z.string().trim().min(1).max(80)}),
  z.object({action:z.literal('invite'),workspaceId:z.string().uuid()}),
  z.object({action:z.literal('revokeInvite'),workspaceId:z.string().uuid(),inviteId:z.string().uuid()}),
  z.object({action:z.literal('removeMember'),workspaceId:z.string().uuid(),userId:z.string().min(1).max(120)}),
]);
export async function GET(req:Request) {
  try {
    const user=await authorized(),id=new URL(req.url).searchParams.get('workspace');
    return Response.json(id?await workspaceAccess(user.userId,id):await sharedWorkspaces(user.userId),{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return failure(error);}
}
export async function POST(req:Request) {
  try {
    checkOrigin(req);
    const user=await authorized(),parsed=schema.safeParse(await req.json());
    if(!parsed.success)throw new Error('VALIDATION:Перевірте назву простору та вибрану дію.');
    const input=parsed.data;
    if(input.action==='create')return Response.json(await createWorkspace(user.userId,input.name));
    if(input.action==='invite')return Response.json(await createInvite(user.userId,input.workspaceId));
    if(input.action==='revokeInvite')await revokeInvite(user.userId,input.workspaceId,input.inviteId);
    if(input.action==='removeMember')await removeMember(user.userId,input.workspaceId,input.userId);
    return Response.json({ok:true});
  }catch(error){return failure(error);}
}
