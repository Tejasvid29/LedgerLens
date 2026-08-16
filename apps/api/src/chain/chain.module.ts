import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlchemyService } from './alchemy.service';
import { FixtureChainProvider } from './fixture-chain.provider';
import { CHAIN_PROVIDER, ChainProvider } from './chain-provider.interface';
import { SyncService } from './sync.service';

/**
 * Same shape as insights.module.ts's provider factory (S13): the one place
 * a concrete ChainProvider gets named. Defaults to Alchemy — CHAIN_PROVIDER
 * only needs to be set to "fixture" for apps/e2e's Playwright run (see
 * apps/e2e/playwright.config.ts), never in dev or prod.
 */
@Module({
  providers: [
    AlchemyService,
    FixtureChainProvider,
    SyncService,
    {
      provide: CHAIN_PROVIDER,
      useFactory: (
        config: ConfigService,
        alchemy: AlchemyService,
        fixture: FixtureChainProvider,
      ): ChainProvider => {
        const providerName = config.get<string>('CHAIN_PROVIDER', 'alchemy');
        switch (providerName) {
          case 'alchemy':
            return alchemy;
          case 'fixture':
            return fixture;
          default:
            throw new Error(
              `Unknown CHAIN_PROVIDER "${providerName}" — expected "alchemy" or "fixture".`,
            );
        }
      },
      inject: [ConfigService, AlchemyService, FixtureChainProvider],
    },
  ],
  exports: [AlchemyService, SyncService],
})
export class ChainModule {}
