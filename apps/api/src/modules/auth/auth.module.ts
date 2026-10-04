import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { AuthConfig } from './auth.config.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard, TrustedSessionResolver } from './auth.guard.js';
import { AuthHttpGuard } from './auth.http.js';
import { AuthDtoPipe } from './auth.dto.js';
import { AuthExceptionFilter } from './auth.errors.js';
import { MobileOtpService } from './mobile-otp.service.js';
import { OtpDeliveryProvider } from './otp-delivery.provider.js';
import { FakeOtpDeliveryProvider } from './fake-otp-delivery.provider.js';

@Module({
  imports: [DatabaseModule, UsersModule, AuditModule], controllers: [AuthController],
  providers: [
    AuthRepository, AuthService, MobileOtpService, TrustedSessionResolver, AuthGuard, AuthHttpGuard, AuthDtoPipe, AuthExceptionFilter,
    { provide: AuthConfig, useFactory: () => new AuthConfig() },
    { provide: OtpDeliveryProvider, inject: [AuthConfig], useFactory: (config: AuthConfig) =>
      config.configured ? new FakeOtpDeliveryProvider(1_000, () => config.now()) : {
        async deliver(): Promise<void> { config.assertAvailable(); },
      } },
  ],
  exports: [AuthService, AuthConfig, TrustedSessionResolver, AuthGuard],
})
export class AuthModule {}
