import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWrapperCopy } from '../emails/utils/generate-copy.js';
import type { ProcessedArticle } from '../scripts/types.js';

const ARTICLE: ProcessedArticle = {
  id: 'article-1',
  sourceId: 'source',
  sourceName: 'Source',
  originalTitle: 'Story title',
  url: 'https://example.com/story',
  summary: 'Short summary about a useful local project.',
  positivity: 82,
  impact: 74,
  category: 'wins',
  publishedAt: '2026-06-27T10:00:00.000Z',
  processedAt: '2026-06-27T11:00:00.000Z',
};

test('generateWrapperCopy retries a transient Gemini 503 before succeeding', async () => {
  const originalApiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  let attempts = 0;

  try {
    const copy = await generateWrapperCopy([ARTICLE], '2026-W26', {
      generateContent: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error(
            '[GoogleGenerativeAI Error]: [503 Service Unavailable] high demand'
          );
        }

        return {
          response: {
            text: () =>
              JSON.stringify({
                greeting: 'Buna dimineata!',
                intro: 'Avem cateva vesti bune de urmarit azi.',
                signOff: 'Pe curand.',
                shortSummary: 'Proiecte locale si idei utile.',
              }),
          },
        };
      },
      retryOptions: {
        initialDelayMs: 1,
        maxDelayMs: 1,
        maxAttempts: 2,
        random: () => 0.5,
        sleep: async () => {},
      },
    });

    assert.equal(attempts, 2);
    assert.equal(copy.greeting, 'Buna dimineata!');
    assert.equal(copy.shortSummary, 'Proiecte locale si idei utile.');
  } finally {
    if (originalApiKey) {
      process.env.GEMINI_API_KEY = originalApiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  }
});
