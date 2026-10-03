import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RbacRepository } from './rbac.repository.js';
import { RbacService } from './rbac.service.js';
import { CapabilitiesGuard } from './capabilities.guard.js';

@Module({ imports: [DatabaseModule, AuditModule, AuthModule], providers: [RbacRepository, RbacService, CapabilitiesGuard], exports: [RbacService, CapabilitiesGuard] })
export class RbacModule {}
