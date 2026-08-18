import { ConfigService } from '@nestjs/config';
import { StubInsightProvider } from '../stub-insight.provider';
import { OpenAIInsightProvider } from '../openai-insight.provider';
import { GroqInsightProvider } from '../groq-insight.provider';
import { InsightProvider } from '../insight-provider.interface';

/**
 * Shared by every CLI entry point under evals/ (run-evals.ts,
 * measure-spend.ts) so `--provider=` means the same thing everywhere and
 * the "stub by default, openai/groq are opt-in and hit a real API" decision
 * is made in exactly one place.
 */
export function resolveProviderFromArgv(): { provider: InsightProvider; name: string } {
  const arg = process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1] ?? 'stub';

  // Minimal ConfigService standing in for Nest's DI — these scripts run
  // outside the Nest application context, and each provider only needs one
  // key from it.
  const config = new ConfigService();

  if (arg === 'openai') {
    return { provider: new OpenAIInsightProvider(config), name: 'openai (billed)' };
  }

  if (arg === 'groq') {
    return { provider: new GroqInsightProvider(config), name: 'groq (free tier)' };
  }

  if (arg !== 'stub') {
    console.error(`Unknown --provider=${arg}. Expected "stub", "openai", or "groq".`);
    process.exit(1);
  }

  return { provider: new StubInsightProvider(), name: 'stub (offline, free — usage figures are estimated)' };
}
