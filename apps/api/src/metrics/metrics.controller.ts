import { Controller, Get } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly cache: CacheService) {}

  @Get()
  getMetrics() {
    return {
      cache: this.cache.getMetrics(),
      /**
       * latency.cache: Redis round-trip time. latency.origin: Postgres query
       * time via the cache's loader. Reported separately, not combined, since
       * they answer different questions — "is Redis healthy" vs. "is the
       * query itself slow" — and averaging them together would answer neither.
       */
      latency: this.cache.getLatency(),
      timestamp: new Date().toISOString(),
    };
  }
}
