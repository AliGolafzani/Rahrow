import { resolveServerSession } from '../../../lib/auth/server';
import { authWebConfig } from '../../../lib/auth/config';
import { safeReturnTarget } from '../../../lib/auth/return-target';
import { permittedReturnTarget } from '../../../lib/auth/route-policy';
import { PRIVATE_HEADERS, authFailure } from '../../../lib/auth/forward';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let origin: string;
  try { origin = authWebConfig().webOrigin; } catch { return authFailure(); }
  const values = new URL(request.url).searchParams.getAll('returnTo');
  const returnTo = safeReturnTarget(values.length === 1 ? values[0] : undefined);
  const state = await resolveServerSession();
  const destination = state.status === 'authenticated' ? await permittedReturnTarget(returnTo, { authenticated: true }) :
    `/login?returnTo=${encodeURIComponent(returnTo)}`;
  return new Response(null, { status: 303, headers: { ...PRIVATE_HEADERS, Location: new URL(destination, origin).href } });
}
