import test from 'node:test';
import assert from 'node:assert/strict';
import { FallbackLlmProvider } from '../scripts/lib/llm/fallback-provider.js';
import {
  NaturalTitlesPartialError,
  normalizeNaturalTitlesResponse,
} from '../scripts/lib/llm/natural-title-prompt.js';
import {
  LlmOutputError,
  LlmProviderError,
  LlmQuotaError,
} from '../scripts/lib/llm/provider.js';
import type { LlmProvider } from '../scripts/lib/llm/provider.js';
import type { ProcessedArticle, RawArticle } from '../scripts/types.js';

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

const PROCESSED: ProcessedArticle = {
  id: 'article-1',
  sourceId: 'src',
  sourceName: 'Src',
  originalTitle: 'Titlu sursă',
  url: 'https://example.com/article-1',
  summary: 'Rezumat',
  positivity: 80,
  impact: 70,
  category: 'wins',
  publishedAt: '2026-04-10T00:00:00Z',
  processedAt: '2026-04-10T01:00:00Z',
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
    generateNaturalTitles: async () => [],
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

test('Fallback: switches title generation to the fallback provider on quota', async () => {
  let fallbackCalls = 0;
  const primary = stubProvider('gemini', {
    generateNaturalTitles: async () => {
      throw new LlmQuotaError('gemini', 'quota exceeded');
    },
  });
  const fallback = stubProvider('claude-cli', {
    generateNaturalTitles: async () => {
      fallbackCalls++;
      return [{ id: 'article-1', title: 'Titlul firesc' }];
    },
  });

  const wrapped = new FallbackLlmProvider(primary, fallback);
  const titles = await wrapped.generateNaturalTitles('2026-W15', [PROCESSED]);

  assert.equal(fallbackCalls, 1);
  assert.deepEqual(titles, [{ id: 'article-1', title: 'Titlul firesc' }]);
});

test('Fallback: switches title generation when the primary returns invalid model output', async () => {
  let fallbackCalls = 0;
  const primary = stubProvider('gemini', {
    generateNaturalTitles: async () => {
      throw new LlmOutputError(
        'gemini',
        'generateNaturalTitles: headline quality rule failed'
      );
    },
  });
  const fallback = stubProvider('claude-cli', {
    generateNaturalTitles: async () => {
      fallbackCalls++;
      return [{ id: 'article-1', title: 'Titlul firesc' }];
    },
  });

  const wrapped = new FallbackLlmProvider(primary, fallback);
  const titles = await wrapped.generateNaturalTitles('2026-W34', [PROCESSED]);

  assert.equal(fallbackCalls, 1);
  assert.deepEqual(titles, [{ id: 'article-1', title: 'Titlul firesc' }]);
});

test('Fallback: sends only one genuinely unresolved title out of a 40-title batch', async () => {
  const articles = Array.from({ length: 40 }, (_, index): ProcessedArticle => ({
    ...PROCESSED,
    id: `article-${index + 1}`,
    originalTitle:
      index === 39
        ? 'FOTO: Un rezultat spectaculos!'
        : `Titlu sursă sigur pentru articolul ${index + 1}`,
  }));
  let fallbackArticleIds: string[] = [];

  const primary = stubProvider('gemini', {
    generateNaturalTitles: async (_weekId, requestedArticles) =>
      normalizeNaturalTitlesResponse('gemini', requestedArticles, {
        titles: requestedArticles.map((article, index) => ({
          id: article.id,
          title:
            index === 39
              ? 'x'.repeat(111)
              : `Titlu generat valid pentru articolul ${index + 1}`,
        })),
      }),
  });
  const fallback = stubProvider('claude-cli', {
    generateNaturalTitles: async (_weekId, requestedArticles) => {
      fallbackArticleIds = requestedArticles.map((article) => article.id);
      return [
        {
          id: requestedArticles[0].id,
          title: 'Titlu reparat pentru ultimul articol',
        },
      ];
    },
  });

  const wrapped = new FallbackLlmProvider(primary, fallback);
  const titles = await wrapped.generateNaturalTitles('2026-W35', articles);

  assert.deepEqual(fallbackArticleIds, ['article-40']);
  assert.equal(titles.length, 40);
  assert.deepEqual(
    titles.map((title) => title.id),
    articles.map((article) => article.id)
  );
  assert.equal(titles[0].title, 'Titlu generat valid pentru articolul 1');
  assert.equal(titles[39].title, 'Titlu reparat pentru ultimul articol');
});

test('Fallback: unsafe source title remains unresolved after both providers fail validation', async () => {
  const article = {
    ...PROCESSED,
    originalTitle: 'FOTO: Un rezultat spectaculos!',
  };
  const invalidResponse = (provider: 'gemini' | 'claude-cli') =>
    normalizeNaturalTitlesResponse(provider, [article], {
      titles: [{ id: article.id, title: 'x'.repeat(111) }],
    });

  const wrapped = new FallbackLlmProvider(
    stubProvider('gemini', {
      generateNaturalTitles: async () => invalidResponse('gemini'),
    }),
    stubProvider('claude-cli', {
      generateNaturalTitles: async () => invalidResponse('claude-cli'),
    })
  );

  await assert.rejects(
    () => wrapped.generateNaturalTitles('2026-W35', [article]),
    (error: unknown) =>
      error instanceof NaturalTitlesPartialError &&
      error.unresolvedArticleIds.length === 1 &&
      error.unresolvedArticleIds[0] === article.id &&
      error.partialTitles.length === 0
  );
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

test('Fallback: switches to fallback on retryable transient LlmProviderError', async () => {
  let fallbackCalls = 0;
  const primary = stubProvider('gemini', {
    scoreArticles: async () => {
      throw new LlmProviderError('gemini', 'transient 503 exhausted', {
        retryable: true,
      });
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

  assert.equal(fallbackCalls, 1);
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

test('Fallback: if both providers return invalid output, rethrows the fallback error', async () => {
  const primary = stubProvider('gemini', {
    generateNaturalTitles: async () => {
      throw new LlmOutputError('gemini', 'primary invalid output');
    },
  });
  const fallback = stubProvider('claude-cli', {
    generateNaturalTitles: async () => {
      throw new LlmOutputError('claude-cli', 'fallback invalid output');
    },
  });

  const wrapped = new FallbackLlmProvider(primary, fallback);
  await assert.rejects(
    () => wrapped.generateNaturalTitles('2026-W34', [PROCESSED]),
    (error: unknown) =>
      error instanceof LlmOutputError && /fallback invalid output/.test(error.message)
  );
});

test('Fallback: name reflects primary for logging', () => {
  const primary = stubProvider('gemini');
  const fallback = stubProvider('claude-cli');
  const wrapped = new FallbackLlmProvider(primary, fallback);
  assert.equal(wrapped.name, 'gemini');
});
