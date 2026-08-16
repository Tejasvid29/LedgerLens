import * as Sentry from '@sentry/node';

/**
 * No-op if SENTRY_DSN is unset — every environment before a Sentry
 * project exists (local dev, this repo's tests/CI, this sandbox) runs
 * exactly as it did before this file existed. Only a real deployment with
 * SENTRY_DSN set in its env (see docs/deploy.md) turns this on.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Sampled, not 100% — full tracing on every request is a lot of
    // volume for a solo project's Sentry quota. Errors are always
    // captured regardless of this; it only affects performance traces.
    tracesSampleRate: 0.1,
  });
}
