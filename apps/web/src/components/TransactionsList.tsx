'use client';

import { useState, type ReactNode } from 'react';
import { TransactionTable } from './TransactionTable';
import { TransactionActivityChart } from './TransactionActivityChart';
import { loadMoreTransactionsAction } from '@/lib/actions';
import type { SerializedTransaction, TransactionSortField, SortDirection } from '@/lib/api';
import type { TransactionUrlState } from '@/lib/transactionUrl';

type View = 'table' | 'chart';

interface Props {
  walletId: string;
  initialTransactions: SerializedTransaction[];
  total: number;
  pageSize: number;
  current: TransactionUrlState;
}

/**
 * Client wrapper around the (still server-rendered-shape) TransactionTable.
 * Server Components can't hold the accumulated "how many pages have we
 * loaded" state a "Load more" button needs, so this is the client island —
 * same reasoning as AddWalletForm/SyncControls.
 *
 * Deliberately NOT infinite scroll: a click-triggered fetch of one more
 * page at a time is simpler, doesn't fight the sortable column headers'
 * full-page navigation, and — the actual point — means a wallet with
 * millions of transactions never has more than a handful of pages' worth
 * in memory at once, however long someone keeps clicking.
 *
 * Callers must pass `key={JSON.stringify(current)}` (see page.tsx) so a
 * filter/sort/wallet change remounts this with fresh initial state instead
 * of appending onto a now-stale accumulated list.
 */
export function TransactionsList({ walletId, initialTransactions, total, pageSize, current }: Props) {
  const [items, setItems] = useState(initialTransactions);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('table');

  const hasMore = items.length < total;

  async function handleLoadMore() {
    setLoading(true);
    setError(null);
    try {
      const nextPage = page + 1;
      const res = await loadMoreTransactionsAction(walletId, {
        chain: current.chain,
        token: current.token,
        sort: current.sort as TransactionSortField | undefined,
        dir: current.dir as SortDirection | undefined,
        page: nextPage,
        pageSize,
      });
      setItems((prev) => [...prev, ...res.transactions]);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more transactions.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {items.length > 0 && (
        <div className="mb-3 flex gap-1 text-xs font-medium uppercase tracking-wide">
          <TabButton active={view === 'table'} onClick={() => setView('table')} testId="view-table-tab">
            Table
          </TabButton>
          <TabButton active={view === 'chart'} onClick={() => setView('chart')} testId="view-chart-tab">
            Chart
          </TabButton>
        </div>
      )}

      {view === 'table' ? (
        <TransactionTable transactions={items} current={current} />
      ) : (
        <TransactionActivityChart transactions={items} />
      )}

      {total > 0 && (
        <div className="flex items-center justify-between border-t border-rule px-4 py-3 text-xs text-ink/50">
          <span className="tabular-amount font-mono">
            {items.length} of {total} loaded
          </span>
          {hasMore ? (
            <button
              onClick={handleLoadMore}
              disabled={loading}
              data-testid="load-more-transactions"
              className="text-indigo hover:text-indigo/80 disabled:opacity-50"
            >
              {loading ? 'Loading…' : `Load ${Math.min(pageSize, total - items.length)} more`}
            </button>
          ) : (
            <span className="text-ink/30">All loaded</span>
          )}
        </div>
      )}
      {error && <p className="px-4 pb-3 text-sm text-oxblood">{error}</p>}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={`border px-3 py-1.5 ${
        active
          ? 'border-indigo bg-indigo/5 text-indigo'
          : 'border-rule text-ink/50 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
