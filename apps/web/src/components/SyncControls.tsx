'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { syncWalletAction } from '@/lib/actions';

interface Props {
  walletId: string;
}

/**
 * Client island for the two mutating actions on a selected wallet.
 *
 * "Refresh" needs no API call at all: it's router.refresh(), which re-runs
 * the page's server-side fetch. That fetch already goes through the API's
 * cache (S6/S7), so this just re-reads whatever's currently cached or
 * stored — it does not touch the chain.
 *
 * "Sync from chain" is the one action that actually costs Alchemy quota: it
 * POSTs /sync, which fetches from the chain, normalizes, persists, and
 * invalidates the cache — then refreshes so the page reflects it.
 */
export function SyncControls({ walletId }: Props) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      await syncWalletAction(walletId);
      router.refresh();
    } catch {
      setError('Sync failed. Check your Alchemy API key and try again.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="border border-indigo px-3 py-1.5 text-sm text-indigo hover:bg-indigo/5 disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync from chain'}
        </button>
        <button
          onClick={() => router.refresh()}
          disabled={syncing}
          className="border border-rule px-3 py-1.5 text-sm text-ink/60 hover:bg-white disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-oxblood">{error}</p>}
    </div>
  );
}
