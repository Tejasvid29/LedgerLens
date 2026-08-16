import { ConfigService } from '@nestjs/config';
import { StubInsightProvider } from './stub-insight.provider';
import { OpenAIInsightProvider } from '../openai-insight.provider';
import { InsightProvider } from '../insight-provider.interface';

/**
 * Shared by every CLI entry point under evals/ (run-evals.ts,
 * measure-spend.ts) so `--provider=` means the same thing everywhere and
 * the "stub by default, openai is opt-in and billed" decision is made in
 * exactly one place.
 */
export function resolveProviderFromArgv(): { provider: InsightProvider; name: string } {
  const arg = process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1] ?? 'stub';

  if (arg === 'openai') {
    // Minimal ConfigService standing in for Nest's DI — these scripts run
    // outside the Nest application context, and the provider only needs
    // one key from it.
    const config = new ConfigService();
    return { provider: new OpenAIInsightProvider(config), name: 'openai (billed)' };
  }

  if (arg !== 'stub') {
    console.error(`Unknown --provider=${arg}. Expected "stub" or "openai".`);
    process.exit(1);
  }

  return { provider: new StubInsightProvider(), name: 'stub (offline, free — usage figures are estimated)' };
}
