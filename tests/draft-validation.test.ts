import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraftFreshness } from '../scripts/lib/draft-validation.js';
import { assertDraftReadyForProduction, assertDraftValidated } from '../scripts/lib/draft-delivery.js';
import type { HistoricalArticle } from '../scripts/lib/story-history.js';
import type { NewsletterDraft, ProcessedArticle } from '../scripts/types.js';

function makeArticle(index: number, overrides: Partial<ProcessedArticle> = {}): ProcessedArticle {
  return {
    id: `article-${index}`,
    sourceId: 'source',
    sourceName: 'Source',
    originalTitle: `Story ${index}`,
    title: `Titlu editorial ${index}`,
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
    wrapperCopy: {
      greeting: 'Salut!',
      intro: 'Introducerea revizuită de editor.',
      signOff: 'Pe curând',
      shortSummary: 'Rezumatul revizuit.',
    },
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

async function check(draft: NewsletterDraft, historicalArticles: HistoricalArticle[] = []) {
  const before = JSON.stringify(draft);
  const result = await validateDraftFreshness({
    draft,
    historicalArticles,
    recentDraftCount: historicalArticles.filter((article) => article.source === 'draft').length,
    publishedHistoryCount: historicalArticles.filter((article) => article.source === 'issue').length,
    now: new Date('2026-03-07T10:00:00.000Z'),
  });
  assert.equal(JSON.stringify(draft), before, 'Freshness checks must never mutate the edition');
  return result;
}

function selectedWithFirst(overrides: Partial<ProcessedArticle> = {}): ProcessedArticle[] {
  return Array.from({ length: 10 }, (_, index) => makeArticle(index, index === 0 ? overrides : {}));
}

test('reports exact canonical URL repeats without replacing reviewed stories', async () => {
  const draft = makeDraft(
    selectedWithFirst({ url: 'https://www.archive.example.com/story/?utm_source=test' }),
    [makeArticle(10)]
  );
  const result = await check(draft, [makeHistory()]);

  assert.equal(result.blockedArticles[0]?.reason, 'url-match');
  assert.equal(result.blockedArticles[0]?.matchedOrigin, '2026-03-02-issue.md');
  assert.equal(result.status, 'failed');
  assert.equal(result.selectedFreshCount, 9);
  assert.equal(result.reserveFreshCount, 1);
  assert.equal(draft.selected[0].id, 'article-0');
  assert.equal(draft.reserves[0].id, 'article-10');
});

test('retains hard editorial exclusions in the deterministic report', async () => {
  const result = await check(makeDraft(selectedWithFirst({
    originalTitle: 'Elevii din Cluj au obținut cele mai multe medii de 10 la Bacalaureat',
    summary: 'Rezultatele finale ale examenului au fost publicate.',
  })));

  assert.equal(result.blockedArticles[0]?.reason, 'editorial:routine-national-exam-result');
  assert.equal(result.status, 'failed');
});

test('reports repeated recent draft article IDs even if the headline and URL changed', async () => {
  const result = await check(makeDraft(selectedWithFirst()), [
    makeHistory({ source: 'draft', origin: '2026-W09.json', id: 'article-0' }),
  ]);
  assert.equal(result.blockedArticles[0]?.reason, 'recent-draft-id');
  assert.equal(result.recentDraftCount, 1);
});

test('compares normalized source headlines rather than reader-facing titles', async () => {
  const result = await check(makeDraft(selectedWithFirst({
    originalTitle: 'Bistrița adaugă servicii publice accesibile!',
    title: 'Un titlu editorial complet diferit',
  })), [makeHistory({ title: 'Bistrita adauga servicii publice accesibile' })]);

  assert.equal(result.blockedArticles[0]?.reason, 'title-match');
});

test('reports high-confidence title and summary rewrites deterministically', async () => {
  const result = await check(makeDraft(selectedWithFirst({
    originalTitle: 'Bistrița face mai ușor accesul la servicii pentru copiii cu autism',
    summary: 'Peste 35 de instituții din Bistrița și-au adaptat serviciile și semnalizarea pentru persoanele cu autism.',
  })), [makeHistory({
    title: 'Bistrița face mai ușor accesul la servicii pentru persoanele cu autism',
    summary: 'La Bistrița, peste 35 de instituții și companii și-au adaptat serviciile pentru persoane cu autism.',
  })]);

  assert.equal(result.blockedArticles[0]?.reason, 'story-similarity');
});

test('reports valid publication dates older than the freshness window', async () => {
  const result = await check(makeDraft(selectedWithFirst({ publishedAt: '2026-02-10T10:00:00.000Z' })));
  assert.equal(result.blockedArticles[0]?.reason, 'stale-published-at');
});

test('measures freshness from Monday delivery rather than Saturday validation', async () => {
  const result = await check(makeDraft(selectedWithFirst({ publishedAt: '2026-02-22T00:00:00.000Z' })));
  assert.equal(result.plannedReadDate, '2026-03-09');
  assert.equal(result.checkedAt, '2026-03-07T10:00:00.000Z');
  assert.equal(result.blockedArticles[0]?.reason, 'stale-published-at');
});

test('keeps publication dates exactly on the freshness boundary', async () => {
  const result = await check(makeDraft(selectedWithFirst({ publishedAt: '2026-02-23T00:00:00' })));
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.blockedArticles, []);
});

test('unknown publication dates require manual checking, not invented semantic approval', async () => {
  const draft = makeDraft(selectedWithFirst({ publishedAt: 'not-a-date' }));
  const result = await check(draft);
  assert.equal(result.blockedArticles[0]?.reason, 'unknown-published-at');
  assert.equal(result.status, 'failed');
  assert.equal(draft.validation, undefined);
  assert.equal(draft.deliveryLock, undefined);
});

test('passing deterministic freshness never implies source verification or production approval', async () => {
  const draft = makeDraft(selectedWithFirst());
  delete draft.wrapperCopy;
  const result = await check(draft);

  assert.equal(result.status, 'passed');
  assert.equal(draft.wrapperCopy, undefined, 'The check must not write newsletter copy');
  assert.equal(draft.validation, undefined, 'No agentReviewed, semantic status or approval source may be invented');
  assert.equal(draft.deliveryLock, undefined);
  assert.throws(() => assertDraftValidated(draft, 'preview'), /not validated/);
  assert.throws(() => assertDraftReadyForProduction(draft, 'send'), /not validated/);
});

test('preserves existing review evidence and approval locks byte for byte on failure too', async () => {
  const draft = makeDraft(selectedWithFirst({ publishedAt: 'not-a-date' }));
  draft.validation = {
    generatedAt: draft.generatedAt,
    candidateCount: 10,
    flagged: [],
    status: 'passed',
    approvalSource: 'editor-review',
    agentReviewed: [{ articleId: 'article-0', verdict: 'follow_up', notes: 'Existing editor review.' }],
  };
  draft.deliveryLock = { version: 1, approvedSha256: 'existing-lock', approvedAt: draft.generatedAt };

  assert.equal((await check(draft)).status, 'failed');
  assert.equal(draft.validation.agentReviewed?.[0].verdict, 'follow_up');
  assert.equal(draft.deliveryLock.approvedSha256, 'existing-lock');
});

test('reports blocked reserves without padding or rewriting a healthy shorter edition', async () => {
  const draft = makeDraft(
    Array.from({ length: 8 }, (_, index) => makeArticle(index)),
    [makeArticle(10, { publishedAt: 'not-a-date' })]
  );
  const result = await check(draft);
  assert.equal(result.status, 'passed');
  assert.equal(result.selectedFreshCount, 8);
  assert.equal(result.reserveFreshCount, 0);
  assert.equal(result.blockedArticles[0]?.articleId, 'article-10');
});

test('does not auto-promote reserves when fewer than seven selected stories remain', async () => {
  const result = await check(makeDraft(
    Array.from({ length: 6 }, (_, index) => makeArticle(index)),
    [makeArticle(10), makeArticle(11)]
  ));
  assert.equal(result.status, 'failed');
  assert.equal(result.selectedFreshCount, 6);
  assert.equal(result.reserveFreshCount, 2);
});

test('rejects unusable freshness windows rather than silently disabling the date check', async () => {
  for (const freshnessWindowDays of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(validateDraftFreshness({
      draft: makeDraft(selectedWithFirst()),
      historicalArticles: [],
      recentDraftCount: 0,
      publishedHistoryCount: 0,
      freshnessWindowDays,
    }), /positive number of days/);
  }
});
