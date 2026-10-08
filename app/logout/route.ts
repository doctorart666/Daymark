import { logout } from '@/lib/logout';
import { checkOrigin, failure } from '@/lib/server';

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    await logout();
    return new Response(null, { status: 303, headers: { Location: '/login', 'Cache-Control': 'private, no-store' } });
  } catch (error) { return failure(error); }
}
