import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { HoldingsSummary } from '@/components/HoldingsSummary';
import { TransactionTable } from '@/components/TransactionTable';
import { TransactionFilters } from '@/components/TransactionFilters';
import { TransactionPagination } from '@/components/TransactionPagination';
import { SyncControls } from '@/components/SyncControls';
import { InsightPanel } from '@/components/InsightPanel';
import { SignOutButton } from '@/components/SignOutButton';
import { getAuthedSession } from '@/lib/serviceAuth';
import {
  fetchWallets,
  fetchHoldings,
  fetchTransactions,
  type WalletSummary,
  type SerializedHolding,
  type HoldingIssue,
  type TransactionsResponse,
  type TransactionSortField,
  type SortDirection,
} from '@/lib/api';
import type { TransactionUrlState } from '@/lib/transactionUrl';

const TRANSACTIONS_PAGE_SIZE = 25;

interface PageProps {
  searchParams: {
    wallet?: string;
    chain?: string;
    token?: string;
    sort?: string;
    dir?: string;
    page?: string;
  };
}

/**
 * Server Component. Fetches wallets, then — for whichever wallet ends up
 * selected — holdings and transactions in parallel. All data for the initial
 * render is ready before anything reaches the client; wallet switching is a
 * <Link> to a new ?wallet= value, which re-runs this fetch rather than
 * calling out from the browser. loading.tsx covers the in-between.
 */
export default async function Home({ searchParams }: PageProps) {
  const session = await getAuthedSession();
  if (!session) redirect('/login');

  let wallets: WalletSummary[] = [];
  let apiError: string | null = null;

  try {
    wallets = await fetchWallets(session.token);
  } catch {
    apiError = 'Could not reach the API. Is the backend running on port 3001?';
  }

  const requestedId = searchParams.wallet;
  // find() against undefined/empty requestedId simply matches nothing, so
  // this falls through to wallets[0] without a separate empty-string check.
  const selected = wallets.find((w) => w.id === requestedId) ?? wallets[0] ?? null;

  let holdings: SerializedHolding[] = [];
  let issues: HoldingIssue[] = [];
  let txResponse: TransactionsResponse = {
    transactions: [],
    total: 0,
    page: 1,
    pageSize: TRANSACTIONS_PAGE_SIZE,
    filters: { chains: [], tokens: [] },
  };

  if (selected && !apiError) {
    try {
      const [holdingsRes, txRes] = await Promise.all([
        fetchHoldings(session.token, selected.id),
        fetchTransactions(session.token, selected.id, {
          chain: searchParams.chain,
          token: searchParams.token,
          sort: searchParams.sort as TransactionSortField | undefined,
          dir: searchParams.dir as SortDirection | undefined,
          page: searchParams.page ? Number(searchParams.page) : undefined,
          pageSize: TRANSACTIONS_PAGE_SIZE,
        }),
      ]);
      holdings = holdingsRes.holdings;
      issues = holdingsRes.issues;
      txResponse = txRes;
    } catch {
      apiError = 'Failed to load wallet data.';
    }
  }

  // Single source of "current URL state" passed to the sort headers,
  // pagination links, and filter selects — see transactionUrl.ts.
  const currentTxUrl: TransactionUrlState = {
    wallet: selected?.id,
    chain: searchParams.chain,
    token: searchParams.token,
    sort: searchParams.sort,
    dir: searchParams.dir,
    page: searchParams.page,
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 flex items-start justify-between border-b border-rule pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Ledgerlens</h1>
          <p className="mt-1 text-ink/60">Multi-chain portfolio, one ledger.</p>
        </div>
        <div className="flex items-center gap-3 pt-1 text-xs text-ink/50">
          <span>{session.email}</span>
          <SignOutButton />
        </div>
      </header>

      {apiError && (
        <div className="mb-6 border border-oxblood/30 bg-oxblood/5 px-4 py-3 text-sm text-oxblood">
          {apiError}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <Sidebar wallets={wallets} selectedId={selected?.id ?? null} />

        <main className="space-y-8">
          {!selected ? (
            <div className="border border-rule bg-white p-12 text-center">
              <p className="text-ink/60">No wallets yet. Add one to see your holdings.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-xl font-semibold tracking-tight">
                    {selected.label ?? 'Wallet'}
                  </h2>
                  <p className="text-xs text-ink/40">
                    {selected.lastSyncedAt
                      ? `Last synced ${new Date(selected.lastSyncedAt).toLocaleString()}`
                      : 'Never synced'}
                  </p>
                </div>
                <SyncControls walletId={selected.id} />
              </div>

              <section>
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink/50">
                  Holdings
                </h3>
                <HoldingsSummary
                  holdings={holdings}
                  issues={issues}
                  neverSynced={!selected.lastSyncedAt}
                />
              </section>

              <InsightPanel walletId={selected.id} />

              <section>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-ink/50">
                    Transactions
                  </h3>
                  <TransactionFilters
                    current={currentTxUrl}
                    chains={txResponse.filters.chains}
                    tokens={txResponse.filters.tokens}
                  />
                </div>
                <TransactionTable transactions={txResponse.transactions} current={currentTxUrl} />
                <TransactionPagination
                  current={currentTxUrl}
                  page={txResponse.page}
                  pageSize={txResponse.pageSize}
                  total={txResponse.total}
                />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
