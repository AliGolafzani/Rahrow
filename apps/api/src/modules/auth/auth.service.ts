import { Injectable } from '@nestjs/common';
import { AuthRepository } from './auth.repository.js';
import { createSessionToken, digestSessionToken } from './auth.security.js';

/** Server-only principal; roles and capabilities are deliberately not copied into sessions. */
export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly authenticationMethod: 'MOBILE_OTP';
}

/** Raw bearer is available only to cookie transport and absent from JSON/object inspection. */
export class SessionResult {
  readonly #token: string;
  readonly expiresAt: Date;

  constructor(token: string, expiresAt: Date) {
    this.#token = token;
    this.expiresAt = expiresAt;
    Object.freeze(this);
  }

  get token(): string { return this.#token; }
  toJSON(): { expiresAt: Date } { return { expiresAt: this.expiresAt }; }
}

@Injectable()
export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async resolveSession(token: string): Promise<AuthenticatedPrincipal | null> {
    let digest: string;
    try { digest = digestSessionToken(token); } catch { return null; }
    const session = await this.repository.findMobileSession(digest);
    return session ? { userId: session.userId, sessionId: session.id, authenticationMethod: 'MOBILE_OTP' } : null;
  }

  async rotateSession(token: string, correlationId?: string): Promise<SessionResult | null> {
    let digest: string;
    try { digest = digestSessionToken(token); } catch { return null; }
    const next = createSessionToken();
    const session = await this.repository.rotateMobileSession(digest, next.digest, undefined, correlationId);
    return session ? new SessionResult(next.token, session.expiresAt) : null;
  }

  async revokeSession(token: string, correlationId?: string): Promise<boolean> {
    let digest: string;
    try { digest = digestSessionToken(token); } catch { return false; }
    // Persistence failures must propagate so HTTP cannot falsely acknowledge successful logout.
    return this.repository.revokeSession(digest, undefined, correlationId);
  }

  // Admin sessions remain unavailable until an independently authorized flow verifies
  // both password and actual TOTP. A credential or role never confers assurance.
}
