import { requireUser } from '@/lib/server';
import Workspace from './workspace';
export type WorkspacePageProps = { searchParams:Promise<{workspace?:string;entry?:string}> };
export default async function WorkspacePage({searchParams,path,section='task'}:WorkspacePageProps&{path:string;section?:'task'|'note'|'topic'}) {
  const params=await searchParams;
  const query=new URLSearchParams();
  if(typeof params.workspace==='string')query.set('workspace',params.workspace);
  if(typeof params.entry==='string')query.set('entry',params.entry);
  await requireUser(path+(query.size?'?'+query.toString():''));
  return <Workspace section={section}/>;
}
