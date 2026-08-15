'use client';

import { useCallback, useEffect, useState } from 'react';
import { AddWalletForm } from '@/components/AddWalletForm';
import { TransactionTable } from '@/components/TransactionTable';
import {
  fetchWallets,
  fetchTransactions,
  syncWallet,
  type Wallet,
  type Transaction,
} from '@/lib/api';

export function Dashboard() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWallets = useCallback(async () => {
    try {
      const data = await fetchWallets();
      setWallets(data);
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id);
      }
    } catch {
      setError('Could not reach the API. Is the backend running on port 3001?');
    }
  }, [selectedId]);

  useEffect(() => {
    loadWallets().finally(() => setLoading(false));
  }, [loadWallets]);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    fetchTransactions(selectedId)
      .then(setTransactions)
      .catch(() => setError('Failed to load transactions.'))
      .finally(() => setLoading(false));
  }, [selectedId]);

  async function handleSync(refresh = false) {
    if (!selectedId) return;
    setSyncing(true);
    setError(null);
    try {
      if (refresh) {
        await syncWallet(selectedId);
      }
      const txs = await fetchTransactions(selectedId, refresh);
      setTransactions(txs);
      await loadWallets();
    } catch {
      setError('Sync failed. Check your Alchemy API key and try again.');
    } finally {
      setSyncing(false);
    }
  }

  const selected = wallets.find((w) => w.id === selectedId);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 border-b border-rule pb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Ledgerlens</h1>
        <p className="mt-1 text-ink/60">Multi-chain portfolio, one ledger.</p>
      </header>

      {error && (
        <div className="mb-6 border border-oxblood/30 bg-oxblood/5 px-4 py-3 text-sm text-oxblood">
          {error}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-6">
          <AddWalletForm onAdded={loadWallets} />

          {wallets.length > 0 && (
            <div className="border border-rule bg-white">
              <div className="border-b border-rule px-4 py-3 text-xs font-medium uppercase tracking-wide text-ink/50">
                Wallets
              </div>
              {wallets.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  className={`ledger-row block w-full px-4 py-3 text-left text-sm hover:bg-indigo/5 ${
                    selectedId === w.id ? 'bg-indigo/10' : ''
                  }`}
                >
                  <span className="font-medium">{w.label ?? 'Unnamed'}</span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-ink/50">
                    {w.address}
                  </span>
                  {w._count && (
                    <span className="mt-1 block text-xs text-ink/40">
                      {w._count.transactions} transactions
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </aside>

        <main>
          {!selected ? (
            <div className="border border-rule bg-white p-12 text-center">
              <p className="text-ink/60">No wallets yet. Add one to see your holdings.</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-xl font-semibold tracking-tight">
                    {selected.label ?? 'Transactions'}
                  </h2>
                  {selected.lastSyncedAt && (
                    <p className="text-xs text-ink/40">
                      Last synced {new Date(selected.lastSyncedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSync(true)}
                    disabled={syncing}
                    className="border border-indigo px-3 py-1.5 text-sm text-indigo hover:bg-indigo/5 disabled:opacity-50"
                  >
                    {syncing ? 'Syncing…' : 'Sync from chain'}
                  </button>
                  <button
                    onClick={() => handleSync(false)}
                    disabled={syncing}
                    className="border border-rule px-3 py-1.5 text-sm text-ink/60 hover:bg-white disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="border border-rule bg-white p-12 text-center text-ink/40">
                  Loading…
                </div>
              ) : (
                <TransactionTable transactions={transactions} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
