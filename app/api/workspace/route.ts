import { workspace,failure } from '@/lib/server';
export async function GET(){try{return Response.json(await workspace(),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return failure(e);}}
