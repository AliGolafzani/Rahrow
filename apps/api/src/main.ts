import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001, process.env.HOST ?? '127.0.0.1');
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
