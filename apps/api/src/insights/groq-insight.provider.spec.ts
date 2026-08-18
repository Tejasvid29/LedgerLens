import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GroqInsightProvider } from './groq-insight.provider';
import { InsightRequest } from './insight-provider.interface';

function makeRequest(): InsightRequest {
  return { walletLabel: 'Main', address: '0xabc', holdings: [], recentTransactions: [] };
}

describe('GroqInsightProvider', () => {
  let config: { get: jest.Mock };
  let provider: GroqInsightProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    config = { get: jest.fn().mockReturnValue('gsk-real-key') };
    provider = new GroqInsightProvider(config as unknown as ConfigService);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects with a clear message when GROQ_API_KEY is unset, before making any request', async () => {
    config.get.mockReturnValue(undefined);

    await expect(provider.generateInsight(makeRequest())).rejects.toThrow(InternalServerErrorException);
    await expect(provider.generateInsight(makeRequest())).rejects.toThrow(/GROQ_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when GROQ_API_KEY is still the literal .env placeholder', async () => {
    config.get.mockReturnValue('your-groq-api-key');

    await expect(provider.generateInsight(makeRequest())).rejects.toThrow(/placeholder/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the Authorization header and a deterministic (temperature 0) request to the OpenAI-compatible Groq endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Summary text.' } }] }),
    });

    await provider.generateInsight(makeRequest());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer gsk-real-key');
    const body = JSON.parse(init.body);
    expect(body.temperature).toBe(0);
    expect(body.messages).toHaveLength(2);
  });

  it('returns the trimmed summary, model, and a generatedAt timestamp on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '  Summary text.  ' } }] }),
    });

    const result = await provider.generateInsight(makeRequest());

    expect(result.summary).toBe('Summary text.');
    expect(result.model).toBe('openai/gpt-oss-120b');
    expect(() => new Date(result.generatedAt).toISOString()).not.toThrow();
  });

  it('parses real token usage from the API response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Summary.' } }],
        usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
      }),
    });

    const result = await provider.generateInsight(makeRequest());

    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 40, totalTokens: 160 });
  });

  it('degrades to zeroed usage rather than throwing when the response omits it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Summary.' } }] }),
    });

    const result = await provider.generateInsight(makeRequest());

    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('throws with the HTTP status and body when Groq returns a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });

    await expect(provider.generateInsight(makeRequest())).rejects.toThrow(/HTTP 429/);
  });

  it('throws when the response has no summary content', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) });

    await expect(provider.generateInsight(makeRequest())).rejects.toThrow(/did not include a summary/);
  });

  it('wraps a network-level failure rather than letting it escape as a raw fetch error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(provider.generateInsight(makeRequest())).rejects.toThrow(/Could not reach Groq/);
  });
});
