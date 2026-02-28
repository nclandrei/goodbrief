import 'dotenv/config';
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Parser from "rss-parser";
import type { RssSource, RawArticle, WeeklyBuffer } from "./types.js";
import { sendAlert } from "./lib/alert.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");

const DEFAULT_SOURCE_TIMEOUT_MS = 6000;
const SOURCE_TIMEOUT_MS: Record<string, number> = {
  agerpres: 4000,
};

const parser = new Parser();

function getISOWeekId(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7 + 1
  );
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const paramsToRemove = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
    paramsToRemove.forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

function hashArticle(sourceId: string, url: string): string {
  return createHash("sha256").update(`${sourceId}:${normalizeUrl(url)}`).digest("hex").slice(0, 16);
}

interface FetchResult {
  source: RssSource;
  articles: RawArticle[];
  error?: string;
}

function getSourceTimeoutMs(source: RssSource): number {
  return SOURCE_TIMEOUT_MS[source.id] ?? DEFAULT_SOURCE_TIMEOUT_MS;
}

function getFetchErrorMessage(error: unknown, timeoutMs: number): string {
  const isAbortError =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError";

  if (isAbortError) {
    return `Request timed out after ${timeoutMs}ms`;
  }

  return error instanceof Error ? error.message : String(error);
}

async function fetchFeed(source: RssSource): Promise<FetchResult> {
  const timeoutMs = getSourceTimeoutMs(source);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log(`Fetching ${source.name}...`);
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "goodbrief-ingest/1.0 (+https://goodbrief.ro)",
      },
    });

    if (!response.ok) {
      throw new Error(`Status code ${response.status}`);
    }

    const xml = await response.text();
    const feed = await parser.parseString(xml);
    const now = new Date().toISOString();

    const articles = (feed.items || []).map((item) => ({
      id: hashArticle(source.id, item.link || ""),
      sourceId: source.id,
      sourceName: source.name,
      title: item.title || "",
      url: normalizeUrl(item.link || ""),
      summary: item.contentSnippet || item.content || "",
      publishedAt: item.isoDate || item.pubDate || now,
      fetchedAt: now,
    }));
    return { source, articles };
  } catch (error) {
    const errorMsg = getFetchErrorMessage(error, timeoutMs);
    console.error(`Error fetching ${source.name}:`, errorMsg);
    return { source, articles: [], error: errorMsg };
  } finally {
    clearTimeout(timeoutId);
  }
}

function loadWeeklyBuffer(weekId: string): WeeklyBuffer {
  const filePath = join(ROOT_DIR, "data", "raw", `${weekId}.json`);
  if (existsSync(filePath)) {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  }
  return { weekId, articles: [], lastUpdated: new Date().toISOString() };
}

function saveWeeklyBuffer(buffer: WeeklyBuffer): void {
  const filePath = join(ROOT_DIR, "data", "raw", `${buffer.weekId}.json`);
  writeFileSync(filePath, JSON.stringify(buffer, null, 2), "utf-8");
  console.log(`Saved ${buffer.articles.length} articles to ${filePath}`);
}

async function main() {
  const sourcesPath = join(ROOT_DIR, "data", "sources.json");
  const sources: RssSource[] = JSON.parse(readFileSync(sourcesPath, "utf-8"));

  console.log(`Fetching from ${sources.length} sources...`);
  const results = await Promise.all(sources.map(fetchFeed));

  const failedFeeds = results.filter((r) => r.error);
  const successfulFeeds = results.filter((r) => !r.error);
  const allArticles = results.flatMap((r) => r.articles);

  console.log(`Fetched ${allArticles.length} articles from ${successfulFeeds.length}/${sources.length} sources`);

  // Alert only if ALL feeds failed - this needs human attention
  if (failedFeeds.length === sources.length) {
    await sendAlert({
      title: "News ingestion failed",
      reason: "All RSS feeds failed to fetch",
      details: failedFeeds.map((f) => `${f.source.name}: ${f.error}`).join("\n"),
      actionItems: [
        "Check if there's a network issue with the GitHub Actions runner",
        "Verify the RSS feed URLs are still valid in <code>data/sources.json</code>",
        "Try running <code>npm run ingest-news</code> locally to debug",
        "Check if the news sources have changed their RSS feed URLs",
      ],
    });
    process.exit(1);
  }

  const weekId = getISOWeekId();
  const buffer = loadWeeklyBuffer(weekId);
  const existingIds = new Set(buffer.articles.map((a) => a.id));

  const newArticles = allArticles.filter((a) => !existingIds.has(a.id));
  console.log(`Found ${newArticles.length} new articles`);

  // Log failed feeds for visibility (but don't alert - partial failure is expected)
  if (failedFeeds.length > 0) {
    console.log(`\nNote: ${failedFeeds.length} feed(s) failed:`);
    failedFeeds.forEach((f) => console.log(`  - ${f.source.name}: ${f.error}`));
  }

  buffer.articles.push(...newArticles);
  buffer.lastUpdated = new Date().toISOString();

  saveWeeklyBuffer(buffer);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
