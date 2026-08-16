import Link from 'next/link';
import type { SerializedTransaction, TransactionSortField } from '@/lib/api';
import { LedgerAmount } from './LedgerAmount';
import { buildTransactionsUrl, type TransactionUrlState } from '@/lib/transactionUrl';

interface Props {
  transactions: SerializedTransaction[];
  current: TransactionUrlState;
}

// Direction is the only place gain/loss color applies here — it's the one
// figure with real gain/loss meaning (funds arriving vs. leaving this
// wallet). Chain, token, and date are identity, not performance; they stay
// ink.
function directionColor(direction: SerializedTransaction['direction']) {
  if (direction === 'IN') return 'text-ledgerGreen';
  if (direction === 'OUT') return 'text-oxblood';
  return 'text-ink/50';
}

function directionPrefix(direction: SerializedTransaction['direction']) {
  if (direction === 'IN') return '+';
  if (direction === 'OUT') return '−';
  return '';
}

interface HeaderProps {
  field: TransactionSortField;
  label: string;
  current: TransactionUrlState;
  align?: 'left' | 'right';
}

/**
 * A <Link> to the same URL with this field's sort applied — no client JS,
 * matching the wallet-switch pattern from S9. First click on a new field
 * sorts descending (matches the default timestamp-desc sort so the
 * behavior is predictable); clicking the already-active field toggles.
 */
function SortableHeader({ field, label, current, align = 'left' }: HeaderProps) {
  const active = (current.sort ?? 'timestamp') === field;
  const activeDir = current.dir ?? 'desc';
  const nextDir = active && activeDir === 'desc' ? 'asc' : 'desc';

  return (
    <Link
      href={buildTransactionsUrl(current, { sort: field, dir: nextDir, page: undefined })}
      className={`flex items-center gap-1 hover:text-ink ${align === 'right' ? 'justify-end' : ''} ${
        active ? 'text-ink' : ''
      }`}
    >
      {label}
      {active && <span aria-hidden>{activeDir === 'desc' ? '↓' : '↑'}</span>}
    </Link>
  );
}

/** No client interactivity — a pure render of server-fetched, server-sorted
 *  data. Sorting/filtering are all navigations, not client state. */
export function TransactionTable({ transactions, current }: Props) {
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
        <SortableHeader field="timestamp" label="Date" current={current} />
        <SortableHeader field="chainName" label="Chain" current={current} />
        <SortableHeader field="tokenSymbol" label="Token" current={current} />
        <SortableHeader field="amount" label="Amount" current={current} align="right" />
        <SortableHeader field="direction" label="Dir" current={current} align="right" />
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
          <span className={directionColor(tx.direction)}>
            <LedgerAmount value={tx.displayAmount} prefix={directionPrefix(tx.direction)} />
          </span>
          <span className={`self-center text-right text-xs uppercase ${directionColor(tx.direction)}`}>
            {tx.direction}
          </span>
        </div>
      ))}
    </div>
  );
}
