import 'reflect-metadata';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AuthController } from '../dist/modules/auth/auth.controller.js';
import { AuthConfig } from '../dist/modules/auth/auth.config.js';
import { AuthHttpGuard } from '../dist/modules/auth/auth.http.js';
import { TrustedSessionResolver } from '../dist/modules/auth/auth.guard.js';
import { MobileOtpService } from '../dist/modules/auth/mobile-otp.service.js';

// Load actual controllers and DTOs, without starting a listener, database, keys or provider.
class OpenApiModule {}
Module({ controllers: [AuthController], providers: [
  { provide: AuthConfig, useValue: new AuthConfig({ mode: 'unconfigured' }) },
  { provide: MobileOtpService, useValue: {} },
  { provide: TrustedSessionResolver, useValue: {} }, AuthHttpGuard,
] })(OpenApiModule);
const app = await NestFactory.create(OpenApiModule, { logger: false });
try {
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('Rahrow AUTH-02 API').setVersion('1.0')
    .setDescription('Bounded mobile OTP authentication. No real SMS or admin authentication. Strict DTOs, private/no-store responses and cookie-only persisted sessions. Explicit loopback local mode uses rahrow_local_session without Secure; normal cookie is __Host-rahrow_session.')
    .addCookieAuth('__Host-rahrow_session', { type: 'apiKey', in: 'cookie' }, 'rahrowSession').build());
  // The DTO pipe rejects additional properties, including on the explicit empty body DTO.
  for (const schema of Object.values(document.components?.schemas ?? {})) {
    if (!('$ref' in schema) && schema.type === 'object') schema.additionalProperties = false;
  }
  const output = `${JSON.stringify(document, null, 2)}\n`;
  const target = fileURLToPath(new URL('../../../docs/api/auth-02.openapi.json', import.meta.url));
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== output) throw new Error('Generated auth OpenAPI is stale.');
  } else await writeFile(target, output);
} finally { await app.close(); }
