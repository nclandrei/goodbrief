import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSources, selectNewArticles, type FetchFeedResult } from '../scripts/lib/news-ingest.js';
import type { WeeklyBuffer } from '../scripts/types.js';
import { WORKSPACE_ROOT } from './helpers.js';

function makeBuffer(weekId: string, urls: string[]): WeeklyBuffer {
  return {
    weekId,
    articles: urls.map((url, index) => ({
      id: `${weekId}-${index}`,
      sourceId: 'fixture',
      sourceName: 'Fixture',
      title: `Story ${index}`,
      url,
      summary: 'Summary',
      publishedAt: '2026-03-08T10:00:00.000Z',
      fetchedAt: '2026-03-09T10:00:00.000Z',
    })),
    lastUpdated: '2026-03-09T10:00:00.000Z',
  };
}

function makeFetchResult(articles: FetchFeedResult['articles']): FetchFeedResult {
  return {
    source: {
      id: 'fixture-source',
      name: 'Fixture Source',
      url: 'https://example.ro/feed',
    },
    articles,
    parsedItemCount: articles.length,
    usableItemCount: articles.length,
  };
}

test('selectNewArticles drops stale articles and keeps unknown-date articles', () => {
  const result = selectNewArticles({
    fetchResults: [
      makeFetchResult([
        {
          id: 'stale',
          sourceId: 'fixture-source',
          sourceName: 'Fixture Source',
          title: 'Stale story',
          url: 'https://example.ro/stale',
          summary: 'Old story',
          publishedAt: '2026-02-01T10:00:00.000Z',
          fetchedAt: '2026-03-15T10:00:00.000Z',
        },
        {
          id: 'unknown',
          sourceId: 'fixture-source',
          sourceName: 'Fixture Source',
          title: 'Unknown date story',
          url: 'https://example.ro/unknown',
          summary: 'Unknown date',
          publishedAt: 'not-a-date',
          fetchedAt: '2026-03-15T10:00:00.000Z',
        },
        {
          id: 'fresh',
          sourceId: 'fixture-source',
          sourceName: 'Fixture Source',
          title: 'Fresh story',
          url: 'https://example.ro/fresh',
          summary: 'Fresh story',
          publishedAt: '2026-03-14T10:00:00.000Z',
          fetchedAt: '2026-03-15T10:00:00.000Z',
        },
      ]),
    ],
    currentBuffer: makeBuffer('2026-W11', []),
    previousBuffer: makeBuffer('2026-W10', []),
    now: new Date('2026-03-15T10:00:00.000Z'),
  });

  assert.deepEqual(
    result.newArticles.map((article) => article.id),
    ['unknown', 'fresh']
  );
  assert.deepEqual(result.sourceStats, [
    {
      sourceId: 'fixture-source',
      sourceName: 'Fixture Source',
      fetched: 3,
      kept: 2,
      droppedStale: 1,
      droppedDuplicateCurrentWeek: 0,
      droppedDuplicatePreviousWeek: 0,
      unknownAge: 1,
    },
  ]);
});

test('selectNewArticles drops duplicates against current and previous week URL indexes', () => {
  const result = selectNewArticles({
    fetchResults: [
      makeFetchResult([
        {
          id: 'dup-current',
          sourceId: 'fixture-source',
          sourceName: 'Fixture Source',
          title: 'Current duplicate',
          url: 'https://example.ro/story',
          summary: 'Duplicate current week',
          publishedAt: '2026-03-09T10:00:00.000Z',
          fetchedAt: '2026-03-10T10:00:00.000Z',
        },
        {
          id: 'dup-previous',
          sourceId: 'fixture-source',
          sourceName: 'Fixture Source',
          title: 'Previous duplicate',
          url: 'https://www.example.ro/stire/?utm_campaign=test',
          summary: 'Duplicate previous week',
          publishedAt: '2026-03-09T10:00:00.000Z',
          fetchedAt: '2026-03-10T10:00:00.000Z',
        },
        {
          id: 'keep-me',
          sourceId: 'fixture-source',
          sourceName: 'Fixture Source',
          title: 'Keep me',
          url: 'https://example.ro/new-story',
          summary: 'New story',
          publishedAt: '2026-03-09T10:00:00.000Z',
          fetchedAt: '2026-03-10T10:00:00.000Z',
        },
      ]),
    ],
    currentBuffer: makeBuffer('2026-W11', ['https://example.ro/story?utm_source=rss']),
    previousBuffer: makeBuffer('2026-W10', ['https://example.ro/stire']),
    now: new Date('2026-03-10T10:00:00.000Z'),
  });

  assert.deepEqual(
    result.newArticles.map((article) => article.id),
    ['keep-me']
  );
  assert.deepEqual(result.sourceStats, [
    {
      sourceId: 'fixture-source',
      sourceName: 'Fixture Source',
      fetched: 3,
      kept: 1,
      droppedStale: 0,
      droppedDuplicateCurrentWeek: 1,
      droppedDuplicatePreviousWeek: 1,
      unknownAge: 0,
    },
  ]);
});

test('loadSources reflects the refreshed source roster', () => {
  const sources = loadSources(WORKSPACE_ROOT);
  const ids = sources.map((source) => source.id).sort();

  assert.deepEqual(ids, [
    'agerpres',
    'biziday',
    'economedia',
    'edupedu',
    'mediafax',
    'startup-ro',
    'startupcafe',
    'stirileprotv',
  ]);
});
