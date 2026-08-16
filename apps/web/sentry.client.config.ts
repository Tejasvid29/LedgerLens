import * as Sentry from '@sentry/nextjs';

// NEXT_PUBLIC_ here is deliberate, not an oversight of S12's "server-only
// env vars" convention — a Sentry DSN is designed to be public (it's a
// write-only ingest endpoint, rate-limited on Sentry's side), unlike
// API_AUTH_SECRET or the OAuth client secret. The browser bundle needs it
// to report client-side errors at all.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0.1,
});
