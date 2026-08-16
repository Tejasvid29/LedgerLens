import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InsightProvider, InsightRequest, InsightResult } from './insight-provider.interface';
import { buildInsightPrompt } from './prompt';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

/**
 * Talks to OpenAI's Chat Completions API directly via fetch rather than the
 * `openai` SDK — this is one HTTP call with a fixed shape, and avoiding the
 * dependency keeps the "ask before adding a dependency" question moot for
 * this slice. Swapping to the SDK later (or to a different provider
 * entirely) only ever means changing this one file — InsightsService and
 * everything upstream of it depend on InsightProvider, not this class.
 */
@Injectable()
export class OpenAIInsightProvider implements InsightProvider {
  constructor(private readonly config: ConfigService) {}

  async generateInsight(request: InsightRequest): Promise<InsightResult> {
    const apiKey = this.resolveApiKey();
    const { system, user } = buildInsightPrompt(request);

    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          // Deterministic, not creative — this is a factual figures-only
          // summary, and temperature 0 is one more guard against the
          // model embellishing beyond what the prompt grounds it to.
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `Could not reach OpenAI: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new InternalServerErrorException(`OpenAI request failed: HTTP ${res.status} ${body}`);
    }

    const data = await res.json();
    const summary = data?.choices?.[0]?.message?.content;
    if (typeof summary !== 'string' || summary.trim() === '') {
      throw new InternalServerErrorException('OpenAI response did not include a summary.');
    }

    return { summary: summary.trim(), model: MODEL, generatedAt: new Date().toISOString() };
  }

  private resolveApiKey(): string {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    // Root .env ships with a literal placeholder (see .env's LLM section) —
    // catching it here gives a specific, actionable error instead of
    // OpenAI's generic "invalid API key" from a request that was always
    // going to fail.
    if (!apiKey || apiKey === 'your-openai-api-key') {
      throw new InternalServerErrorException(
        'OPENAI_API_KEY is not set (or still the placeholder) — get one from platform.openai.com and set it in .env.',
      );
    }
    return apiKey;
  }
}
