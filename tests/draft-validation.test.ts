import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDraftFreshness,
  type ArchiveReviewDecision,
  type ArchiveReviewInputItem,
} from '../scripts/lib/draft-validation.js';
import type { NewsletterDraft, ProcessedArticle, WrapperCopy } from '../scripts/types.js';
import type { HistoricalArticle } from '../scripts/lib/story-history.js';

function makeWrapperCopy(): WrapperCopy {
  return {
    greeting: 'Salut!',
    intro: 'Intro de test.',
    signOff: 'Pe curând',
    shortSummary: 'Rezumat de test.',
  };
}

function makeArticle(index: number, overrides: Partial<ProcessedArticle> = {}): ProcessedArticle {
  return {
    id: `article-${index}`,
    sourceId: 'source',
    sourceName: 'Source',
    originalTitle: `Story ${index}`,
    url: `https://example.com/story-${index}`,
    summary: `Summary for story ${index}.`,
    positivity: 80,
    impact: 70,
    category: 'wins',
    publishedAt: '2026-03-05T10:00:00.000Z',
    processedAt: '2026-03-07T10:00:00.000Z',
    ...overrides,
  };
}

function makeDraft(selected: ProcessedArticle[], reserves: ProcessedArticle[] = []): NewsletterDraft {
  return {
    weekId: '2026-W10',
    generatedAt: '2026-03-07T10:00:00.000Z',
    selected,
    reserves,
    discarded: 0,
    totalProcessed: selected.length + reserves.length,
    wrapperCopy: makeWrapperCopy(),
  };
}

function makeHistory(overrides: Partial<HistoricalArticle> = {}): HistoricalArticle {
  return {
    title: 'Historical story',
    summary: 'Historical summary.',
    url: 'https://archive.example.com/story',
    source: 'issue',
    origin: '2026-03-02-issue.md',
    ...overrides,
  };
}

function buildFreshReview(items: ArchiveReviewInputItem[]): ArchiveReviewDecision[] {
  return items.map((item) => ({
    articleId: item.article.id,
    verdict: 'fresh',
    notes: 'Fresh story.',
  }));
}

test('blocks exact canonical URL repeats deterministically', async () => {
  const selected = Array.from({ length: 10 }, (_, index) =>
    makeArticle(index, index === 0 ? { url: 'https://archive.example.com/story?utm_source=test' } : {})
  );
  const reserves = [makeArticle(10)];
  const reviewedIds: string[] = [];

  const result = await validateDraftFreshness({
    draft: makeDraft(selected, reserves),
    historicalArticles: [makeHistory()],
    recentDraftCount: 0,
    publishedHistoryCount: 1,
    now: new Date('2026-03-08T10:00:00.000Z'),
    reviewArchive: async (items) => {
      reviewedIds.push(...items.map((item) => item.article.id));
      return buildFreshReview(items);
    },
    generateWrapperCopy: async () => makeWrapperCopy(),
  });

  assert.equal(result.draft.validation?.blockedArticles?.[0]?.reason, 'url-match');
  assert.equal(reviewedIds.includes('article-0'), false);
  assert.equal(result.draft.validation?.status, 'passed');
});

test('blocks high-confidence title and summary rewrites deterministically', async () => {
  const selected = [
    makeArticle(0, {
      originalTitle: 'Bistrița face mai ușor accesul la servicii pentru copiii cu autism',
      summary:
        'Peste 35 de instituții din Bistrița și-au adaptat serviciile și semnalizarea pentru persoanele cu autism.',
    }),
    ...Array.from({ length: 9 }, (_, index) => makeArticle(index + 1)),
  ];
  const reserves = [makeArticle(10)];
  const reviewedIds: string[] = [];

  const result = await validateDraftFreshness({
    draft: makeDraft(selected, reserves),
    historicalArticles: [
      makeHistory({
        title: 'Bistrița face mai ușor accesul la servicii pentru persoanele cu autism',
        summary:
          'La Bistrița, peste 35 de instituții și companii și-au adaptat serviciile pentru persoane cu autism.',
      }),
    ],
    recentDraftCount: 0,
    publishedHistoryCount: 1,
    now: new Date('2026-03-08T10:00:00.000Z'),
    reviewArchive: async (items) => {
      reviewedIds.push(...items.map((item) => item.article.id));
      return buildFreshReview(items);
    },
    generateWrapperCopy: async () => makeWrapperCopy(),
  });

  assert.equal(result.draft.validation?.blockedArticles?.[0]?.reason, 'story-similarity');
  assert.equal(reviewedIds.includes('article-0'), false);
});

test('blocks valid stories older than the freshness window', async () => {
  const selected = [
    makeArticle(0, { publishedAt: '2026-02-10T10:00:00.000Z' }),
    ...Array.from({ length: 9 }, (_, index) => makeArticle(index + 1)),
  ];
  const reserves = [makeArticle(10)];

  const result = await validateDraftFreshness({
    draft: makeDraft(selected, reserves),
    historicalArticles: [],
    recentDraftCount: 0,
    publishedHistoryCount: 0,
    now: new Date('2026-03-08T10:00:00.000Z'),
    reviewArchive: async (items) => buildFreshReview(items),
    generateWrapperCopy: async () => makeWrapperCopy(),
  });

  assert.equal(result.draft.validation?.blockedArticles?.[0]?.reason, 'stale-published-at');
});

