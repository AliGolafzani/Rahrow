import { Injectable } from '@nestjs/common';
import { AuthRepository } from './auth.repository.js';
import { createSessionToken, digestSessionToken } from './auth.security.js';

/** Server-only principal; roles and capabilities are deliberately not copied into sessions. */
export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly authenticationMethod: 'MOBILE_OTP';
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

  async rotateSession(token: string): Promise<{ token: string; expiresAt: Date } | null> {
    let digest: string;
    try { digest = digestSessionToken(token); } catch { return null; }
    const next = createSessionToken();
    const session = await this.repository.rotateMobileSession(digest, next.digest);
    return session ? { token: next.token, expiresAt: session.expiresAt } : null;
  }

  async revokeSession(token: string): Promise<boolean> {
    try { return await this.repository.revokeSession(digestSessionToken(token)); } catch { return false; }
  }

  // No issuance API exists here. Admin sessions remain unavailable until AUTH-02
  // actually verifies password + TOTP. A credential or role never confers assurance.
}
