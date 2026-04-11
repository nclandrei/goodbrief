import test from 'node:test';
import assert from 'node:assert/strict';
import { FallbackLlmProvider } from '../scripts/lib/llm/fallback-provider.js';
import {
  LlmProviderError,
  LlmQuotaError,
} from '../scripts/lib/llm/provider.js';
import type { LlmProvider } from '../scripts/lib/llm/provider.js';
import type { RawArticle } from '../scripts/types.js';

const RAW: RawArticle = {
  id: 'raw-1',
  sourceId: 'src',
  sourceName: 'Src',
  title: 'T',
  url: 'https://example.com',
  summary: 'S',
  publishedAt: '2026-04-10T00:00:00Z',
  fetchedAt: '2026-04-10T00:00:00Z',
};

function stubProvider(
  name: 'gemini' | 'claude-cli',
  overrides: Partial<LlmProvider> = {}
): LlmProvider {
  return {
    name,
    scoreArticles: async () => {
      throw new Error(`${name} stub scoreArticles not mocked`);
    },
    semanticDedup: async () => ({ groups: [] }),
    classifyCounterSignal: async () => ({
      verdict: 'none',
      reason: '',
      relatedArticleIds: [],
    }),
    generateWrapperCopy: async () => ({
      greeting: '',
      intro: '',
      signOff: '',
      shortSummary: '',
    }),
    refineDraft: async () => ({
      selectedIds: [],
      intro: '',
      shortSummary: '',
      reasoning: '',
    }),
    ...overrides,
  };
}

test('Fallback: uses primary when it succeeds; fallback is never called', async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary = stubProvider('gemini', {
    scoreArticles: async () => {
      primaryCalls++;
      return [];
    },
  });
  const fallback = stubProvider('claude-cli', {
    scoreArticles: async () => {
      fallbackCalls++;
      return [];
    },
  });

  const wrapped = new FallbackLlmProvider(primary, fallback);
  await wrapped.scoreArticles([RAW], { includeReasoning: false });

  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 0);
});

test('Fallback: switches to fallback on LlmQuotaError', async () => {
  let fallbackCalls = 0;
  const primary = stubProvider('gemini', {
    scoreArticles: async () => {
      throw new LlmQuotaError('gemini', 'quota exceeded');
    },
  });
  const fallback = stubProvider('claude-cli', {
    scoreArticles: async () => {
      fallbackCalls++;
      return [
        {
          id: 'raw-1',
          summary: 's',
          positivity: 80,
          impact: 70,
          romaniaRelevant: true,
          category: 'wins',
        },
      ];
    },
  });

  const wrapped = new FallbackLlmProvider(primary, fallback);
  const scores = await wrapped.scoreArticles([RAW], { includeReasoning: false });

  assert.equal(fallbackCalls, 1);
  assert.equal(scores.length, 1);
});

test('Fallback: does NOT catch non-quota LlmProviderError by default', async () => {
  const primary = stubProvider('gemini', {
    scoreArticles: async () => {
      throw new LlmProviderError('gemini', 'invalid request');
    },
  });
  const fallback = stubProvider('claude-cli', {
    scoreArticles: async () => {
      throw new Error('should not be called');
    },
  });

  const wrapped = new FallbackLlmProvider(primary, fallback);
  await assert.rejects(
    () => wrapped.scoreArticles([RAW], { includeReasoning: false }),
    /invalid request/
  );
});

test('Fallback: if both fail with quota, rethrows the fallback error', async () => {
  const primary = stubProvider('gemini', {
    scoreArticles: async () => {
      throw new LlmQuotaError('gemini', 'gemini quota');
    },
  });
  const fallback = stubProvider('claude-cli', {
    scoreArticles: async () => {
      throw new LlmQuotaError('claude-cli', 'claude quota');
    },
  });

  const wrapped = new FallbackLlmProvider(primary, fallback);
  await assert.rejects(
    () => wrapped.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) =>
      err instanceof LlmQuotaError && /claude quota/.test((err as Error).message)
  );
});

test('Fallback: name reflects primary for logging', () => {
  const primary = stubProvider('gemini');
  const fallback = stubProvider('claude-cli');
  const wrapped = new FallbackLlmProvider(primary, fallback);
  assert.equal(wrapped.name, 'gemini');
});
