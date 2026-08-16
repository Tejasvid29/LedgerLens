import { createHmac, timingSafeEqual } from 'crypto';

/**
 * A minimal, purpose-built signed token proving a request to apps/api came
 * from apps/web on behalf of an already-authenticated NextAuth session.
 * This is deliberately NOT a general JWT implementation (no header/alg
 * negotiation, no external library) — it exists for exactly one hop,
 * minted fresh immediately before each apps/api call and verified once,
 * so the minimal HMAC-SHA256 scheme below is enough: same guarantees
 * (signed, tamper-evident, time-bounded) without a new dependency.
 *
 * Distinct from NextAuth's own session cookie (NEXTAUTH_SECRET, browser-
 * facing) — apps/api never sees that cookie or its encoding.
 */
export interface ServiceTokenPayload {
  /** Stable user identifier — the authed user's email (also the DB lookup key). */
  sub: string;
  email: string;
  /** Unix seconds. */
  iat: number;
}

/** Minted right before use and verified within the same request — 60s
 *  covers real clock/network variance with no meaningful reuse window. */
const MAX_AGE_SECONDS = 60;

export function signServiceToken(payload: { sub: string; email: string }, secret: string): string {
  const full: ServiceTokenPayload = { ...payload, iat: Math.floor(Date.now() / 1000) };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const signature = sign(body, secret);
  return `${body}.${signature}`;
}

/** Returns null (never throws) for anything malformed, mistimed, or
 *  mis-signed — the caller treats "not verifiable" as one uniform case. */
export function verifyServiceToken(token: string, secret: string): ServiceTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  const expected = sign(body, secret);
  if (!timingSafeEqualStrings(signature, expected)) return null;

  let payload: ServiceTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload.iat !== 'number') return null;
  const ageSeconds = Math.floor(Date.now() / 1000) - payload.iat;
  if (ageSeconds < 0 || ageSeconds > MAX_AGE_SECONDS) return null;

  return payload;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Different lengths would make timingSafeEqual throw rather than return
  // false — length itself isn't secret here (both are fixed-size base64url
  // HMAC digests), so this early return is safe.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
