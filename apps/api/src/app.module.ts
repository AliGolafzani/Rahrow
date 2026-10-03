import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { RbacModule } from './modules/rbac/rbac.module.js';
import { AuditModule } from './modules/audit/audit.module.js';

@Module({ imports: [AuthModule, UsersModule, RbacModule, AuditModule] })
export class AppModule {}
