#!/usr/bin/env npx tsx

import 'dotenv/config';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawArticle } from './types.js';
import { canonicalizeStoryUrl } from './lib/deduplication.js';
import { checkConfiguredFeedHealth } from './lib/feed-health.js';
import {
  getISOWeekId,
  getPreviousISOWeekId,
  ingestNews,
  loadWeeklyBuffer,
  resolveIngestNow,
  saveWeeklyBuffer,
  type FetchFeedResult,
} from './lib/news-ingest.js';
import { resolveProjectRoot } from './lib/project-root.js';

const ROOT_DIR = resolveProjectRoot(import.meta.url);
const EXPECTED_KEPT_SOURCE_IDS = [
  'dw-romania',
  'europa-libera',
  'republica',
  'economedia',
  'edupedu',
  'startup-ro',
  'startupcafe',
];

function pickSeedArticles(results: FetchFeedResult[], articleIndex: number): RawArticle[] {
  return results
    .filter((result) => !result.error)
    .map((result) => result.articles[articleIndex])
    .filter((article): article is RawArticle => article !== undefined);
}

async function main(): Promise<void> {
  const now = resolveIngestNow();
  const weekId = getISOWeekId(now);
  const previousWeekId = getPreviousISOWeekId(weekId);
  const healthResults = await checkConfiguredFeedHealth(ROOT_DIR, now);
  const unhealthy = healthResults.filter((result) => !result.ok);
  if (unhealthy.length > 0) {
    throw new Error(
      `Feed health failed: ${unhealthy
        .map((result) => `${result.source.name} (${result.error})`)
        .join(', ')}`
    );
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-ingest-e2e-'));
  try {
    mkdirSync(join(tempRoot, 'data', 'raw'), { recursive: true });
    cpSync(join(ROOT_DIR, 'data', 'sources.json'), join(tempRoot, 'data', 'sources.json'));
    const liveResults = await ingestNews({ rootDir: tempRoot, weekId, now });

    const previousSeedArticles = pickSeedArticles(liveResults.fetchResults, 0);
    const currentSeedArticles = pickSeedArticles(liveResults.fetchResults, 1);
    saveWeeklyBuffer(tempRoot, {
      weekId: previousWeekId,
      articles: previousSeedArticles,
      lastUpdated: now.toISOString(),
    });
    saveWeeklyBuffer(tempRoot, {
      weekId,
      articles: currentSeedArticles,
      lastUpdated: now.toISOString(),
    });

    const ingestResult = await ingestNews({ rootDir: tempRoot, weekId, now });
    saveWeeklyBuffer(tempRoot, ingestResult.buffer);
    const rawBuffer = loadWeeklyBuffer(tempRoot, weekId);
    assert.deepEqual(rawBuffer, ingestResult.buffer, 'Weekly RSS buffers must round-trip through disk');
    assert.deepEqual(
      loadWeeklyBuffer(tempRoot, previousWeekId).articles,
      previousSeedArticles,
      'Ingest must not modify the previous week'
    );
    assert.ok(rawBuffer.articles.length >= 5, 'Expected at least five persisted RSS articles');

    const duplicatePreviousDrops = ingestResult.sourceStats.reduce(
      (sum, stats) => sum + stats.droppedDuplicatePreviousWeek,
      0
    );
    const duplicateCurrentDrops = ingestResult.sourceStats.reduce(
      (sum, stats) => sum + stats.droppedDuplicateCurrentWeek,
      0
    );
    assert.ok(duplicatePreviousDrops > 0, 'Expected previous-week duplicate drops');
    assert.ok(duplicateCurrentDrops > 0, 'Expected current-week duplicate drops');

    for (const sourceId of EXPECTED_KEPT_SOURCE_IDS) {
      const stats = ingestResult.sourceStats.find((entry) => entry.sourceId === sourceId);
      assert.ok(stats, `Missing ingest stats for ${sourceId}`);
      assert.ok(stats.kept > 0, `Expected at least one kept article from ${sourceId}`);
    }

    const previousUrls = new Set(
      previousSeedArticles.map((article) => canonicalizeStoryUrl(article.url))
    );
    const newUrls = ingestResult.newArticles.map((article) => canonicalizeStoryUrl(article.url));
    assert.equal(new Set(newUrls).size, newUrls.length, 'New RSS articles must have unique URLs');
    assert.ok(newUrls.every((url) => !previousUrls.has(url)), 'Previous-week URLs must not re-enter');
    assert.deepEqual(readdirSync(join(tempRoot, 'data')).sort(), ['raw', 'sources.json']);

    console.log(`Week verified: ${weekId}`);
    console.log(`Feed health: ${healthResults.length}/${healthResults.length} configured sources usable`);
    console.log(`Persisted RSS articles: ${rawBuffer.articles.length}; new: ${ingestResult.newArticles.length}`);
    console.log(
      `Duplicate drops: previous_week=${duplicatePreviousDrops}, current_week=${duplicateCurrentDrops}`
    );
    for (const stats of ingestResult.sourceStats) {
      console.log(
        `  - ${stats.sourceName}: kept=${stats.kept} duplicate_previous=${stats.droppedDuplicatePreviousWeek} stale=${stats.droppedStale}`
      );
    }
    console.log('Verified ingest only; no assessment, draft, approval, proof or email was created.');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
