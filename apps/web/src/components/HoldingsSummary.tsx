import type { SerializedHolding, HoldingIssue } from '@/lib/api';
import { LedgerAmount } from './LedgerAmount';

interface Props {
  holdings: SerializedHolding[];
  issues: HoldingIssue[];
  /** Wallet has never been synced — distinct from "synced, zero balances". */
  neverSynced: boolean;
}

/**
 * No client interactivity — a pure render of server-fetched data.
 *
 * Deliberately no ledgerGreen/oxblood here. Those colors mean gain/loss
 * per CLAUDE.md, and a holding balance isn't a gain or a loss on its own —
 * that would need a price feed this app doesn't have. Direction (in
 * TransactionTable) is the one figure that legitimately earns the color.
 */
export function HoldingsSummary({ holdings, issues, neverSynced }: Props) {
  if (neverSynced) {
    return (
      <div className="border border-rule bg-white p-12 text-center">
        <p className="text-ink/60">Not synced yet.</p>
        <p className="mt-1 text-sm text-ink/40">Sync from chain to see current holdings.</p>
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div className="border border-rule bg-white p-12 text-center">
        <p className="text-ink/60">No holdings.</p>
        <p className="mt-1 text-sm text-ink/40">Every synced balance nets to zero.</p>
      </div>
    );
  }

  return (
    <div className="border border-rule bg-white">
      <div className="grid grid-cols-[120px_1fr_160px] gap-4 border-b border-rule px-4 py-3 text-xs font-medium uppercase tracking-wide text-ink/50">
        <span>Chain</span>
        <span>Token</span>
        <span className="text-right">Balance</span>
      </div>

      {holdings.map((h) => {
        const negative = h.rawBalance.startsWith('-');
        return (
          <div
            key={`${h.chainId}:${h.tokenAddress ?? h.tokenSymbol}`}
            className="ledger-row grid grid-cols-[120px_1fr_160px] gap-4 px-4 py-2.5 text-sm"
          >
            <span className="text-ink/70">{h.chainName}</span>
            <span className="font-mono text-ink/80">{h.tokenSymbol}</span>
            <span>
              <LedgerAmount value={h.displayBalance} />
              {negative && (
                <span className="mt-0.5 block text-right text-[11px] text-ink/40">
                  incomplete history
                </span>
              )}
            </span>
          </div>
        );
      })}

      {issues.length > 0 && (
        <p className="border-t border-rule px-4 py-2 text-xs text-ink/40">
          {issues.length} data {issues.length === 1 ? 'issue' : 'issues'} found while computing
          balances — some figures above may be incomplete.
        </p>
      )}
    </div>
  );
}
