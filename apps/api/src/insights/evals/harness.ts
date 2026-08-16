import { InsightProvider } from '../insight-provider.interface';
import { EVAL_CASES, EvalCase, EvalCategory } from './fixtures';
import { gradeCase, GradedCase } from './graders';

export interface CaseReport extends GradedCase {
  id: string;
  category: EvalCategory;
  description: string;
  summary: string;
  /** Set when the provider threw — the case counts as failed rather than
   *  aborting the run, so one bad case doesn't cost you the other 14.
   *  Same collect-don't-throw principle as the normalizer (rule 4). */
  error?: string;
  /** Only meaningful for cases that expect an "empty wallet" answer. */
  acknowledgedEmpty?: boolean;
}

export interface EvalReport {
  cases: CaseReport[];
  totals: {
    cases: number;
    errored: number;
    grounded: number;
    /** Share of non-errored cases with zero ungrounded figures. */
    groundingRate: number;
    /** Mean coverage across non-errored cases. */
    averageCoverage: number;
  };
  byCategory: Record<string, { cases: number; grounded: number; averageCoverage: number }>;
}

/** Phrases that count as honestly saying "there's nothing here". Checked
 *  case-insensitively; any one of them is enough. */
const EMPTY_ACKNOWLEDGEMENTS = [
  'no holdings',
  'no recent transactions',
  'no transactions',
  'empty',
  'nothing',
  'does not hold',
  "doesn't hold",
  'no current holdings',
];

/**
 * Runs every eval case through whichever InsightProvider it's handed —
 * the stub (free, deterministic) or the real OpenAI provider (billed).
 * The harness itself never knows which, exactly as InsightsService
 * doesn't: that's the S13 interface paying for itself.
 *
 * Sequential, not Promise.all: against a real provider this is a rate-
 * limited, billed API, and 15 concurrent requests is how you get a 429
 * instead of a report.
 */
export async function runEvals(
  provider: InsightProvider,
  cases: EvalCase[] = EVAL_CASES,
): Promise<EvalReport> {
  const reports: CaseReport[] = [];

  for (const evalCase of cases) {
    reports.push(await runOne(provider, evalCase));
  }

  return buildReport(reports);
}

async function runOne(provider: InsightProvider, evalCase: EvalCase): Promise<CaseReport> {
  const base = { id: evalCase.id, category: evalCase.category, description: evalCase.description };

  let summary: string;
  try {
    ({ summary } = await provider.generateInsight(evalCase.request));
  } catch (err) {
    return {
      ...base,
      summary: '',
      error: err instanceof Error ? err.message : String(err),
      grounding: { grounded: false, figuresInSummary: [], ungroundedFigures: [] },
      coverage: { expected: [], mentioned: [], missing: [], score: 0 },
    };
  }

  const graded = gradeCase(evalCase.request, summary);

  return {
    ...base,
    summary,
    ...graded,
    ...(evalCase.expectsEmptyAcknowledgement
      ? { acknowledgedEmpty: acknowledgesEmpty(summary) }
      : {}),
  };
}

function acknowledgesEmpty(summary: string): boolean {
  const lower = summary.toLowerCase();
  return EMPTY_ACKNOWLEDGEMENTS.some((phrase) => lower.includes(phrase));
}

function buildReport(cases: CaseReport[]): EvalReport {
  const scored = cases.filter((c) => !c.error);
  const grounded = scored.filter((c) => c.grounding.grounded).length;
  const coverageSum = scored.reduce((sum, c) => sum + c.coverage.score, 0);

  const byCategory: EvalReport['byCategory'] = {};
  for (const c of cases) {
    const bucket = (byCategory[c.category] ??= { cases: 0, grounded: 0, averageCoverage: 0 });
    bucket.cases += 1;
    if (!c.error && c.grounding.grounded) bucket.grounded += 1;
    bucket.averageCoverage += c.error ? 0 : c.coverage.score;
  }
  for (const bucket of Object.values(byCategory)) {
    bucket.averageCoverage = bucket.cases === 0 ? 0 : bucket.averageCoverage / bucket.cases;
  }

  return {
    cases,
    totals: {
      cases: cases.length,
      errored: cases.length - scored.length,
      grounded,
      groundingRate: scored.length === 0 ? 0 : grounded / scored.length,
      averageCoverage: scored.length === 0 ? 0 : coverageSum / scored.length,
    },
    byCategory,
  };
}
