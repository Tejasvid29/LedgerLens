'use client';

import { useRouter } from 'next/navigation';
import { buildTransactionsUrl, type TransactionUrlState } from '@/lib/transactionUrl';

interface Props {
  current: TransactionUrlState;
  chains: { chainId: number; chainName: string }[];
  tokens: string[];
}

/**
 * Client island: <select onChange> needs JS to navigate. Everything else
 * about "what's the current state" comes in as props from the Server
 * Component that already fetched it — this doesn't call useSearchParams,
 * so it doesn't need its own Suspense boundary.
 *
 * Changing a filter resets page to 1: a filter narrowing the result set
 * could otherwise leave you on a page number past the new total.
 */
export function TransactionFilters({ current, chains, tokens }: Props) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-3">
      <label className="text-xs">
        <span className="mb-1 block font-medium uppercase tracking-wide text-ink/50">Chain</span>
        <select
          value={current.chain ?? ''}
          onChange={(e) => {
            const chain = e.target.value || undefined;
            router.push(buildTransactionsUrl(current, { chain, page: undefined }));
          }}
          className="border border-rule bg-white px-2 py-1.5 text-sm text-ink focus:border-indigo focus:outline-none"
        >
          <option value="">All chains</option>
          {chains.map((c) => (
            <option key={c.chainId} value={c.chainId}>
              {c.chainName}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs">
        <span className="mb-1 block font-medium uppercase tracking-wide text-ink/50">Token</span>
        <select
          value={current.token ?? ''}
          onChange={(e) => {
            const token = e.target.value || undefined;
            router.push(buildTransactionsUrl(current, { token, page: undefined }));
          }}
          className="border border-rule bg-white px-2 py-1.5 text-sm text-ink focus:border-indigo focus:outline-none"
        >
          <option value="">All tokens</option>
          {tokens.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      {(current.chain || current.token) && (
        <button
          onClick={() => router.push(buildTransactionsUrl(current, { chain: undefined, token: undefined, page: undefined }))}
          className="mt-5 self-start text-xs text-ink/40 hover:text-ink/60"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
