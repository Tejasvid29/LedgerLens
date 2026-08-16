'use client';

import { useState } from 'react';
import { generateInsightAction } from '@/lib/actions';
import type { InsightSummary } from '@/lib/api';

interface Props {
  walletId: string;
}

/**
 * Client island: holds the last-generated insight in local state rather
 * than page state, deliberately (see actions.ts's generateInsightAction —
 * no revalidatePath). Switching wallets or refreshing clears it, same as
 * asking the question again would need a fresh answer anyway.
 */
export function InsightPanel({ walletId }: Props) {
  const [result, setResult] = useState<InsightSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      setResult(await generateInsightAction(walletId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate an insight.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-rule bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink/50">Insight</h3>
        <button
          onClick={handleGenerate}
          disabled={loading}
          data-testid="generate-insight-button"
          className="border border-indigo px-3 py-1.5 text-sm text-indigo hover:bg-indigo/5 disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Generate insight'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-oxblood">{error}</p>}

      {result && (
        <div className="mt-4">
          <p data-testid="insight-summary" className="text-sm leading-relaxed text-ink/80">
            {result.summary}
          </p>
          <p className="mt-2 text-xs text-ink/40">
            {result.model} · {result.cached ? 'cached' : 'freshly generated'}
          </p>
        </div>
      )}
    </div>
  );
}
