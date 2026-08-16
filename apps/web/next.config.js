/**
 * Server Actions same-origin check (Next 14) validates the request's
 * Origin header against this allowlist — hardcoding 'localhost:3000' meant
 * every mutating action (add/sync/remove wallet, generate insight) would
 * be rejected in any deployed environment. NEXTAUTH_URL is already a
 * required env var (see .env.example) and is exactly "this deployment's
 * canonical URL", so deriving the allowlist from it means there's nothing
 * new to configure in Vercel — set NEXTAUTH_URL correctly and this follows.
 */
function allowedOrigins() {
  const origins = new Set(['localhost:3000']);
  if (process.env.NEXTAUTH_URL) {
    try {
      origins.add(new URL(process.env.NEXTAUTH_URL).host);
    } catch {
      // Malformed NEXTAUTH_URL fails loudly elsewhere (NextAuth itself
      // needs a valid URL) — this just shouldn't also throw at build time.
    }
  }
  return Array.from(origins);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@ledgerlens/shared'],
  experimental: {
    serverActions: {
      allowedOrigins: allowedOrigins(),
    },
    // Next 14 (unlike 15) still gates instrumentation.ts behind this flag
    // — instrumentation.ts is what loads sentry.server.config.ts /
    // sentry.edge.config.ts for the right runtime. See instrumentation.ts.
    instrumentationHook: true,
  },
};

// Wrapping with Sentry's build plugin whenever a DSN exists, regardless of
// whether an auth token does — without a token it just can't upload
// source maps (a logged warning, not a build failure), but it still does
// the client-bundle wiring sentry.client.config.ts needs. sourcemaps
// .disable makes that "can't upload" case an explicit choice instead of
// an implicit one.
let finalConfig = nextConfig;
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const { withSentryConfig } = require('@sentry/nextjs');
  finalConfig = withSentryConfig(nextConfig, {
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  });
}

module.exports = finalConfig;