test('routes invalid publishedAt values to agent review instead of hard-failing them', async () => {
  const selected = [
    makeArticle(0, { publishedAt: 'not-a-date' }),
    ...Array.from({ length: 9 }, (_, index) => makeArticle(index + 1)),
  ];
  const seenRequiresDateReview: boolean[] = [];

  const result = await validateDraftFreshness({
    draft: makeDraft(selected, [makeArticle(10)]),
    historicalArticles: [],
    recentDraftCount: 0,
    publishedHistoryCount: 0,
    now: new Date('2026-03-08T10:00:00.000Z'),
    reviewArchive: async (items) => {
      seenRequiresDateReview.push(
        items.find((item) => item.article.id === 'article-0')?.requiresDateReview ?? false
      );
      return buildFreshReview(items);
    },
    generateWrapperCopy: async () => makeWrapperCopy(),
  });

  assert.equal(
    result.draft.validation?.blockedArticles?.some((blocked) => blocked.articleId === 'article-0') ?? false,
    false
  );
  assert.deepEqual(seenRequiresDateReview, [true]);
});

test('keeps genuine follow-up stories when the agent marks them as follow_up', async () => {
  const selected = Array.from({ length: 10 }, (_, index) =>
    makeArticle(index, index === 0 ? { originalTitle: 'Etapa nouă pentru centrul public de competențe verzi' } : {})
  );

  const result = await validateDraftFreshness({
    draft: makeDraft(selected, [makeArticle(10)]),
    historicalArticles: [
      makeHistory({
        title: 'România deschide primul centru public pentru competențe verzi',
        summary: 'Proiectul deschide cursuri gratuite în mai multe județe.',
      }),
    ],
    recentDraftCount: 0,
    publishedHistoryCount: 1,
    now: new Date('2026-03-08T10:00:00.000Z'),
    reviewArchive: async (items) =>
      items.map((item) => ({
        articleId: item.article.id,
        verdict: item.article.id === 'article-0' ? 'follow_up' : 'fresh',
        notes: item.article.id === 'article-0' ? 'Materially new development.' : 'Fresh story.',
        matchedOrigin: item.article.id === 'article-0' ? '2026-03-02-issue.md' : undefined,
        matchedTitle:
          item.article.id === 'article-0'
            ? 'România deschide primul centru public pentru competențe verzi'
            : undefined,
      })),
    generateWrapperCopy: async () => makeWrapperCopy(),
  });

  assert.equal(result.draft.validation?.status, 'passed');
  assert.equal(
    result.draft.validation?.agentReviewed?.find((reviewed) => reviewed.articleId === 'article-0')
      ?.verdict,
    'follow_up'
  );
});

test('auto-replaces blocked selected stories with the first approved reserve', async () => {
  const selected = Array.from({ length: 10 }, (_, index) => makeArticle(index));
  const reserves = [makeArticle(10), makeArticle(11)];

  const result = await validateDraftFreshness({
    draft: makeDraft(selected, reserves),
    historicalArticles: [],
    recentDraftCount: 0,
    publishedHistoryCount: 0,
    now: new Date('2026-03-08T10:00:00.000Z'),
    reviewArchive: async (items) =>
      items.map((item) => ({
        articleId: item.article.id,
        verdict: item.article.id === 'article-0' ? 'duplicate' : 'fresh',
        notes: item.article.id === 'article-0' ? 'Duplicate story.' : 'Fresh story.',
      })),
    generateWrapperCopy: async () => ({
      ...makeWrapperCopy(),
      intro: 'Wrapper regen after replacement.',
    }),
  });

  assert.equal(result.draft.validation?.status, 'passed');
  assert.equal(result.draft.selected.some((article) => article.id === 'article-10'), true);
  assert.deepEqual(result.draft.validation?.replacements, [
    {
      removedArticleId: 'article-0',
      replacementArticleId: 'article-10',
    },
  ]);
  assert.equal(result.draft.wrapperCopy?.intro, 'Wrapper regen after replacement.');
});

test('fails cleanly when fewer than 10 approved stories remain', async () => {
  const selected = Array.from({ length: 10 }, (_, index) => makeArticle(index));

  const result = await validateDraftFreshness({
    draft: makeDraft(selected),
    historicalArticles: [],
    recentDraftCount: 0,
    publishedHistoryCount: 0,
    now: new Date('2026-03-08T10:00:00.000Z'),
    reviewArchive: async (items) =>
      items.map((item) => ({
        articleId: item.article.id,
        verdict: item.article.id === 'article-0' ? 'duplicate' : 'fresh',
        notes: item.article.id === 'article-0' ? 'Duplicate story.' : 'Fresh story.',
      })),
    generateWrapperCopy: async () => makeWrapperCopy(),
  });

  assert.equal(result.draft.validation?.status, 'failed');
  assert.equal(result.draft.selected.length, 9);
  assert.equal(
    result.draft.validation?.blockedArticles?.some((blocked) => blocked.articleId === 'article-0') ?? false,
    true
  );
});
