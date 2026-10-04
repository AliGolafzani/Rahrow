/** The complete public identity allowlist. Private account records stay server-side. */
export interface PublicProfile {
  displayName: string | null;
  avatar: string | null;
}

/** Private account projection returned only to the authenticated account owner. */
export interface AuthenticatedSelf extends PublicProfile {
  id: string;
  mobile: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Calendar date, YYYY-MM-DD; no inferred age or eligibility. */
  birthDate: string | null;
}

export interface RequestOtpInput { mobile: string }
export interface VerifyOtpInput { challengeId: string; mobile: string; code: string }
export interface RequestedOtp { challengeId: string; expiresAt: string; retryAfterSeconds: number }
export interface SessionExpiry { expiresAt: string }
export interface AuthenticatedSession { user: AuthenticatedSelf; session: SessionExpiry }
export interface RotatedSession { session: SessionExpiry }
export type AuthErrorCode = 'AUTH_INVALID_INPUT' | 'AUTH_REQUEST_FORBIDDEN' | 'AUTH_THROTTLED' |
  'AUTH_OTP_INVALID' | 'AUTH_OTP_EXPIRED' | 'AUTH_OTP_EXHAUSTED' | 'AUTH_OTP_CONSUMED' |
  'AUTH_SESSION_INVALID' | 'AUTH_SESSION_EXPIRED' | 'AUTH_DELIVERY_UNAVAILABLE' | 'AUTH_UNAVAILABLE';
export interface AuthErrorEnvelope {
  error: { code: AuthErrorCode; message: string; correlationId: string; retryAfterSeconds?: number };
}
