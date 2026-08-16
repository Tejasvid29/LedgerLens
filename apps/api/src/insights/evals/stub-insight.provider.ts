// Moved to apps/api/src/insights/stub-insight.provider.ts (S17) — it's no
// longer eval-only, it's a real LLM_PROVIDER=stub option. This sandbox
// can't delete files on the mounted folder, so this re-export is a
// placeholder: `git rm apps/api/src/insights/evals/stub-insight.provider.ts`
// before committing (see the S17 commit instructions) rather than keeping
// this file around.
export { StubInsightProvider } from '../stub-insight.provider';
