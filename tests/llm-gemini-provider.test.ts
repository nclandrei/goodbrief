import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GeminiProvider } from '../scripts/lib/llm/gemini-provider.js';
import type { ProcessedArticle } from '../scripts/types.js';

const ARTICLE: ProcessedArticle = {
  id: 'article-1',
  sourceId: 'source',
  sourceName: 'Source',
  originalTitle: 'Business CheckIn. Titlu de presă',
  url: 'https://example.com/article-1',
  summary: 'O familie transformă rețetele casei într-o mică afacere.',
  positivity: 80,
  impact: 70,
  category: 'local-heroes',
  publishedAt: '2026-08-08T10:00:00.000Z',
  processedAt: '2026-08-08T12:00:00.000Z',
};

test('generateNaturalTitles reads and validates the deterministic Gemini mock', async () => {
  const originalMockPath = process.env.GOODBRIEF_NATURAL_TITLES_MOCK_FILE;
  const tempDir = mkdtempSync(join(tmpdir(), 'goodbrief-natural-titles-'));
  const mockPath = join(tempDir, 'titles.json');
  writeFileSync(
    mockPath,
    JSON.stringify({
      titles: [
        {
          id: 'article-1',
          title: '  La Iași, o familie păstrează rețetele casei  ',
        },
      ],
    }),
    'utf-8'
  );
  process.env.GOODBRIEF_NATURAL_TITLES_MOCK_FILE = mockPath;

  try {
    const provider = new GeminiProvider('test-key');
    const titles = await provider.generateNaturalTitles('2026-W32', [ARTICLE]);

    assert.deepEqual(titles, [
      {
        id: 'article-1',
        title: 'La Iași, o familie păstrează rețetele casei',
      },
    ]);
  } finally {
    if (originalMockPath === undefined) {
      delete process.env.GOODBRIEF_NATURAL_TITLES_MOCK_FILE;
    } else {
      process.env.GOODBRIEF_NATURAL_TITLES_MOCK_FILE = originalMockPath;
    }
  }
});
