import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CacheModule } from './cache/cache.module';
import { ChainModule } from './chain/chain.module';
import { WalletsModule } from './wallets/wallets.module';
import { MetricsModule } from './metrics/metrics.module';
import { InsightsModule } from './insights/insights.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // npm workspaces runs this script with cwd = apps/api, but the single
    // .env lives at the repo root (see README: `cp .env.example .env`).
    // Point ConfigModule there explicitly instead of relying on cwd. In
    // production (Docker on ECS) this file simply doesn't exist at that
    // path — ConfigModule doesn't throw on a missing envFilePath, it just
    // falls through to whatever's already in process.env, which is where
    // ECS's task definition puts real secrets. See docs/deploy.md.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: join(process.cwd(), '..', '..', '.env') }),
    PrismaModule,
    CacheModule,
    ChainModule,
    WalletsModule,
    MetricsModule,
    InsightsModule,
    HealthModule,
  ],
})
export class AppModule {}
