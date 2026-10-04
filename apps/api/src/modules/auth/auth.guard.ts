import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthConfig } from './auth.config.js';
import { readSessionCookie } from './auth.cookies.js';
import type { CookieRequest } from './auth.cookies.js';
import { AuthHttpError } from './auth.errors.js';
import { assertAuthHttpRequest, type AuthHttpRequest } from './auth.http.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedPrincipal } from './auth.service.js';

@Injectable()
export class TrustedSessionResolver {
  constructor(private readonly auth: AuthService, private readonly configuration: AuthConfig) {}
  bearer(request: CookieRequest): string | null {
    this.configuration.assertAvailable();
    return readSessionCookie(request, this.configuration);
  }
  async resolve(request: AuthHttpRequest): Promise<AuthenticatedPrincipal | null> {
    assertAuthHttpRequest(request, this.configuration);
    const bearer = this.bearer(request);
    if (bearer === null) return null;
    try { return await this.auth.resolveSession(bearer); }
    catch { throw new AuthHttpError('AUTH_UNAVAILABLE'); }
  }
}

/** Ordinary authentication uses exactly the same persisted cookie resolver as capability checks. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly resolver: TrustedSessionResolver) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthHttpRequest & { authPrincipal?: AuthenticatedPrincipal }>();
    const principal = await this.resolver.resolve(request);
    if (!principal) throw new AuthHttpError('AUTH_SESSION_INVALID');
    request.authPrincipal = principal;
    return true;
  }
}
