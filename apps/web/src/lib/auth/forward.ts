import { randomUUID } from 'node:crypto';
import type { AuthErrorCode } from '@rahrow/contracts';
import { authWebConfig, type AuthWebConfig } from './config.ts';
import { isAuthenticatedSession, isAuthError, isRequestedOtp, isRotatedSession } from './contracts.ts';

export const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
const operations: Readonly<Record<string, string>> = Object.freeze({
  'otp/request': 'POST', 'otp/verify': 'POST', session: 'GET', 'session/rotate': 'POST', logout: 'POST',
});
const errorStatuses: Readonly<Record<AuthErrorCode, number>> = {
  AUTH_INVALID_INPUT: 400, AUTH_REQUEST_FORBIDDEN: 403, AUTH_THROTTLED: 429,
  AUTH_OTP_INVALID: 401, AUTH_OTP_EXPIRED: 401, AUTH_OTP_EXHAUSTED: 401, AUTH_OTP_CONSUMED: 401,
  AUTH_SESSION_INVALID: 401, AUTH_SESSION_EXPIRED: 401, AUTH_DELIVERY_UNAVAILABLE: 503, AUTH_UNAVAILABLE: 503,
};
export function authFailure(code: AuthErrorCode = 'AUTH_UNAVAILABLE', status = errorStatuses[code]): Response {
  const correlationId = randomUUID();
  return Response.json({ error: { code, message: 'Authentication request could not be completed.', correlationId } },
    { status, headers: { ...PRIVATE_HEADERS, 'X-Correlation-Id': correlationId } });
}
export async function boundedBody(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Body limit exceeded.'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function validCookies(cookies: string[], operation: string, success: boolean): boolean {
  if (!success) return cookies.length === 0;
  if (!['otp/verify', 'session/rotate', 'logout'].includes(operation)) return cookies.length === 0;
  if (cookies.length !== 1) return false;
  // Preserve exact backend transport; reject duplicate/unknown attributes rather than
  // validating an earlier safe attribute which the browser could later override.
  const cookie = cookies[0];
  if (cookie.length >= 2048) return false;
  const [pair, ...parts] = cookie.split(';').map(part => part.trim());
  const equals = pair.indexOf('=');
  const name = pair.slice(0, equals);
  const value = pair.slice(equals + 1);
  if (!['__Host-rahrow_session', 'rahrow_local_session'].includes(name)) return false;
  const attributes = new Map<string, string | null>();
  for (const part of parts) {
    const separator = part.indexOf('=');
    const key = (separator < 0 ? part : part.slice(0, separator)).toLowerCase();
    if (!['path', 'httponly', 'samesite', 'secure', 'expires', 'max-age'].includes(key) || attributes.has(key)) return false;
    attributes.set(key, separator < 0 ? null : part.slice(separator + 1));
  }
  const maxAge = attributes.get('max-age');
  const expires = attributes.get('expires');
  if (attributes.get('path') !== '/' || attributes.get('httponly') !== null || attributes.get('samesite') !== 'Lax' ||
      (attributes.has('secure') && attributes.get('secure') !== null) ||
      (name === '__Host-rahrow_session' && !attributes.has('secure')) ||
      typeof maxAge !== 'string' || !/^[0-9]{1,6}$/.test(maxAge) || Number(maxAge) > 604800 ||
      typeof expires !== 'string' || !Number.isFinite(Date.parse(expires))) return false;
  return operation === 'logout' ? value === '' && maxAge === '0' : /^[A-Za-z0-9_-]+$/.test(value) && Number(maxAge) > 0;
}
/** The browser boundary never manufactures a missing Origin/header or enables proxy trust. */
export async function forwardAuth(request: Request, operation: string, config?: AuthWebConfig): Promise<Response> {
  if (!Object.hasOwn(operations, operation)) return authFailure('AUTH_REQUEST_FORBIDDEN', 404);
  if (request.method !== operations[operation]) {
    const response = authFailure('AUTH_REQUEST_FORBIDDEN', 405);
    response.headers.set('Allow', operations[operation]);
    return response;
  }
  try {
    const settings = config ?? authWebConfig();
    const url = new URL(request.url);
    if (url.pathname !== `/api/v1/auth/${operation}` || url.search) return authFailure('AUTH_REQUEST_FORBIDDEN');
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    if (request.headers.get('x-rahrow-auth') !== '1' ||
        (origin !== null && origin !== settings.webOrigin) ||
        (request.method === 'POST' && origin === null) ||
        (site !== null && !['same-origin', 'same-site', 'none'].includes(site))) return authFailure('AUTH_REQUEST_FORBIDDEN');
    const headers = new Headers();
    for (const name of ['origin', 'x-rahrow-auth', 'content-type', 'cookie', 'sec-fetch-site']) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    let body: string | undefined;
    if (request.method === 'POST') {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(headers.get('content-type') ?? '') ||
          request.headers.has('content-encoding')) return authFailure('AUTH_REQUEST_FORBIDDEN');
      try { body = await boundedBody(request.body, 4096); } catch { return authFailure('AUTH_INVALID_INPUT'); }
    }
    const response = await fetch(`${settings.apiOrigin}/api/v1/auth/${operation}`, {
      method: request.method, headers, body, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8000),
    });
    const outputHeaders = new Headers(PRIVATE_HEADERS);
    if (response.status >= 300 && response.status < 400) return authFailure();
    const cookies = response.headers.getSetCookie();
    if (!validCookies(cookies, operation, response.ok)) return authFailure();
    if (operation === 'logout' && response.status === 204) {
      for (const cookie of cookies) outputHeaders.append('Set-Cookie', cookie);
      return new Response(null, { status: 204, headers: outputHeaders });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) return authFailure();
    const raw = await boundedBody(response.body, 32768);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return authFailure(); }
    const success = operation === 'otp/request' ? response.status === 202 && isRequestedOtp(value) :
      operation === 'session/rotate' ? response.status === 200 && isRotatedSession(value) :
      ['otp/verify', 'session'].includes(operation) && response.status === 200 && isAuthenticatedSession(value);
    if (!success) {
      if (!isAuthError(value) || response.status !== errorStatuses[value.error.code]) return authFailure();
      // Never relay an arbitrary diagnostic string from an upstream service.
      value.error.message = 'Authentication request could not be completed.';
      outputHeaders.set('X-Correlation-Id', value.error.correlationId);
      const retry = response.headers.get('retry-after');
      if (retry && /^[0-9]{1,5}$/.test(retry) && Number(retry) <= 86400) outputHeaders.set('Retry-After', retry);
    }
    for (const cookie of cookies) outputHeaders.append('Set-Cookie', cookie);
    return Response.json(value, { status: response.status, headers: outputHeaders });
  } catch { return authFailure(); }
}
