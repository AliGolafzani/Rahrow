import type { AuthErrorCode, AuthenticatedSession, RequestedOtp, RequestOtpInput, RotatedSession, VerifyOtpInput } from '@rahrow/contracts';
import { isAuthError, isAuthenticatedSession, isRequestedOtp, isRotatedSession } from './contracts.ts';
import type { AuthFailure } from './errors.ts';
import { isCanonicalMobile, isOtpCode } from './state.ts';

export type AuthResult<T> = { ok: true; value: T } | { ok: false; error: AuthFailure };

const ERROR_STATUS: Readonly<Record<AuthErrorCode, number>> = {
  AUTH_INVALID_INPUT: 400, AUTH_REQUEST_FORBIDDEN: 403, AUTH_THROTTLED: 429,
  AUTH_OTP_INVALID: 401, AUTH_OTP_EXPIRED: 401, AUTH_OTP_EXHAUSTED: 401, AUTH_OTP_CONSUMED: 401,
  AUTH_SESSION_INVALID: 401, AUTH_SESSION_EXPIRED: 401, AUTH_DELIVERY_UNAVAILABLE: 503, AUTH_UNAVAILABLE: 503,
};

function unavailable(interrupted: boolean): AuthResult<never> {
  return { ok: false, error: { code: 'AUTH_UNAVAILABLE', status: null, interrupted } };
}

function invalidInput(): AuthResult<never> {
  return { ok: false, error: { code: 'AUTH_INVALID_INPUT', status: 400, interrupted: false } };
}

/** Retry-After is a display hint, never proof of expiry or permission to authenticate. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  if (/^[0-9]{1,5}$/.test(value)) {
    const seconds = Number(value);
    return seconds <= 86_400 ? seconds : undefined;
  }
  const deadline = Date.parse(value);
  if (!Number.isFinite(deadline)) return undefined;
  const seconds = Math.ceil((deadline - now) / 1_000);
  return seconds >= 0 && seconds <= 86_400 ? seconds : undefined;
}

async function authRequest<T>(path: string, method: 'GET' | 'POST', expectedStatus: number,
  validate: (value: unknown) => value is T, body?: object, signal?: AbortSignal): Promise<AuthResult<T>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, 12_000);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(`/api/v1/auth/${path}`, {
      method, credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json', 'X-Rahrow-Auth': '1',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      signal: controller.signal,
    });
    if (expectedStatus === 204 && response.status === 204) return { ok: true, value: undefined as T };
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      return unavailable(method === 'POST');
    }
    const payload: unknown = await response.json();
    if (response.status === expectedStatus && validate(payload)) return { ok: true, value: payload };
    if (!response.ok && isAuthError(payload) && ERROR_STATUS[payload.error.code] === response.status) {
      const retryAfterSeconds = payload.error.retryAfterSeconds ?? parseRetryAfter(response.headers.get('retry-after'));
      // A proxy/service 503 can arrive after the mutation committed but its response was lost.
      // Treat that valid envelope conservatively, just like a transport interruption.
      const interrupted = method === 'POST' && payload.error.code === 'AUTH_UNAVAILABLE';
      return { ok: false, error: { code: payload.error.code, status: response.status, interrupted,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) } };
    }
    return unavailable(method === 'POST');
  } catch {
    return unavailable(method === 'POST');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function getSession(signal?: AbortSignal): Promise<AuthResult<AuthenticatedSession>> {
  return authRequest('session', 'GET', 200, isAuthenticatedSession, undefined, signal);
}

export function requestOtp(input: RequestOtpInput, signal?: AbortSignal): Promise<AuthResult<RequestedOtp>> {
  if (!isCanonicalMobile(input.mobile)) return Promise.resolve(invalidInput());
  return authRequest('otp/request', 'POST', 202, isRequestedOtp, input, signal);
}

export function verifyOtp(input: VerifyOtpInput, signal?: AbortSignal): Promise<AuthResult<AuthenticatedSession>> {
  if (!isCanonicalMobile(input.mobile) || !isOtpCode(input.code) || typeof input.challengeId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.challengeId)) {
    return Promise.resolve(invalidInput());
  }
  return authRequest('otp/verify', 'POST', 200, isAuthenticatedSession, input, signal);
}

export function logout(signal?: AbortSignal): Promise<AuthResult<void>> {
  return authRequest('logout', 'POST', 204, (value): value is void => value === undefined, {}, signal);
}

export function rotateSession(signal?: AbortSignal): Promise<AuthResult<RotatedSession>> {
  return authRequest('session/rotate', 'POST', 200, isRotatedSession, {}, signal);
}
