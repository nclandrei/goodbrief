import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import Parser from 'rss-parser';
import type { RawArticle, RssSource, WeeklyBuffer } from '../types.js';
import { canonicalizeStoryUrl } from './deduplication.js';
import { getMondayOfISOWeek } from './newsletter-week.js';

export const DEFAULT_SOURCE_TIMEOUT_MS = 6000;
export const DEFAULT_INGEST_MAX_AGE_DAYS = 14;

const SOURCE_TIMEOUT_MS: Record<string, number> = {
  agerpres: 4000,
};

const parser = new Parser();

interface UrlIndex {
  normalized: Set<string>;
  canonical: Set<string>;
}

export interface FetchFeedResult {
  source: RssSource;
  articles: RawArticle[];
  error?: string;
  statusCode?: number;
  contentType?: string | null;
  parsedItemCount: number;
  usableItemCount: number;
}

export interface SourceIngestStats {
  sourceId: string;
  sourceName: string;
  fetched: number;
  kept: number;
  droppedStale: number;
  droppedDuplicateCurrentWeek: number;
  droppedDuplicatePreviousWeek: number;
  unknownAge: number;
}

export interface IngestNewsOptions {
  rootDir: string;
  weekId?: string;
  now?: Date;
  sources?: RssSource[];
  maxAgeDays?: number;
}

export interface IngestNewsResult {
  weekId: string;
  previousWeekId: string;
  buffer: WeeklyBuffer;
  previousBuffer: WeeklyBuffer;
  newArticles: RawArticle[];
  fetchResults: FetchFeedResult[];
  failedFeeds: FetchFeedResult[];
  successfulFeeds: FetchFeedResult[];
  sourceStats: SourceIngestStats[];
  totalFetched: number;
  totalKept: number;
}

export function getISOWeekId(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7 + 1
  );
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

export function getPreviousISOWeekId(weekId: string): string {
  const monday = getMondayOfISOWeek(weekId);
  monday.setDate(monday.getDate() - 7);
  return getISOWeekId(monday);
}

export function resolveIngestNow(explicitNow?: Date): Date {
  if (explicitNow) {
    return explicitNow;
  }

  const envValue = process.env.GOODBRIEF_INGEST_NOW;
  if (!envValue) {
    return new Date();
  }

  const parsed = new Date(envValue);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }

  return parsed;
}

export function loadSources(rootDir: string): RssSource[] {
  const sourcesPath = join(rootDir, 'data', 'sources.json');
  return JSON.parse(readFileSync(sourcesPath, 'utf-8')) as RssSource[];
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const paramsToRemove = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
    ];
    paramsToRemove.forEach((param) => parsed.searchParams.delete(param));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function hashArticle(sourceId: string, url: string): string {
  return createHash('sha256')
    .update(`${sourceId}:${normalizeUrl(url)}`)
    .digest('hex')
    .slice(0, 16);
}

function getSourceTimeoutMs(source: RssSource): number {
  return SOURCE_TIMEOUT_MS[source.id] ?? DEFAULT_SOURCE_TIMEOUT_MS;
}

function getFetchErrorMessage(error: unknown, timeoutMs: number): string {
  const isAbortError =
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError';

  if (isAbortError) {
    return `Request timed out after ${timeoutMs}ms`;
  }

  return error instanceof Error ? error.message : String(error);
}

function isUsableFeedItem(item: { title?: string | null; link?: string | null }): boolean {
  return Boolean(item.title?.trim()) && Boolean(item.link?.trim());
}

