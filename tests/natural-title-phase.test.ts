import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNaturalTitlesPhase } from '../scripts/lib/draft-pipeline.js';
import { writePipelineArtifact } from '../scripts/lib/pipeline-artifacts.js';
import type { LlmProvider } from '../scripts/lib/llm/provider.js';
import type { ProcessedArticle, ShortlistPipelineData } from '../scripts/types.js';

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

test('natural-title phase uses its deterministic mock before any configured provider', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-title-phase-mock-'));
  const mockPath = join(rootDir, 'natural-titles.json');
  const previousMockPath = process.env.GOODBRIEF_NATURAL_TITLES_MOCK_FILE;
  let providerCalled = false;

  writePipelineArtifact<ShortlistPipelineData, 'select'>(rootDir, {
    weekId: '2026-W32',
    phase: 'select',
    generatedAt: '2026-08-08T12:00:00.000Z',
    inputFile: '04-counter-signals.json',
    data: {
      selected: [ARTICLE],
      reserves: [],
      totalProcessed: 1,
      discarded: 0,
      validation: {
        generatedAt: '2026-08-08T12:00:00.000Z',
        candidateCount: 1,
        flagged: [],
      },
    },
  });
  writeFileSync(
    mockPath,
    JSON.stringify({
      titles: [
        {
          id: ARTICLE.id,
          title: 'La Iași, o familie păstrează rețetele casei',
        },
      ],
    }),
    'utf-8'
  );
  process.env.GOODBRIEF_NATURAL_TITLES_MOCK_FILE = mockPath;

  const provider = {
    name: 'openrouter',
    async generateNaturalTitles() {
      providerCalled = true;
      throw new Error('The provider must not run when a phase mock exists');
    },
  } as LlmProvider;

  try {
    await runNaturalTitlesPhase(rootDir, '2026-W32', provider);
    assert.equal(providerCalled, false);
  } finally {
    if (previousMockPath === undefined) {
      delete process.env.GOODBRIEF_NATURAL_TITLES_MOCK_FILE;
    } else {
      process.env.GOODBRIEF_NATURAL_TITLES_MOCK_FILE = previousMockPath;
    }
  }
});
