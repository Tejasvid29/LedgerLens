/**
 * Next.js's own instrumentation hook (needs experimental.instrumentationHook
 * = true on Next 14 — see next.config.js) — the reliable way to load
 * Sentry's server/edge init for the runtime that's actually running,
 * rather than depending on the build plugin's auto-injection alone.
 * sentry.client.config.ts is handled separately, by the webpack plugin
 * wrapping next.config.js.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
