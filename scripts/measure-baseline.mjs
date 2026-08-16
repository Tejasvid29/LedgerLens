#!/usr/bin/env node
/**
 * Cache A/B measurement — same codebase, cache off vs cache on.
 *
 * This is NOT the original pre-caching-work baseline. That number was never
 * captured before caching landed (S1-S7) and, per CLAUDE.md, cannot be
 * regenerated now. This measures the caching layer in isolation instead:
 * two runs against today's code, cache bypassed vs cache warm. Isolating
 * just the caching variable is arguably a cleaner comparison anyway — it
 * doesn't conflate cache effect with five other slices of backend work.
 *
 * Usage:
 *   1. Start stack: npm run db:up && npm run db:migrate && npm run dev:api
 *   2. Create + sync a wallet:
 *      curl -X POST localhost:3001/wallets -H 'Content-Type: application/json' \
 *        -d '{"address":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","label":"vitalik"}'
 *      curl -X POST localhost:3001/wallets/<walletId>/sync
 *   3. Run both modes against the SAME already-synced wallet:
 *      node scripts/measure-baseline.mjs <walletId> --mode=nocache
 *      node scripts/measure-baseline.mjs <walletId> --mode=cached
 *
 * nocache mode:  ?nocache=true — reads Postgres directly, Redis bypassed entirely.
 *                This is the "before" number: what the cache saves you.
 * cached mode:   no query params — normal path, Redis warm after the first hit.
 *                This is the "after" number.
 * baseline mode: ?baseline=true — forces a full re-sync from Alchemy on every
 *                single request. A cold-start / worst-case number, not part
 *                of the primary comparison — kept for reference only.
 */

const API = process.env.API_URL ?? 'http://localhost:3001';
const RUNS = 20;
const walletId = process.argv[2];

const MODES = ['nocache', 'cached', 'baseline'];
const modeArg = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1];
const mode = MODES.includes(modeArg) ? modeArg : 'cached';

if (!walletId) {
  console.error('Usage: node scripts/measure-baseline.mjs <walletId> [--mode=nocache|cached|baseline]');
  process.exit(1);
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p95(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function queryFor(mode) {
  if (mode === 'nocache') return '?nocache=true';
  if (mode === 'baseline') return '?baseline=true';
  return '';
}

async function measureOnce() {
  const start = performance.now();
  const res = await fetch(`${API}/wallets/${walletId}/transactions${queryFor(mode)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  // S11 wrapped the response in a { transactions, total, page, ... }
  // envelope for filter/sort/pagination. Still just JSON either way — this
  // script only measures round-trip time, so the shape change doesn't
  // affect it. No page/pageSize params here, so this is still the same
  // up-to-500-row response as before S11.
  await res.json();
  return performance.now() - start;
}

async function main() {
  console.log(`Measuring ${RUNS} loads — mode: ${mode}, wallet: ${walletId}`);
  if (mode === 'cached') {
    console.log('(first run warms the cache — expect run 1 to be the outlier)');
  }
  const times = [];

  for (let i = 0; i < RUNS; i++) {
    const ms = await measureOnce();
    times.push(ms);
    console.log(`  run ${String(i + 1).padStart(2)}: ${ms.toFixed(0)}ms`);
  }

  const result = {
    mode,
    walletId,
    runs: RUNS,
    medianMs: Math.round(median(times)),
    p95Ms: Math.round(p95(times)),
    minMs: Math.round(Math.min(...times)),
    maxMs: Math.round(Math.max(...times)),
    measuredAt: new Date().toISOString(),
  };

  console.log('\n--- Results ---');
  console.log(JSON.stringify(result, null, 2));

  const outFile = `docs/benchmarks/${mode}-${Date.now()}.json`;
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir('docs/benchmarks', { recursive: true });
  await writeFile(outFile, JSON.stringify(result, null, 2));
  console.log(`\nSaved to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
