import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InsightProvider, InsightRequest, InsightResult } from './insight-provider.interface';
import { buildInsightPrompt } from './prompt';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

/**
 * Free alternative to OpenAIInsightProvider — Groq's Chat Completions API
 * is OpenAI-compatible (same request/response shape, different base URL
 * and model), so this is deliberately almost line-for-line the same file.
 * Picked over OpenAI when a resume-project deploy needs a real LLM call
 * without a billed OpenAI account: Groq's free tier needs no credit card.
 * Get a key at console.groq.com.
 */
@Injectable()
export class GroqInsightProvider implements InsightProvider {
  constructor(private readonly config: ConfigService) {}

  async generateInsight(request: InsightRequest): Promise<InsightResult> {
    const apiKey = this.resolveApiKey();
    const { system, user } = buildInsightPrompt(request);

    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          // Same reasoning as OpenAIInsightProvider: factual, grounded
          // summary, not creative — temperature 0.
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `Could not reach Groq: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new InternalServerErrorException(`Groq request failed: HTTP ${res.status} ${body}`);
    }

    const data = await res.json();
    const summary = data?.choices?.[0]?.message?.content;
    if (typeof summary !== 'string' || summary.trim() === '') {
      throw new InternalServerErrorException('Groq response did not include a summary.');
    }

    return {
      summary: summary.trim(),
      model: MODEL,
      generatedAt: new Date().toISOString(),
      usage: this.parseUsage(data?.usage),
    };
  }

  /** Same shape as OpenAI's usage block — Groq's API is OpenAI-compatible. */
  private parseUsage(usage: unknown): { promptTokens: number; completionTokens: number; totalTokens: number } {
    const u = usage as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } | undefined;
    const promptTokens = typeof u?.prompt_tokens === 'number' ? u.prompt_tokens : 0;
    const completionTokens = typeof u?.completion_tokens === 'number' ? u.completion_tokens : 0;
    const totalTokens = typeof u?.total_tokens === 'number' ? u.total_tokens : promptTokens + completionTokens;
    return { promptTokens, completionTokens, totalTokens };
  }

  private resolveApiKey(): string {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey || apiKey === 'your-groq-api-key') {
      throw new InternalServerErrorException(
        'GROQ_API_KEY is not set (or still the placeholder) — get a free one from console.groq.com and set it in .env.',
      );
    }
    return apiKey;
  }
}