export async function fetchFeed(
  source: RssSource,
  now: Date = resolveIngestNow()
): Promise<FetchFeedResult> {
  const timeoutMs = getSourceTimeoutMs(source);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'goodbrief-ingest/1.0 (+https://goodbrief.ro)',
      },
    });

    if (!response.ok) {
      throw new Error(`Status code ${response.status}`);
    }

    const xml = await response.text();
    const feed = await parser.parseString(xml);
    const fetchedAt = now.toISOString();
    const parsedItemCount = (feed.items || []).length;
    const usableItems = (feed.items || []).filter(isUsableFeedItem);
    const articles = usableItems.map((item) => ({
      id: hashArticle(source.id, item.link || ''),
      sourceId: source.id,
      sourceName: source.name,
      title: item.title?.trim() || '',
      url: normalizeUrl(item.link || ''),
      summary: item.contentSnippet || item.content || '',
      publishedAt: item.isoDate || item.pubDate || fetchedAt,
      fetchedAt,
    }));

    return {
      source,
      articles,
      statusCode: response.status,
      contentType: response.headers.get('content-type'),
      parsedItemCount,
      usableItemCount: usableItems.length,
    };
  } catch (error) {
    return {
      source,
      articles: [],
      error: getFetchErrorMessage(error, timeoutMs),
      parsedItemCount: 0,
      usableItemCount: 0,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function loadWeeklyBuffer(rootDir: string, weekId: string): WeeklyBuffer {
  const filePath = join(rootDir, 'data', 'raw', `${weekId}.json`);
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf-8');
    if (content.startsWith('version https://git-lfs.github.com/spec/v1')) {
      return { weekId, articles: [], lastUpdated: new Date().toISOString() };
    }
    return JSON.parse(content) as WeeklyBuffer;
  }

  return { weekId, articles: [], lastUpdated: new Date().toISOString() };
}

export function saveWeeklyBuffer(rootDir: string, buffer: WeeklyBuffer): string {
  const filePath = join(rootDir, 'data', 'raw', `${buffer.weekId}.json`);
  writeFileSync(filePath, JSON.stringify(buffer, null, 2), 'utf-8');
  return filePath;
}

function getUrlKeys(url: string): { normalized: string; canonical: string } {
  const normalized = normalizeUrl(url);
  return {
    normalized,
    canonical: canonicalizeStoryUrl(normalized),
  };
}

function buildUrlIndex(articles: RawArticle[]): UrlIndex {
  const index: UrlIndex = {
    normalized: new Set<string>(),
    canonical: new Set<string>(),
  };

  for (const article of articles) {
    const keys = getUrlKeys(article.url);
    if (keys.normalized) {
      index.normalized.add(keys.normalized);
    }
    if (keys.canonical) {
      index.canonical.add(keys.canonical);
    }
  }

  return index;
}

function registerUrl(index: UrlIndex, article: RawArticle): void {
  const keys = getUrlKeys(article.url);
  if (keys.normalized) {
    index.normalized.add(keys.normalized);
  }
  if (keys.canonical) {
    index.canonical.add(keys.canonical);
  }
}

function hasUrl(index: UrlIndex, article: RawArticle): boolean {
  const keys = getUrlKeys(article.url);
  return (
    (keys.normalized ? index.normalized.has(keys.normalized) : false) ||
    (keys.canonical ? index.canonical.has(keys.canonical) : false)
  );
}

function isArticleStale(
  article: Pick<RawArticle, 'publishedAt'>,
  now: Date,
  maxAgeDays: number
): boolean | null {
  const publishedAt = new Date(article.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) {
    return null;
  }

  const ageInDays = (now.getTime() - publishedAt) / 86_400_000;
  return ageInDays > maxAgeDays;
}

function createEmptySourceStats(source: RssSource): SourceIngestStats {
  return {
    sourceId: source.id,
    sourceName: source.name,
    fetched: 0,
    kept: 0,
    droppedStale: 0,
    droppedDuplicateCurrentWeek: 0,
    droppedDuplicatePreviousWeek: 0,
    unknownAge: 0,
  };
}

export function selectNewArticles(options: {
  fetchResults: FetchFeedResult[];
  currentBuffer: WeeklyBuffer;
  previousBuffer: WeeklyBuffer;
  now?: Date;
  maxAgeDays?: number;
}): { newArticles: RawArticle[]; sourceStats: SourceIngestStats[] } {
  const now = resolveIngestNow(options.now);
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_INGEST_MAX_AGE_DAYS;
  const currentIndex = buildUrlIndex(options.currentBuffer.articles);
  const previousIndex = buildUrlIndex(options.previousBuffer.articles);
  const statsBySource = new Map<string, SourceIngestStats>();
  const newArticles: RawArticle[] = [];

  for (const result of options.fetchResults) {
    const stats = statsBySource.get(result.source.id) || createEmptySourceStats(result.source);
    stats.fetched = result.usableItemCount;

    for (const article of result.articles) {
      const stale = isArticleStale(article, now, maxAgeDays);
      if (stale === null) {
        stats.unknownAge += 1;
      } else if (stale) {
        stats.droppedStale += 1;
        continue;
      }

      if (hasUrl(currentIndex, article)) {
        stats.droppedDuplicateCurrentWeek += 1;
        continue;
      }

      if (hasUrl(previousIndex, article)) {
        stats.droppedDuplicatePreviousWeek += 1;
        continue;
      }

      newArticles.push(article);
      stats.kept += 1;
      registerUrl(currentIndex, article);
    }

    statsBySource.set(result.source.id, stats);
  }

  return {
    newArticles,
    sourceStats: Array.from(statsBySource.values()),
  };
}

export async function ingestNews(options: IngestNewsOptions): Promise<IngestNewsResult> {
  const now = resolveIngestNow(options.now);
  const weekId = options.weekId || getISOWeekId(now);
  const previousWeekId = getPreviousISOWeekId(weekId);
  const sources = options.sources || loadSources(options.rootDir);
  const currentBuffer = loadWeeklyBuffer(options.rootDir, weekId);
  const previousBuffer = loadWeeklyBuffer(options.rootDir, previousWeekId);
  const fetchResults = await Promise.all(sources.map((source) => fetchFeed(source, now)));
  const { newArticles, sourceStats } = selectNewArticles({
    fetchResults,
    currentBuffer,
    previousBuffer,
    now,
    maxAgeDays: options.maxAgeDays,
  });

  currentBuffer.articles.push(...newArticles);
  currentBuffer.lastUpdated = now.toISOString();

  return {
    weekId,
    previousWeekId,
    buffer: currentBuffer,
    previousBuffer,
    newArticles,
    fetchResults,
    failedFeeds: fetchResults.filter((result) => result.error),
    successfulFeeds: fetchResults.filter((result) => !result.error),
    sourceStats,
    totalFetched: sourceStats.reduce((sum, stats) => sum + stats.fetched, 0),
    totalKept: sourceStats.reduce((sum, stats) => sum + stats.kept, 0),
  };
}
