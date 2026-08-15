import type { Transaction } from '@/lib/api';

interface Props {
  transactions: Transaction[];
}

function directionColor(direction: Transaction['direction']) {
  if (direction === 'IN') return 'text-ledgerGreen';
  if (direction === 'OUT') return 'text-oxblood';
  return 'text-ink/50';
}

function directionPrefix(direction: Transaction['direction']) {
  if (direction === 'IN') return '+';
  if (direction === 'OUT') return '−';
  return '';
}

export function TransactionTable({ transactions }: Props) {
  if (transactions.length === 0) {
    return (
      <div className="border border-rule bg-white p-12 text-center">
        <p className="text-ink/60">No transactions yet.</p>
        <p className="mt-1 text-sm text-ink/40">Sync a wallet to pull history from the chain.</p>
      </div>
    );
  }

  return (
    <div className="border border-rule bg-white">
      <div className="grid grid-cols-[1fr_100px_120px_140px_80px] gap-4 border-b border-rule px-4 py-3 text-xs font-medium uppercase tracking-wide text-ink/50">
        <span>Date</span>
        <span>Chain</span>
        <span>Token</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Dir</span>
      </div>

      {transactions.map((tx) => (
        <div
          key={tx.id}
          className="ledger-row grid grid-cols-[1fr_100px_120px_140px_80px] gap-4 px-4 py-2.5 text-sm"
        >
          <span className="font-mono tabular-amount text-ink/80">
            {new Date(tx.timestamp).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
          <span className="text-ink/70">{tx.chainName}</span>
          <span className="font-mono text-ink/80">{tx.tokenSymbol}</span>
          <span className={`font-mono tabular-amount text-right ${directionColor(tx.direction)}`}>
            {directionPrefix(tx.direction)}{tx.displayAmount}
          </span>
          <span className={`text-right text-xs uppercase ${directionColor(tx.direction)}`}>
            {tx.direction}
          </span>
        </div>
      ))}
    </div>
  );
}
