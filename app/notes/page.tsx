import {requireUser} from '@/lib/server';
import Workspace from '../workspace';
export const dynamic='force-dynamic';
export default async function Page(){await requireUser('/notes');return <Workspace section="note"/>;}
