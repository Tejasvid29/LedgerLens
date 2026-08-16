import { InsightRequest } from '../insight-provider.interface';

/**
 * Grading is deliberately pure and string-based — no Number() anywhere in
 * this file. Rule 1 applies just as much to checking a figure as to
 * storing one: an 18-decimal balance parsed into a float to compare it
 * would corrupt the very thing grounding exists to verify.
 */

export interface GroundingResult {
  /** True when every figure the summary states also appears in the input. */
  grounded: boolean;
  figuresInSummary: string[];
  /** Figures the model stated that the input never contained — the
   *  hallucinations this whole harness exists to catch. */
  ungroundedFigures: string[];
}

export interface CoverageResult {
  /** Token symbols and chain names present in the input. */
  expected: string[];
  mentioned: string[];
  missing: string[];
  /** mentioned / expected, 1 when there was nothing to cover. */
  score: number;
}

export interface GradedCase {
  grounding: GroundingResult;
  coverage: CoverageResult;
}

/** Matches integers and decimals, including the 18-decimal values this app
 *  routinely displays. Commas are stripped before matching so "1,000" and
 *  "1000" are the same figure. */
const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;

export function gradeGrounding(request: InsightRequest, summary: string): GroundingResult {
  const allowed = allowedFigures(request);
  const figuresInSummary = extractFigures(redactIdentifiers(request, summary));
  const ungroundedFigures = figuresInSummary.filter((f) => !allowed.has(f));

  return {
    grounded: ungroundedFigures.length === 0,
    figuresInSummary,
    ungroundedFigures,
  };
}

/**
 * Removes identifiers — token symbols and the wallet address — from the
 * text before any figure is extracted from it.
 *
 * Digits inside an identifier are not a claim about quantity. Spam tokens
 * make this concrete: a wallet holding 100000 of a token whose symbol is
 * literally "$1000-CLAIM" produces a correct summary containing the
 * characters "1000", and grading that as a hallucinated balance would be
 * wrong. The same applies to the hex digits in an address. Redacting
 * first means the figure extractor only ever sees text where a number is
 * actually being asserted as a number.
 */
function redactIdentifiers(request: InsightRequest, summary: string): string {
  const identifiers = [
    ...request.holdings.map((h) => h.tokenSymbol),
    ...request.recentTransactions.map((t) => t.tokenSymbol),
    request.address,
  ];

  // Longest first: redacting "USDC" before "USDC-SPAM" would leave the
  // "-SPAM" fragment behind and, worse, could expose digits the longer
  // symbol was protecting.
  const sorted = Array.from(new Set(identifiers)).sort((a, b) => b.length - a.length);

  let redacted = summary;
  for (const identifier of sorted) {
    if (!identifier) continue;
    redacted = redacted.split(identifier).join(' ');
    // Symbols are frequently re-cased in prose ("usdc"), so match
    // case-insensitively too — escaped, since spam symbols contain regex
    // metacharacters like $ and . by design.
    redacted = redacted.replace(new RegExp(escapeRegExp(identifier), 'gi'), ' ');
  }
  return redacted;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every figure the model is permitted to state: the amounts it was given,
 * plus a small set of counts it can legitimately derive by counting the
 * input (how many holdings, how many transactions, how many chains).
 *
 * Allowing derived counts is a deliberate loosening — without it, a
 * perfectly grounded "you hold 3 tokens across 2 chains" would be graded
 * as a hallucination. The allowlist is enumerated rather than inferred so
 * it can't quietly expand into "any number that seems reasonable".
 */
function allowedFigures(request: InsightRequest): Set<string> {
  const allowed = new Set<string>();

  for (const holding of request.holdings) {
    allowed.add(normalizeFigure(holding.displayBalance));
  }
  for (const tx of request.recentTransactions) {
    allowed.add(normalizeFigure(tx.displayAmount));
    // Dates in the input are legitimately quotable figures too — a summary
    // saying "since 2024-03-14" is grounded if that timestamp was given.
    for (const part of extractFigures(tx.timestamp)) {
      allowed.add(part);
    }
  }

  const chains = new Set([
    ...request.holdings.map((h) => h.chainName),
    ...request.recentTransactions.map((t) => t.chainName),
  ]);
  const tokens = new Set([
    ...request.holdings.map((h) => h.tokenSymbol),
    ...request.recentTransactions.map((t) => t.tokenSymbol),
  ]);

  for (const derived of [
    request.holdings.length,
    request.recentTransactions.length,
    chains.size,
    tokens.size,
  ]) {
    allowed.add(String(derived));
  }

  return allowed;
}

function extractFigures(text: string): string[] {
  const matches = text.replace(/,/g, '').match(NUMBER_PATTERN) ?? [];
  return matches.map(normalizeFigure);
}

/**
 * "1.50", "1.5", and "01.5" are the same figure; "1.5" and "15" are not.
 * Pure string surgery — trimming zeros off each end of the decimal point
 * rather than round-tripping through a float.
 */
function normalizeFigure(raw: string): string {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned.includes('.')) return stripLeadingZeros(cleaned);

  const [whole, frac] = cleaned.split('.');
  const trimmedFrac = frac.replace(/0+$/, '');
  const trimmedWhole = stripLeadingZeros(whole);
  return trimmedFrac ? `${trimmedWhole}.${trimmedFrac}` : trimmedWhole;
}

function stripLeadingZeros(value: string): string {
  const stripped = value.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}

/**
 * Coverage answers the opposite question from grounding: grounding catches
 * a summary that says too much, coverage catches one that says too little.
 * A model that returns "You have a wallet." is perfectly grounded and
 * useless — only coverage notices.
 */
export function gradeCoverage(request: InsightRequest, summary: string): CoverageResult {
  const expected = Array.from(
    new Set([
      ...request.holdings.map((h) => h.tokenSymbol),
      ...request.holdings.map((h) => h.chainName),
    ]),
  );

  const haystack = summary.toLowerCase();
  const mentioned = expected.filter((term) => haystack.includes(term.toLowerCase()));
  const missing = expected.filter((term) => !mentioned.includes(term));

  return {
    expected,
    mentioned,
    missing,
    // An empty wallet has nothing to cover; scoring that 0 would punish a
    // correct "this wallet is empty" summary. 1 is the honest score for
    // "covered everything there was".
    score: expected.length === 0 ? 1 : mentioned.length / expected.length,
  };
}

export function gradeCase(request: InsightRequest, summary: string): GradedCase {
  return {
    grounding: gradeGrounding(request, summary),
    coverage: gradeCoverage(request, summary),
  };
}
