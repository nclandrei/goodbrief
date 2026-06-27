import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runDraftFreshnessValidation } from '../scripts/lib/draft-freshness-runner.js';
import type { LlmProvider } from '../scripts/lib/llm/provider.js';
import type { NewsletterDraft, ProcessedArticle, WrapperCopy } from '../scripts/types.js';

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

function makeArticle(index: number): ProcessedArticle {
  return {
    id: `article-${index}`,
    sourceId: 'source',
    sourceName: 'Source',
    originalTitle: `Fresh story ${index}`,
    url: `https://example.com/fresh-${index}`,
    summary: `Fresh story summary ${index}.`,
    positivity: 80,
    impact: 70,
    category: 'wins',
    publishedAt: '2026-06-26T10:00:00.000Z',
    processedAt: '2026-06-27T10:00:00.000Z',
  };
}

function makeProvider(copy: WrapperCopy, calls: string[]): LlmProvider {
  return {
    name: 'gemini',
    scoreArticles: async () => [],
    semanticDedup: async () => ({ groups: [] }),
    classifyCounterSignal: async () => ({
      verdict: 'none',
      reason: '',
      relatedArticleIds: [],
    }),
    generateWrapperCopy: async (weekId) => {
      calls.push(weekId);
      return copy;
    },
    refineDraft: async () => ({
      selectedIds: [],
      intro: '',
      shortSummary: '',
      reasoning: '',
    }),
  };
}

test('runDraftFreshnessValidation can regenerate wrapper copy through the configured LLM provider', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-freshness-'));
  const weekId = '2026-W26';
  const draft: NewsletterDraft = {
    weekId,
    generatedAt: '2026-06-27T10:00:00.000Z',
    selected: Array.from({ length: 10 }, (_, index) => makeArticle(index)),
    reserves: [],
    discarded: 0,
    totalProcessed: 10,
  };
  const providerCalls: string[] = [];
  const wrapperCopy: WrapperCopy = {
    greeting: 'Buna dimineata!',
    intro: 'Intro generat prin provider.',
    signOff: 'Pe curand.',
    shortSummary: 'Rezumat prin provider.',
  };

  writeJson(join(rootDir, 'data', 'drafts', `${weekId}.json`), draft);

  await runDraftFreshnessValidation({
    rootDir,
    args: ['--week', weekId],
    llm: makeProvider(wrapperCopy, providerCalls),
    now: new Date('2026-06-27T12:00:00.000Z'),
    reviewArchive: async (items) =>
      items.map((item) => ({
        articleId: item.article.id,
        verdict: 'fresh',
        notes: 'Fresh story.',
      })),
  });

  const written = JSON.parse(
    readFileSync(join(rootDir, 'data', 'drafts', `${weekId}.json`), 'utf-8')
  ) as NewsletterDraft;

  assert.deepEqual(providerCalls, [weekId]);
  assert.deepEqual(written.wrapperCopy, wrapperCopy);
  assert.equal(written.validation?.status, 'passed');
});
