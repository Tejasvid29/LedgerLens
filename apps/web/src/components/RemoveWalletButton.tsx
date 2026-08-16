'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteWalletAction } from '@/lib/actions';

interface Props {
  walletId: string;
  /** Whether this is the wallet currently shown — determines whether removal
   * needs to clear the ?wallet= param, or just refresh the list in place. */
  isSelected: boolean;
}

/**
 * Client island: a two-step inline confirm rather than window.confirm(), to
 * match the ledger-paper aesthetic instead of a native browser dialog.
 *
 * Deliberately not oxblood: oxblood is reserved for gains/losses in the
 * data (CLAUDE.md — "carry meaning, never decorative"), and removing a
 * wallet isn't a financial loss. The confirm step itself is the safety
 * mechanism, not color.
 */
export function RemoveWalletButton({ walletId, isSelected }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setRemoving(true);
    setError(null);
    try {
      await deleteWalletAction(walletId);
      if (isSelected) {
        router.push('/');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove wallet.');
      setConfirming(false);
      setRemoving(false);
    }
  }

  function handleCancel(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
  }

  function handleStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(true);
  }

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-2 text-xs">
        <button
          onClick={handleConfirm}
          disabled={removing}
          className="text-ink underline decoration-dotted underline-offset-2 hover:decoration-solid disabled:opacity-50"
        >
          {removing ? 'Removing…' : 'Confirm'}
        </button>
        <button onClick={handleCancel} disabled={removing} className="text-ink/40 hover:text-ink/60">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="shrink-0">
      <button
        onClick={handleStart}
        className="text-xs text-ink/30 hover:text-ink/60"
        aria-label="Remove wallet"
      >
        Remove
      </button>
      {error && <p className="mt-1 text-xs text-oxblood">{error}</p>}
    </span>
  );
}
