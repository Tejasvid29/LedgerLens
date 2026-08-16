import Link from 'next/link';
import type { WalletSummary } from '@/lib/api';
import { AddWalletForm } from './AddWalletForm';

interface Props {
  wallets: WalletSummary[];
  selectedId: string | null;
}

/**
 * Server Component. Wallet switching is a plain <Link> to ?wallet=<id> —
 * navigating it re-runs the page's server-side data fetch for the new
 * wallet, so no client state or fetch code is needed here at all. Only
 * AddWalletForm needs 'use client', for its form state and submit handler.
 */
export function Sidebar({ wallets, selectedId }: Props) {
  return (
    <aside className="space-y-6">
      <AddWalletForm />

      {wallets.length > 0 && (
        <div className="border border-rule bg-white">
          <div className="border-b border-rule px-4 py-3 text-xs font-medium uppercase tracking-wide text-ink/50">
            Wallets
          </div>
          {wallets.map((w) => (
            <Link
              key={w.id}
              href={`/?wallet=${w.id}`}
              className={`ledger-row block px-4 py-3 text-left text-sm hover:bg-indigo/5 ${
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
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}
