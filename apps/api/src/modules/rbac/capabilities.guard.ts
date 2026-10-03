import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth/auth.service.js';
import { RbacService } from './rbac.service.js';
import { REQUIRED_CAPABILITY } from './require-capabilities.decorator.js';

@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService, private readonly rbac: RbacService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability: unknown = this.reflector.getAllAndOverride(REQUIRED_CAPABILITY, [context.getHandler(), context.getClass()]);
    if (typeof capability !== 'string') throw new ForbiddenException('Forbidden');
    const request = context.switchToHttp().getRequest<{ headers?: { authorization?: unknown } }>();
    const header = request.headers?.authorization;
    // Only the persisted token verifier supplies identity. Ignore request.user/roles.
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw new UnauthorizedException('Unauthorized');
    const principal = await this.auth.resolveSession(header.slice(7));
    if (!principal) throw new UnauthorizedException('Unauthorized');
    if (!await this.rbac.permits(principal.userId, capability)) throw new ForbiddenException('Forbidden');
    return true;
  }
}
