import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Parser from "rss-parser";
import type { RssSource, RawArticle, WeeklyBuffer } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");

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

async function fetchFeed(source: RssSource): Promise<RawArticle[]> {
  try {
    console.log(`Fetching ${source.name}...`);
    const feed = await parser.parseURL(source.url);
    const now = new Date().toISOString();

    return (feed.items || []).map((item) => ({
      id: hashArticle(source.id, item.link || ""),
      sourceId: source.id,
      sourceName: source.name,
      title: item.title || "",
      url: normalizeUrl(item.link || ""),
      summary: item.contentSnippet || item.content || "",
      publishedAt: item.isoDate || item.pubDate || now,
      fetchedAt: now,
    }));
  } catch (error) {
    console.error(`Error fetching ${source.name}:`, error instanceof Error ? error.message : error);
    return [];
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
  const allArticles = results.flat();

  console.log(`Fetched ${allArticles.length} articles total`);

  const weekId = getISOWeekId();
  const buffer = loadWeeklyBuffer(weekId);
  const existingIds = new Set(buffer.articles.map((a) => a.id));

  const newArticles = allArticles.filter((a) => !existingIds.has(a.id));
  console.log(`Found ${newArticles.length} new articles`);

  buffer.articles.push(...newArticles);
  buffer.lastUpdated = new Date().toISOString();

  saveWeeklyBuffer(buffer);
}

main().catch(console.error);
