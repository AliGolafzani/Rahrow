import type { AuthErrorCode, RequestedOtp } from '@rahrow/contracts';
import { safeReturnTarget } from './return-target.ts';

export type AuthState =
  | { status: 'unknown' }
  | { status: 'guest' }
  | { status: 'authenticated'; expiresAt: string }
  | { status: 'signing-out' }
  | { status: 'temporarily-unavailable'; errorCode?: AuthErrorCode; retryAfterSeconds?: number };

/** The backend owns validity and expiry; client validation only supports entry. */
export function isCanonicalMobile(value: unknown): value is string {
  return typeof value === 'string' && /^\+[1-9][0-9]{0,14}$/.test(value);
}

/** UI convenience only; API validation continues to require canonical E.164. */
export function normalizeMobileInput(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^09[0-9]{9}$/.test(trimmed)) return `+98${trimmed.slice(1)}`;
  return isCanonicalMobile(trimmed) ? trimmed : null;
}

export function isOtpCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value);
}

export interface ActiveChallenge extends RequestedOtp {
  mobile: string;
  retryAt: number;
}

export function activeChallenge(result: RequestedOtp, mobile: string, now: number): ActiveChallenge {
  return { ...result, mobile, retryAt: now + result.retryAfterSeconds * 1_000 };
}

export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1_000));
}

/** Return destinations are deliberately limited to this milestone's protected entry. */
export function completeAuthPath(returnTo: string): string {
  return `/auth/complete?returnTo=${encodeURIComponent(safeReturnTarget(returnTo))}`;
}

/** Both proxy uncertainty and consumed proof require an authoritative read before another verification. */
export function verificationNeedsSessionResolution(failure: { interrupted: boolean; code: AuthErrorCode }): boolean {
  return failure.interrupted || failure.code === 'AUTH_OTP_CONSUMED';
}
