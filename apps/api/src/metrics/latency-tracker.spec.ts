import { LatencyTracker } from './latency-tracker';

describe('LatencyTracker', () => {
  it('starts empty without dividing by zero', () => {
    expect(new LatencyTracker().stats()).toEqual({
      count: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
    });
  });

  it('computes a simple average', () => {
    const t = new LatencyTracker();
    [10, 20, 30].forEach((ms) => t.record(ms));

    expect(t.stats().avgMs).toBe(20);
    expect(t.stats().count).toBe(3);
  });

  it('reports the max', () => {
    const t = new LatencyTracker();
    [5, 50, 15].forEach((ms) => t.record(ms));

    expect(t.stats().maxMs).toBe(50);
  });

  it('computes p50 as the median of an odd-sized sample', () => {
    const t = new LatencyTracker();
    [10, 20, 30, 40, 50].forEach((ms) => t.record(ms));

    expect(t.stats().p50Ms).toBe(30);
  });

  it('computes p95 such that ~95% of samples are at or below it', () => {
    const t = new LatencyTracker();
    for (let i = 1; i <= 100; i++) t.record(i);

    expect(t.stats().p95Ms).toBe(95);
  });

  it('keeps the lifetime count and average beyond the rolling window', () => {
    const t = new LatencyTracker();
    for (let i = 0; i < 250; i++) t.record(10); // window caps at 200

    expect(t.stats().count).toBe(250);
    expect(t.stats().avgMs).toBe(10);
  });

  it('lets recent samples outweigh old ones for percentiles past the window', () => {
    const t = new LatencyTracker();
    for (let i = 0; i < 200; i++) t.record(5); // fills the window
    for (let i = 0; i < 200; i++) t.record(500); // evicts all the 5s

    // p95 should reflect only what's still in the window — a Redis outage
    // from an hour ago shouldn't still be dragging the percentile down.
    expect(t.stats().p95Ms).toBe(500);
  });

  it('resets to empty', () => {
    const t = new LatencyTracker();
    t.record(100);
    t.reset();

    expect(t.stats().count).toBe(0);
  });
});
