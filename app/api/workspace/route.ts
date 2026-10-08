import { workspace,failure } from '@/lib/server';
export async function GET(req:Request){try{return Response.json(await workspace(new URL(req.url).searchParams.get('workspace')),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return failure(e);}}
