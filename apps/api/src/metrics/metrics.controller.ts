import { Controller, Get } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly cache: CacheService) {}

  @Get()
  getMetrics() {
    return {
      cache: this.cache.getMetrics(),
      timestamp: new Date().toISOString(),
    };
  }
}
