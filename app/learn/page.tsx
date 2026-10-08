import WorkspacePage, { type WorkspacePageProps } from '../workspace-page';
export const dynamic='force-dynamic';
export default function Page({searchParams}:WorkspacePageProps){return <WorkspacePage searchParams={searchParams} path="/learn" section="topic"/>;}
