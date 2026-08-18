'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isValidAddress } from '@ledgerlens/shared';
import { createWalletAction } from '@/lib/actions';

/**
 * Client island: the rest of the sidebar is a Server Component, but adding a
 * wallet needs form state and an error message, which Server Components
 * can't hold.
 *
 * On success, navigates to ?wallet=<newId> rather than calling a refetch
 * callback — that both selects the new wallet and re-runs the page's server
 * data fetch in one round-trip, instead of duplicating fetch logic here.
 */
export function AddWalletForm() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValidAddress(address)) {
      // Same check the API re-runs server-side (packages/shared/src/address.ts)
      // — this is just the fast, no-round-trip version.
      setError('Enter a valid wallet address (0x…, 42 characters).');
      return;
    }

    setLoading(true);
    try {
      const wallet = await createWalletAction(address, label || undefined);
      setAddress('');
      setLabel('');
      router.push(`/?wallet=${wallet.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-rule bg-white p-6">
      <h2 className="font-display text-lg font-semibold tracking-tight">Add wallet</h2>
      <p className="mt-1 text-sm text-ink/60">
        Read-only — paste an address to see holdings and history.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="address" className="block text-xs font-medium uppercase tracking-wide text-ink/50">
            Address
          </label>
          <input
            id="address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x…"
            data-testid="wallet-address-input"
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-mono text-sm focus:border-indigo focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="label" className="block text-xs font-medium uppercase tracking-wide text-ink/50">
            Label (optional)
          </label>
          <input
            id="label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Main wallet"
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 text-sm focus:border-indigo focus:outline-none"
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-oxblood">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        data-testid="add-wallet-submit"
        className="mt-4 bg-indigo px-4 py-2 text-sm font-medium text-white hover:bg-indigo/90 disabled:opacity-50"
      >
        {loading ? 'Adding & syncing across 6 chains…' : 'Add wallet'}
      </button>
      {loading && (
        <p className="mt-2 text-xs text-ink/40">
          Pulling live history — usually a few seconds, occasionally longer.
        </p>
      )}
    </form>
  );
}
