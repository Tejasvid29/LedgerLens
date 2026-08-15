import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis: Redis;
  private hits = 0;
  private misses = 0;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
    this.redis.connect().catch(() => {
      // Redis optional during local dev without docker
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw == null) {
        this.misses++;
        return null;
      }
      this.hits++;
      return JSON.parse(raw) as T;
    } catch {
      this.misses++;
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // fail open — caller falls through to origin
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // ignore
    }
  }

  getMetrics(): CacheMetrics {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
