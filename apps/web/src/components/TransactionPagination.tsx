import Link from 'next/link';
import { buildTransactionsUrl, type TransactionUrlState } from '@/lib/transactionUrl';

interface Props {
  current: TransactionUrlState;
  page: number;
  pageSize: number;
  total: number;
}

/** Server Component — Prev/Next as plain <Link>s, no client JS. */
export function TransactionPagination({ current, page, pageSize, total }: Props) {
  if (total === 0) return null;

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between border-t border-rule px-4 py-3 text-xs text-ink/50">
      <span>
        {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-3">
        {page > 1 ? (
          <Link
            href={buildTransactionsUrl(current, { page: String(page - 1) })}
            className="text-ink/60 hover:text-ink"
          >
            ← Prev
          </Link>
        ) : (
          <span className="text-ink/25">← Prev</span>
        )}
        <span>
          Page {page} of {lastPage}
        </span>
        {page < lastPage ? (
          <Link
            href={buildTransactionsUrl(current, { page: String(page + 1) })}
            className="text-ink/60 hover:text-ink"
          >
            Next →
          </Link>
        ) : (
          <span className="text-ink/25">Next →</span>
        )}
      </div>
    </div>
  );
}
