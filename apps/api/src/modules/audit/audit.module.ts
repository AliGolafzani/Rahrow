import { Module } from '@nestjs/common';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';

@Module({ providers: [AuditService, AuditRepository], exports: [AuditRepository] })
export class AuditModule {}
