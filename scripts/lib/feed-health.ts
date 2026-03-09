import type { RssSource } from '../types.js';
import { fetchFeed, loadSources, resolveIngestNow, type FetchFeedResult } from './news-ingest.js';

export interface FeedHealthResult {
  source: RssSource;
  ok: boolean;
  statusCode?: number;
  contentType?: string | null;
  parsedItemCount: number;
  usableItemCount: number;
  error?: string;
}

export async function checkFeedHealth(
  source: RssSource,
  now: Date = resolveIngestNow()
): Promise<FeedHealthResult> {
  const result: FetchFeedResult = await fetchFeed(source, now);
  if (result.error) {
    return {
      source,
      ok: false,
      parsedItemCount: result.parsedItemCount,
      usableItemCount: result.usableItemCount,
      error: result.error,
      statusCode: result.statusCode,
      contentType: result.contentType,
    };
  }

  if (result.usableItemCount < 1) {
    return {
      source,
      ok: false,
      parsedItemCount: result.parsedItemCount,
      usableItemCount: result.usableItemCount,
      statusCode: result.statusCode,
      contentType: result.contentType,
      error: 'Feed returned no usable items with both title and link',
    };
  }

  return {
    source,
    ok: true,
    parsedItemCount: result.parsedItemCount,
    usableItemCount: result.usableItemCount,
    statusCode: result.statusCode,
    contentType: result.contentType,
  };
}

export async function checkConfiguredFeedHealth(
  rootDir: string,
  now: Date = resolveIngestNow()
): Promise<FeedHealthResult[]> {
  const sources = loadSources(rootDir);
  return Promise.all(sources.map((source) => checkFeedHealth(source, now)));
}
