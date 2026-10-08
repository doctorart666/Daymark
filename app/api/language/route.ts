import {cookies} from 'next/headers';
import {z} from 'zod';
import {checkOrigin,currentUser,db,failure,LANGUAGE_COOKIE,LANGUAGE_CHOICE_COOKIE} from '@/lib/server';
export async function POST(req:Request){
  try {
    checkOrigin(req);
    const input=z.object({language:z.enum(['de','en','uk'])}).safeParse(await req.json());
    if(!input.success)return Response.json({error:'Invalid language'},{status:400});
    const user=await currentUser();
    if(user)await db().prepare('UPDATE preferences SET language = ? WHERE owner = ?').bind(input.data.language,user.userId).run();
    const jar=await cookies();
    const options={httpOnly:true,secure:new URL(req.url).protocol==='https:',sameSite:'lax' as const,path:'/',maxAge:365*86400};
    jar.set(LANGUAGE_COOKIE,input.data.language,options);
    if(user)jar.delete(LANGUAGE_CHOICE_COOKIE);else jar.set(LANGUAGE_CHOICE_COOKIE,'1',options);
    return Response.json({language:input.data.language},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return failure(error);}
}
