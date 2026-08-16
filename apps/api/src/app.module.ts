import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CacheModule } from './cache/cache.module';
import { ChainModule } from './chain/chain.module';
import { WalletsModule } from './wallets/wallets.module';
import { MetricsModule } from './metrics/metrics.module';
import { InsightsModule } from './insights/insights.module';

@Module({
  imports: [
    // npm workspaces runs this script with cwd = apps/api, but the single
    // .env lives at the repo root (see README: `cp .env.example .env`).
    // Point ConfigModule there explicitly instead of relying on cwd.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: join(process.cwd(), '..', '..', '.env') }),
    PrismaModule,
    CacheModule,
    ChainModule,
    WalletsModule,
    MetricsModule,
    InsightsModule,
  ],
})
export class AppModule {}
