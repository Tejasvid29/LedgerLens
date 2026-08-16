import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

/**
 * Reports every unhandled exception to Sentry — a no-op call when
 * SENTRY_DSN is unset (see sentry.ts's initSentry) — then delegates to
 * Nest's own BaseExceptionFilter, so the response a client sees (status
 * code, body shape) is completely unchanged by this filter existing.
 *
 * Expected 4xx HttpExceptions (validation errors, NotFoundException from
 * a wrong-owner wallet lookup, etc.) are excluded deliberately: those are
 * normal control flow this app is built to produce, not incidents worth
 * an alert. A 5xx, or anything that isn't an HttpException at all
 * (a normalizer bug, a Prisma error escaping somewhere it shouldn't),
 * gets reported.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const isExpectedHttpError = exception instanceof HttpException && exception.getStatus() < 500;
    if (!isExpectedHttpError) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}
