#!/usr/bin/env npx tsx

import 'dotenv/config';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { sendAlert } from './lib/alert.js';
import { resolveProjectRoot } from './lib/project-root.js';
import { ingestNews, saveWeeklyBuffer } from './lib/news-ingest.js';

const ROOT_DIR = resolveProjectRoot(import.meta.url);

async function main(): Promise<void> {
  console.log('Fetching configured RSS feeds...');
  const result = await ingestNews({ rootDir: ROOT_DIR });

  console.log(
    `Fetched ${result.totalFetched} usable articles from ${result.successfulFeeds.length}/${result.fetchResults.length} sources`
  );

  if (result.failedFeeds.length === result.fetchResults.length) {
    await sendAlert({
      title: 'News ingestion failed',
      reason: 'All RSS feeds failed to fetch',
      details: result.failedFeeds
        .map((feed) => `${feed.source.name}: ${feed.error}`)
        .join('\n'),
      actionItems: [
        'Check if there is a network issue with the GitHub Actions runner',
        'Verify the RSS feed URLs are still valid in <code>data/sources.json</code>',
        'Try running <code>npm run ingest-news</code> locally to debug',
        'Check if the news sources have changed their RSS feed URLs',
      ],
    });
    process.exit(1);
  }

  if (result.failedFeeds.length > 0) {
    console.log(`\nNote: ${result.failedFeeds.length} feed(s) failed:`);
    for (const failed of result.failedFeeds) {
      console.log(`  - ${failed.source.name}: ${failed.error}`);
    }
  }

  console.log(`Current week: ${result.weekId}`);
  console.log(`Previous week loaded for dedupe: ${result.previousWeekId}`);
  console.log(`Found ${result.newArticles.length} new articles to append`);

  console.log('\nPer-source ingest stats:');
  for (const stats of result.sourceStats) {
    console.log(
      `  - ${stats.sourceName}: fetched=${stats.fetched} kept=${stats.kept} stale=${stats.droppedStale} duplicate_current=${stats.droppedDuplicateCurrentWeek} duplicate_previous=${stats.droppedDuplicatePreviousWeek} unknown_age=${stats.unknownAge}`
    );
  }

  mkdirSync(join(ROOT_DIR, 'data', 'raw'), { recursive: true });
  const outputPath = saveWeeklyBuffer(ROOT_DIR, result.buffer);
  console.log(`Saved ${result.buffer.articles.length} articles to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
