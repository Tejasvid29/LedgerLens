import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletsModule } from '../wallets/wallets.module';
import { AuthModule } from '../auth/auth.module';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { OpenAIInsightProvider } from './openai-insight.provider';
import { INSIGHT_PROVIDER, InsightProvider } from './insight-provider.interface';

/**
 * The one place a concrete provider class gets named. Adding a second
 * provider later means: implement InsightProvider, add one case below —
 * InsightsService and InsightsController don't change at all.
 */
@Module({
  imports: [WalletsModule, AuthModule],
  controllers: [InsightsController],
  providers: [
    InsightsService,
    OpenAIInsightProvider,
    {
      provide: INSIGHT_PROVIDER,
      useFactory: (config: ConfigService, openai: OpenAIInsightProvider): InsightProvider => {
        const providerName = config.get<string>('LLM_PROVIDER', 'openai');
        switch (providerName) {
          case 'openai':
            return openai;
          default:
            throw new Error(
              `Unknown LLM_PROVIDER "${providerName}" — expected "openai" (see .env).`,
            );
        }
      },
      inject: [ConfigService, OpenAIInsightProvider],
    },
  ],
})
export class InsightsModule {}
