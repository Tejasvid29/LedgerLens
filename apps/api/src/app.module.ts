import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CacheModule } from './cache/cache.module';
import { ChainModule } from './chain/chain.module';
import { WalletsModule } from './wallets/wallets.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CacheModule,
    ChainModule,
    WalletsModule,
    MetricsModule,
  ],
})
export class AppModule {}
