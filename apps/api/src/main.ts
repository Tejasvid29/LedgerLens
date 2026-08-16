import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { initSentry } from './sentry';
import { SentryExceptionFilter } from './sentry-exception.filter';

// Before anything else boots — Sentry.init() itself is a no-op without
// SENTRY_DSN (see sentry.ts), so this is safe in every environment.
initSentry();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000' });
  app.useGlobalFilters(new SentryExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
