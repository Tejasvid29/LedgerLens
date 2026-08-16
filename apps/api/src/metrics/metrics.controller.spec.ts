import { MetricsController } from './metrics.controller';
import { CacheService } from '../cache/cache.service';

describe('MetricsController', () => {
  it('reports cache hit-rate metrics and per-layer latency together', () => {
    const cache = {
      getMetrics: jest.fn().mockReturnValue({
        hits: 8,
        staleHits: 1,
        misses: 1,
        errors: 0,
        shortCircuited: 0,
        hitRate: 0.9,
      }),
      getLatency: jest.fn().mockReturnValue({
        cache: { count: 10, avgMs: 2, p50Ms: 1, p95Ms: 4, maxMs: 5 },
        origin: { count: 1, avgMs: 40, p50Ms: 40, p95Ms: 40, maxMs: 40 },
      }),
    };

    const controller = new MetricsController(cache as unknown as CacheService);
    const result = controller.getMetrics();

    expect(result.cache.hitRate).toBe(0.9);
    expect(result.latency.cache.avgMs).toBe(2);
    expect(result.latency.origin.avgMs).toBe(40);
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });
});
