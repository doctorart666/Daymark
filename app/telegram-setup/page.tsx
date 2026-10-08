import {requireUser} from '@/lib/server';
import Instructions from './instructions';
export const dynamic='force-dynamic';
export default async function Page(){await requireUser('/telegram-setup');return <Instructions/>;}
