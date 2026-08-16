import { InsightRequest } from './insight-provider.interface';

export interface InsightPrompt {
  system: string;
  user: string;
}

/**
 * The grounding instruction is the whole point of this file: an insight
 * that cites a number not present in the input is worse than no insight
 * at all — CLAUDE.md's "state what broke" ethos applied to the model
 * itself would call a hallucinated balance exactly that, broken. Every
 * rule below exists to make that failure mode explicit and refusable
 * rather than something the model has to infer is undesirable.
 */
const SYSTEM_PROMPT = `You are a portfolio summarizer for Ledgerlens, a read-only multi-chain
crypto portfolio tracker. Write a brief, factual summary of the wallet's current holdings and
recent activity, for the person who owns it.

Rules:
- Use ONLY the figures given to you in the data below. Never invent, estimate, round dramatically,
  or infer a number that is not explicitly present in the input.
- If a figure isn't in the input, don't mention it — say the data doesn't cover it rather than
  guessing or filling the gap.
- If there are no holdings or no recent transactions, say so plainly instead of describing
  activity that isn't there.
- Do not give investment advice, price predictions, or valuations in any fiat currency — none of
  that data is provided to you, so you cannot know it.
- Keep it to 2-4 sentences.`;

/** Pure function: same input always produces the same prompt text, which
 *  is what makes this independently testable without a real model call. */
export function buildInsightPrompt(request: InsightRequest): InsightPrompt {
  const holdingsText = request.holdings.length
    ? request.holdings.map((h) => `- ${h.displayBalance} ${h.tokenSymbol} on ${h.chainName}`).join('\n')
    : '(no holdings)';

  const txText = request.recentTransactions.length
    ? request.recentTransactions
        .map((t) => `- ${t.timestamp}: ${t.direction} ${t.displayAmount} ${t.tokenSymbol} on ${t.chainName}`)
        .join('\n')
    : '(no recent transactions)';

  const user = `Wallet: ${request.walletLabel ?? 'Unnamed'} (${request.address})

Current holdings:
${holdingsText}

Recent transactions:
${txText}`;

  return { system: SYSTEM_PROMPT, user };
}
