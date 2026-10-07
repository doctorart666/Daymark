import {requireChatGPTUser} from '../chatgpt-auth';
import Workspace from '../workspace';
export const dynamic='force-dynamic';
export default async function Page(){await requireChatGPTUser('/settings');return <Workspace section="settings"/>;}
