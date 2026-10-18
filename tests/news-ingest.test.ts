import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSources, selectNewArticles, type FetchFeedResult } from '../scripts/lib/news-ingest.js';
import { deduplicateArticles, findCrossWeekDuplicate } from '../scripts/lib/deduplication.js';
import type { WeeklyBuffer } from '../scripts/types.js';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';

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
    'dw-romania',
    'economedia',
    'edupedu',
    'europa-libera',
    'mediafax',
    'republica',
    'startup-ro',
    'startupcafe',
    'stirileprotv',
  ]);
});

test('deterministic cross-week filtering still catches previously covered canonical URLs', () => {
  const duplicate = findCrossWeekDuplicate(
    { id: 'new-id', title: 'Un titlu rescris', url: 'https://www.example.ro/stire/?utm_source=rss' },
    [{ id: 'old-id', title: 'Titlul din arhivă', url: 'https://example.ro/stire' }]
  );
  assert.equal(duplicate?.reason, 'url-match');
  assert.equal(duplicate?.previousTitle, 'Titlul din arhivă');
});

test('deterministic RSS title deduplication preserves representative and cluster metadata', () => {
  const first = makeBuffer('2026-W11', ['https://example.ro/story']).articles[0];
  const second = { ...first, id: 'other-source', url: 'https://other.ro/story', summary: 'A longer useful RSS summary.' };
  const result = deduplicateArticles([first, second]);

  assert.equal(result.inputCount, 2);
  assert.equal(result.outputCount, 1);
  assert.deepEqual(result.outputArticles, [second]);
  assert.deepEqual(result.clusters, [{ kept: second.id, merged: [first.id], similarity: 1 }]);
});

test('ingest verification runs HTTP RSS, persistence and dedup without creating drafts or model artifacts', async (t) => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-ingest-verification-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const server = createServer((request, response) => {
    const sourceId = request.url?.slice(1) || 'fixture';
    response.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    response.end(`<rss version="2.0"><channel><title>${sourceId}</title>
      <link>https://example.ro</link><description>Flux de test</description>
      ${Array.from({ length: 4 }, (_, index) => `<item>
        <title>Știrea ${index} de la ${sourceId}</title>
        <link>https://example.ro/${sourceId}/story-${index}</link>
        <description>Un rezultat concret în comunitate.</description>
        <pubDate>Sat, 17 Oct 2026 10:00:00 GMT</pubDate>
      </item>`).join('')}</channel></rss>`);
  });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const sources = loadSources(WORKSPACE_ROOT).map((source) => ({
    ...source,
    url: `http://127.0.0.1:${address.port}/${source.id}`,
  }));
  mkdirSync(join(rootDir, 'data'));
  writeFileSync(join(rootDir, 'data', 'sources.json'), JSON.stringify(sources));

  const { stdout } = await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'verify-ingest-e2e.ts'),
    [],
    { GOODBRIEF_ROOT_DIR: rootDir, GOODBRIEF_INGEST_NOW: '2026-10-18T10:00:00.000Z', RESEND_API_KEY: '', TEST_EMAIL: '' }
  );

  assert.match(stdout, /Feed health: 11\/11 configured sources usable/);
  assert.match(stdout, /Persisted RSS articles: 33; new: 22/);
  assert.match(stdout, /Duplicate drops: previous_week=11, current_week=11/);
  assert.match(stdout, /no assessment, draft, approval, proof or email was created/);
  assert.deepEqual(readdirSync(join(rootDir, 'data')), ['sources.json']);
});
