import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AuthConfig } from './modules/auth/auth.config.js';
import { configureAuthHttp } from './modules/auth/auth.http.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, abortOnError: false });
  configureAuthHttp(app, app.get(AuthConfig));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001, process.env.HOST ?? '127.0.0.1');
}

void bootstrap().catch(() => {
  console.error('API startup failed.');
  process.exitCode = 1;
});
