/**
 * CLI entry point for the insight eval suite.
 *
 *   npm run evals -w @ledgerlens/api                      # stub, free, offline
 *   npm run evals -w @ledgerlens/api -- --provider=openai # real, BILLED calls
 *
 * Defaults to the stub deliberately: the real provider makes 15 billed
 * OpenAI API requests per run, and an eval suite you can't afford to run
 * is an eval suite nobody runs. Note that a ChatGPT Plus/Pro subscription
 * does NOT cover this — OpenAI bills API usage separately from consumer
 * subscriptions, so --provider=openai needs a funded platform account.
 */
import { ConfigService } from '@nestjs/config';
import { runEvals } from './harness';
import { StubInsightProvider } from './stub-insight.provider';
import { OpenAIInsightProvider } from '../openai-insight.provider';
import { InsightProvider } from '../insight-provider.interface';
import type { EvalReport } from './harness';

function resolveProvider(): { provider: InsightProvider; name: string } {
  const arg = process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1] ?? 'stub';

  if (arg === 'openai') {
    // Minimal ConfigService standing in for Nest's DI — this script runs
    // outside the Nest application context, and the provider only needs
    // one key from it.
    const config = new ConfigService();
    return { provider: new OpenAIInsightProvider(config), name: 'openai (billed)' };
  }

  if (arg !== 'stub') {
    console.error(`Unknown --provider=${arg}. Expected "stub" or "openai".`);
    process.exit(1);
  }

  return { provider: new StubInsightProvider(), name: 'stub (offline, free)' };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printReport(report: EvalReport, providerName: string): void {
  console.log(`\nInsight evals — provider: ${providerName}\n`);

  for (const c of report.cases) {
    if (c.error) {
      console.log(`  ✗ ${c.id.padEnd(28)} ERROR  ${c.error}`);
      continue;
    }
    const groundedMark = c.grounding.grounded ? '✓' : '✗';
    const detail = c.grounding.grounded
      ? ''
      : `  ungrounded: ${c.grounding.ungroundedFigures.join(', ')}`;
    console.log(
      `  ${groundedMark} ${c.id.padEnd(28)} grounding ${c.grounding.grounded ? 'pass' : 'FAIL'}` +
        `  coverage ${pct(c.coverage.score).padStart(6)}${detail}`,
    );
  }

  console.log('\n  By category:');
  for (const [category, stats] of Object.entries(report.byCategory)) {
    console.log(
      `    ${category.padEnd(20)} ${stats.grounded}/${stats.cases} grounded` +
        `   coverage ${pct(stats.averageCoverage)}`,
    );
  }

  const { totals } = report;
  console.log(
    `\n  TOTAL  ${totals.cases} cases` +
      `   grounding ${totals.grounded}/${totals.cases - totals.errored} (${pct(totals.groundingRate)})` +
      `   avg coverage ${pct(totals.averageCoverage)}` +
      (totals.errored ? `   errored ${totals.errored}` : ''),
  );

  // Grounding is the pass/fail bar: a hallucinated figure is a correctness
  // bug, not a quality nit. Coverage is reported but doesn't fail the run —
  // a terse-but-true summary is a judgement call, not a defect.
  if (totals.groundingRate < 1 || totals.errored > 0) {
    console.log('\n  FAILED — see ungrounded figures above.\n');
    process.exit(1);
  }
  console.log('\n  PASSED — every stated figure traces back to the input.\n');
}

async function main() {
  const { provider, name } = resolveProvider();
  printReport(await runEvals(provider), name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
