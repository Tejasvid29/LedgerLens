'use client';

import { useState } from 'react';
import { createWallet } from '@/lib/api';

interface Props {
  onAdded: () => void;
}

export function AddWalletForm({ onAdded }: Props) {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        throw new Error('Enter a valid Ethereum address (0x…, 42 characters).');
      }
      await createWallet(address, label || undefined);
      setAddress('');
      setLabel('');
      onAdded();
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

      {error && (
        <p className="mt-3 text-sm text-oxblood">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-4 bg-indigo px-4 py-2 text-sm font-medium text-white hover:bg-indigo/90 disabled:opacity-50"
      >
        {loading ? 'Adding…' : 'Add wallet'}
      </button>
    </form>
  );
}
