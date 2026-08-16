/** How many recent samples percentiles are computed over. */
const WINDOW_SIZE = 200;

export interface LatencyStats {
  /** Total samples ever recorded, not just what's in the window. */
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

const EMPTY_STATS: LatencyStats = { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };

/**
 * Fixed-window latency stats for one layer (cache round-trip, origin query).
 *
 * `avgMs` is a lifetime average (count + running sum — O(1) memory). The
 * percentiles are windowed to the most recent `WINDOW_SIZE` samples instead,
 * since a lifetime p95 would keep reflecting a Redis outage from an hour ago
 * long after it resolved. No external metrics library — this is a gauge for
 * `/metrics`, not a production observability pipeline.
 */
export class LatencyTracker {
  private readonly window: number[] = [];
  private totalCount = 0;
  private totalMs = 0;

  record(ms: number): void {
    this.totalCount++;
    this.totalMs += ms;
    this.window.push(ms);
    if (this.window.length > WINDOW_SIZE) this.window.shift();
  }

  stats(): LatencyStats {
    if (this.totalCount === 0) return EMPTY_STATS;

    const sorted = [...this.window].sort((a, b) => a - b);
    return {
      count: this.totalCount,
      avgMs: round(this.totalMs / this.totalCount),
      p50Ms: round(percentile(sorted, 0.5)),
      p95Ms: round(percentile(sorted, 0.95)),
      maxMs: round(sorted[sorted.length - 1]),
    };
  }

  reset(): void {
    this.window.length = 0;
    this.totalCount = 0;
    this.totalMs = 0;
  }
}

/** Nearest-rank percentile over an already-sorted array. */
function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}
