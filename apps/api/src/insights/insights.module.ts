import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletsModule } from '../wallets/wallets.module';
import { AuthModule } from '../auth/auth.module';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { OpenAIInsightProvider } from './openai-insight.provider';
import { StubInsightProvider } from './stub-insight.provider';
import { INSIGHT_PROVIDER, InsightProvider } from './insight-provider.interface';

/**
 * The one place a concrete provider class gets named. Adding a second
 * provider later means: implement InsightProvider, add one case below —
 * InsightsService and InsightsController don't change at all.
 *
 * "stub" is a real, first-class option here (not just for the eval
 * harness) — set for apps/e2e's Playwright run (see
 * apps/e2e/playwright.config.ts) so "generate an insight" in that suite
 * costs nothing and needs no OpenAI key, same reasoning as
 * CHAIN_PROVIDER=fixture in chain.module.ts. Never set it outside e2e.
 */
@Module({
  imports: [WalletsModule, AuthModule],
  controllers: [InsightsController],
  providers: [
    InsightsService,
    OpenAIInsightProvider,
    StubInsightProvider,
    {
      provide: INSIGHT_PROVIDER,
      useFactory: (
        config: ConfigService,
        openai: OpenAIInsightProvider,
        stub: StubInsightProvider,
      ): InsightProvider => {
        const providerName = config.get<string>('LLM_PROVIDER', 'openai');
        switch (providerName) {
          case 'openai':
            return openai;
          case 'stub':
            return stub;
          default:
            throw new Error(
              `Unknown LLM_PROVIDER "${providerName}" — expected "openai" or "stub" (see .env).`,
            );
        }
      },
      inject: [ConfigService, OpenAIInsightProvider, StubInsightProvider],
    },
  ],
})
export class InsightsModule {}
