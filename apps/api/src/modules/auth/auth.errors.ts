import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthErrorCode } from '@rahrow/contracts';

const ERRORS: Record<AuthErrorCode, readonly [number, string]> = {
  AUTH_INVALID_INPUT: [400, 'Invalid authentication request.'],
  AUTH_REQUEST_FORBIDDEN: [403, 'Authentication request is not permitted.'],
  AUTH_THROTTLED: [429, 'Too many authentication requests.'],
  AUTH_OTP_INVALID: [401, 'Invalid verification code.'],
  AUTH_OTP_EXPIRED: [401, 'Verification code has expired.'],
  AUTH_OTP_EXHAUSTED: [401, 'Verification attempt limit reached.'],
  AUTH_OTP_CONSUMED: [401, 'Verification code has already been used.'],
  AUTH_SESSION_INVALID: [401, 'Invalid session.'],
  AUTH_SESSION_EXPIRED: [401, 'Session has expired.'],
  AUTH_DELIVERY_UNAVAILABLE: [503, 'Verification delivery is unavailable.'],
  AUTH_UNAVAILABLE: [503, 'Authentication is unavailable.'],
};

/** Closed, secret-free error vocabulary. Never accepts an underlying error or input. */
export class AuthHttpError extends HttpException {
  readonly retryAfterSeconds?: number;
  constructor(readonly code: AuthErrorCode, retryAfterSeconds?: number) {
    super(ERRORS[code][1], ERRORS[code][0]);
    this.name = 'AuthHttpError';
    if (code === 'AUTH_THROTTLED' && Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds! > 0) {
      this.retryAfterSeconds = Math.min(retryAfterSeconds!, 86_400);
    }
  }
}

export interface AuthErrorResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): AuthErrorResponse;
  json(body: unknown): unknown;
}

export function authCorrelationId(request: { authCorrelationId?: string }): string {
  return request.authCorrelationId ??= randomUUID();
}

export function setAuthNoStore(response: Pick<AuthErrorResponse, 'setHeader'>): void {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Pragma', 'no-cache');
}

export function sendAuthError(error: unknown, request: { authCorrelationId?: string }, response: AuthErrorResponse): void {
  const bounded = error instanceof AuthHttpError ? error :
    error instanceof HttpException && error.getStatus() === 400 ? new AuthHttpError('AUTH_INVALID_INPUT') :
    new AuthHttpError('AUTH_UNAVAILABLE');
  setAuthNoStore(response);
  const correlationId = authCorrelationId(request);
  response.setHeader('X-Correlation-Id', correlationId);
  if (bounded.retryAfterSeconds !== undefined) response.setHeader('Retry-After', String(bounded.retryAfterSeconds));
  response.status(bounded.getStatus()).json({ error: {
    code: bounded.code, message: bounded.message, correlationId,
    ...(bounded.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: bounded.retryAfterSeconds }),
  } });
}

/** Controller scoped: unrelated routes retain Nest's existing error contract. */
@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    sendAuthError(error, http.getRequest<{ authCorrelationId?: string }>(), http.getResponse<AuthErrorResponse>());
  }
}
