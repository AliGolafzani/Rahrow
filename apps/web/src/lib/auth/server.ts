import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authWebConfig } from './config.ts';
import { boundedBody } from './forward.ts';
import { isAuthenticatedSession, isAuthError } from './contracts.ts';
import type { AuthState } from './state';

/** Direct server-to-API GET: no public proxy hop, renewals, cache, or bearer serialization. */
export async function resolveServerSession(): Promise<AuthState> {
  try {
    const config = authWebConfig();
    const incoming = await headers();
    const outgoing = new Headers({ 'X-Rahrow-Auth': '1' });
    // Keep duplicate-cookie ambiguity intact for the AUTH-02 canonical reader.
    const cookie = incoming.get('cookie');
    if (cookie !== null) outgoing.set('Cookie', cookie);
    const response = await fetch(`${config.apiOrigin}/api/v1/auth/session`, {
      headers: outgoing, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8000),
    });
    const value: unknown = JSON.parse(await boundedBody(response.body, 32768));
    if (response.status === 200 && isAuthenticatedSession(value)) return { status: 'authenticated', expiresAt: value.session.expiresAt };
    if (response.status === 401 && isAuthError(value) &&
        ['AUTH_SESSION_INVALID', 'AUTH_SESSION_EXPIRED'].includes(value.error.code)) return { status: 'guest' };
  } catch { /* No error detail or cookie crosses the server rendering boundary. */ }
  return { status: 'temporarily-unavailable' };
}
export async function requireSession(path: '/dashboard'): Promise<AuthState> {
  const state = await resolveServerSession();
  if (state.status === 'guest') redirect(`/login?returnTo=${encodeURIComponent(path)}`);
  return state;
}
