import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletsModule } from '../wallets/wallets.module';
import { AuthModule } from '../auth/auth.module';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { OpenAIInsightProvider } from './openai-insight.provider';
import { GroqInsightProvider } from './groq-insight.provider';
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
 *
 * "groq" is a real LLM call like "openai", just against Groq's
 * OpenAI-compatible free tier instead — no billing required, unlike
 * OpenAI's pay-as-you-go. See groq-insight.provider.ts.
 */
@Module({
  imports: [WalletsModule, AuthModule],
  controllers: [InsightsController],
  providers: [
    InsightsService,
    OpenAIInsightProvider,
    GroqInsightProvider,
    StubInsightProvider,
    {
      provide: INSIGHT_PROVIDER,
      useFactory: (
        config: ConfigService,
        openai: OpenAIInsightProvider,
        groq: GroqInsightProvider,
        stub: StubInsightProvider,
      ): InsightProvider => {
        const providerName = config.get<string>('LLM_PROVIDER', 'openai');
        switch (providerName) {
          case 'openai':
            return openai;
          case 'groq':
            return groq;
          case 'stub':
            return stub;
          default:
            throw new Error(
              `Unknown LLM_PROVIDER "${providerName}" — expected "openai", "groq", or "stub" (see .env).`,
            );
        }
      },
      inject: [ConfigService, OpenAIInsightProvider, GroqInsightProvider, StubInsightProvider],
    },
  ],
})
export class InsightsModule {}
