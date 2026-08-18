import type { SerializedTransaction } from '@/lib/api';

interface Props {
  transactions: SerializedTransaction[];
}

interface DayBucket {
  date: string;
  in: number;
  out: number;
  self: number;
}

/**
 * Transaction count per day, split by direction — not a dollar-value
 * chart. Amounts are per-token strings at different decimals (rule 1: never
 * a number, never summed across tokens without a price feed this project
 * doesn't have), so "activity" here means how many transfers happened, the
 * one thing safe to add up across every chain and token without inventing
 * a figure the data doesn't actually support.
 *
 * Hand-rolled SVG, no charting library — same ledger-paper tokens as
 * everywhere else (ledgerGreen for IN, oxblood for OUT, ink/30 for SELF),
 * IBM Plex Mono for the axis figures.
 */
export function TransactionActivityChart({ transactions }: Props) {
  if (transactions.length === 0) {
    return (
      <div className="border border-rule bg-white p-12 text-center">
        <p className="text-ink/60">No transactions yet.</p>
        <p className="mt-1 text-sm text-ink/40">Sync a wallet to pull history from the chain.</p>
      </div>
    );
  }

  const buckets = bucketByDay(transactions);
  const maxCount = Math.max(...buckets.map((b) => b.in + b.out + b.self), 1);

  const width = 720;
  const height = 220;
  const padding = { top: 12, right: 12, bottom: 28, left: 12 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const barGap = 4;
  const barWidth = Math.max(2, plotWidth / buckets.length - barGap);

  return (
    <div className="border border-rule bg-white p-4" data-testid="transaction-activity-chart">
      <div className="mb-3 flex items-center gap-4 text-xs text-ink/50">
        <Legend swatch="bg-ledgerGreen" label="In" />
        <Legend swatch="bg-oxblood" label="Out" />
        <Legend swatch="bg-ink/20" label="Self" />
        <span className="ml-auto font-mono tabular-amount text-ink/40">
          {transactions.length} transaction{transactions.length === 1 ? '' : 's'}
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Transaction activity by day">
        {/* Baseline */}
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          className="stroke-rule"
          strokeWidth={1}
        />

        {buckets.map((bucket, i) => {
          const total = bucket.in + bucket.out + bucket.self;
          const x = padding.left + i * (barWidth + barGap);
          const scale = plotHeight / maxCount;

          const inH = bucket.in * scale;
          const outH = bucket.out * scale;
          const selfH = bucket.self * scale;

          const baseY = height - padding.bottom;
          const inY = baseY - inH;
          const outY = inY - outH;
          const selfY = outY - selfH;

          // Only every Nth label, else a long history's axis becomes an
          // unreadable smear of overlapping dates.
          const showLabel = buckets.length <= 10 || i % Math.ceil(buckets.length / 10) === 0;

          return (
            <g key={bucket.date}>
              {bucket.in > 0 && (
                <rect x={x} y={inY} width={barWidth} height={inH} className="fill-ledgerGreen" />
              )}
              {bucket.out > 0 && (
                <rect x={x} y={outY} width={barWidth} height={outH} className="fill-oxblood" />
              )}
              {bucket.self > 0 && (
                <rect x={x} y={selfY} width={barWidth} height={selfH} className="fill-ink/20" />
              )}
              {total === 0 && <rect x={x} y={baseY - 1} width={barWidth} height={1} className="fill-rule" />}
              {showLabel && (
                <text
                  x={x + barWidth / 2}
                  y={height - padding.bottom + 14}
                  textAnchor="middle"
                  className="fill-ink/40 font-mono"
                  style={{ fontSize: 9 }}
                >
                  {formatDayLabel(bucket.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${swatch}`} aria-hidden />
      {label}
    </span>
  );
}

function bucketByDay(transactions: SerializedTransaction[]): DayBucket[] {
  const byDate = new Map<string, DayBucket>();

  for (const tx of transactions) {
    const date = tx.timestamp.slice(0, 10); // YYYY-MM-DD
    const bucket = byDate.get(date) ?? { date, in: 0, out: 0, self: 0 };
    if (tx.direction === 'IN') bucket.in += 1;
    else if (tx.direction === 'OUT') bucket.out += 1;
    else bucket.self += 1;
    byDate.set(date, bucket);
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
