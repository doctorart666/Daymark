import { redirect } from 'next/navigation';
import { currentUser, safeReturnTo } from '@/lib/server';
import Login from './login';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.return_to ?? '/tasks');
  if (await currentUser()) redirect(returnTo);
  return <Login returnTo={returnTo} />;
}
