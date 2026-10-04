import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TrustedSessionResolver } from '../auth/auth.guard.js';
import type { AuthHttpRequest } from '../auth/auth.http.js';
import { RbacService } from './rbac.service.js';
import { REQUIRED_CAPABILITY } from './require-capabilities.decorator.js';

@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly resolver: TrustedSessionResolver, private readonly rbac: RbacService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability: unknown = this.reflector.getAllAndOverride(REQUIRED_CAPABILITY, [context.getHandler(), context.getClass()]);
    if (typeof capability !== 'string') throw new ForbiddenException('Forbidden');
    const request = context.switchToHttp().getRequest<AuthHttpRequest>();
    // Only the shared persisted cookie verifier supplies identity. Ignore request.user/roles.
    const principal = await this.resolver.resolve(request);
    if (!principal) throw new UnauthorizedException('Unauthorized');
    if (!await this.rbac.permits(principal.userId, capability)) throw new ForbiddenException('Forbidden');
    return true;
  }
}
