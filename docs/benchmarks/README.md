# Benchmarks

## What this measures, and what it doesn't

The original plan was a pre-cache vs post-cache page-load comparison. That
required capturing the "before" number in S0, before any caching code
existed — CLAUDE.md flags it explicitly as something that "cannot be
regenerated" once caching lands. S0 never ran, and caching (S1-S7) is now
merged, so that comparison is gone for good. Faking it would misrepresent
what shipped.

What's measured instead: **cache off vs cache on, same codebase.** Both runs
hit the exact code running today; the only variable is whether Redis is in
the loop. This isolates the caching layer's actual effect rather than
conflating it with the five other slices of backend work that landed
alongside it — arguably a more honest number for what "the cache" is worth,
even if it's not the number originally promised.

## Protocol

1. Use a wallet with 100+ transactions (e.g. `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`)
2. Start stack: `npm run db:up && npm run db:migrate && npm run dev:api`
3. Create the wallet, then sync it once so both runs hit the same stored data:
   ```
   curl -X POST localhost:3001/wallets -H 'Content-Type: application/json' \
     -d '{"address":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","label":"vitalik"}'
   curl -X POST localhost:3001/wallets/<walletId>/sync
   ```
4. **Cache off (`before`):** `node scripts/measure-baseline.mjs <walletId> --mode=nocache` — `?nocache=true`, reads Postgres directly, Redis bypassed entirely
5. **Cache on (`after`):** `node scripts/measure-baseline.mjs <walletId> --mode=cached` — no query params, Redis warm after the first request
6. Screenshot DevTools Performance tab for both runs, save as `nocache-devtools.png` / `cached-devtools.png`
7. Commit the JSON output from the script (`docs/benchmarks/{mode}-{timestamp}.json`) plus both screenshots to this folder
8. Check `GET http://localhost:3001/metrics` after the cached run — `cache.hitRate` should be near 1.0 and `latency.cache.avgMs` should be well under `latency.origin.avgMs`; if not, something's misconfigured and the numbers below aren't representative

## Results

| Mode | Median | p95 | Date | Notes |
|------|--------|-----|------|-------|
| cache off (nocache) | _pending_ | _pending_ | | Postgres only, Redis bypassed |
| cache on (cached) | _pending_ | _pending_ | | Redis warm |

Run the protocol above and drop the script's JSON output and both
screenshots here. See the root README's Measurement protocol section for
how these numbers get quoted.
