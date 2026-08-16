import { Sidebar } from '@/components/Sidebar';
import { HoldingsSummary } from '@/components/HoldingsSummary';
import { TransactionTable } from '@/components/TransactionTable';
import { SyncControls } from '@/components/SyncControls';
import {
  fetchWallets,
  fetchHoldings,
  fetchTransactions,
  type WalletSummary,
  type SerializedHolding,
  type SerializedTransaction,
  type HoldingIssue,
} from '@/lib/api';

interface PageProps {
  searchParams: { wallet?: string };
}

/**
 * Server Component. Fetches wallets, then — for whichever wallet ends up
 * selected — holdings and transactions in parallel. All data for the initial
 * render is ready before anything reaches the client; wallet switching is a
 * <Link> to a new ?wallet= value, which re-runs this fetch rather than
 * calling out from the browser. loading.tsx covers the in-between.
 */
export default async function Home({ searchParams }: PageProps) {
  let wallets: WalletSummary[] = [];
  let apiError: string | null = null;

  try {
    wallets = await fetchWallets();
  } catch {
    apiError = 'Could not reach the API. Is the backend running on port 3001?';
  }

  const requestedId = searchParams.wallet;
  // find() against undefined/empty requestedId simply matches nothing, so
  // this falls through to wallets[0] without a separate empty-string check.
  const selected = wallets.find((w) => w.id === requestedId) ?? wallets[0] ?? null;

  let holdings: SerializedHolding[] = [];
  let issues: HoldingIssue[] = [];
  let transactions: SerializedTransaction[] = [];

  if (selected && !apiError) {
    try {
      const [holdingsRes, txs] = await Promise.all([
        fetchHoldings(selected.id),
        fetchTransactions(selected.id),
      ]);
      holdings = holdingsRes.holdings;
      issues = holdingsRes.issues;
      transactions = txs;
    } catch {
      apiError = 'Failed to load wallet data.';
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 border-b border-rule pb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Ledgerlens</h1>
        <p className="mt-1 text-ink/60">Multi-chain portfolio, one ledger.</p>
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

              <section>
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink/50">
                  Transactions
                </h3>
                <TransactionTable transactions={transactions} />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
