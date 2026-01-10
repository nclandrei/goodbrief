import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type {
  ProcessedArticle,
  WeeklyBuffer,
  NewsletterDraft,
} from './types.js';
import { deduplicateArticles } from './lib/deduplication.js';
import { processArticleBatch, createGeminiModel } from './lib/gemini.js';
import type { ArticleScore } from './lib/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const model = createGeminiModel(GEMINI_API_KEY, false);

function getISOWeekId(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 -
      3 +
      ((week1.getDay() + 6) % 7)) /
      7 +
      1
  );
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

async function main() {
  const weekId = getISOWeekId();
  const rawPath = join(ROOT_DIR, 'data', 'raw', `${weekId}.json`);

  if (!existsSync(rawPath)) {
    console.error(`No raw data found for ${weekId}`);
    process.exit(1);
  }

  const buffer: WeeklyBuffer = JSON.parse(readFileSync(rawPath, 'utf-8'));
  console.log(`Processing ${buffer.articles.length} articles for ${weekId}`);

  console.log('Deduplicating articles...');
  const dedupResult = deduplicateArticles(buffer.articles);
  const representatives = dedupResult.outputArticles;
  console.log(
    `Deduplicated ${buffer.articles.length} articles to ${representatives.length} unique stories`
  );

  const BATCH_SIZE = 200;
  const allScores: ArticleScore[] = [];

  for (let i = 0; i < representatives.length; i += BATCH_SIZE) {
    const batch = representatives.slice(i, i + BATCH_SIZE);
    console.log(
      `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(representatives.length / BATCH_SIZE)}...`
    );
    const scores = await processArticleBatch(batch, model, false);
    allScores.push(...scores);

    if (i + BATCH_SIZE < representatives.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const scoreMap = new Map(allScores.map((s) => [s.id, s]));
  const now = new Date().toISOString();
  const seenIds = new Set<string>();

  const processed: ProcessedArticle[] = representatives
    .map((raw) => {
      if (seenIds.has(raw.id)) return null;
      seenIds.add(raw.id);

      const score = scoreMap.get(raw.id);
      if (!score) return null;
      if (!score.romaniaRelevant) return null;
      return {
        id: raw.id,
        sourceId: raw.sourceId,
        sourceName: raw.sourceName,
        originalTitle: raw.title,
        url: raw.url,
        summary: score.summary,
        positivity: score.positivity,
        impact: score.impact,
        category: score.category,
        publishedAt: raw.publishedAt,
        processedAt: now,
      };
    })
    .filter((p): p is ProcessedArticle => p !== null);

  const positive = processed.filter((p) => p.positivity >= 40);
  const discarded = processed.length - positive.length;

  positive.sort((a, b) => {
    const scoreA = a.positivity * 0.6 + a.impact * 0.4;
    const scoreB = b.positivity * 0.6 + b.impact * 0.4;
    return scoreB - scoreA;
  });

  const draft: NewsletterDraft = {
    weekId,
    generatedAt: now,
    selected: positive.slice(0, 10),
    reserves: positive.slice(10, 30),
    discarded,
    totalProcessed: processed.length,
  };

  const draftPath = join(ROOT_DIR, 'data', 'drafts', `${weekId}.json`);
  writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf-8');

  console.log(`Draft saved to ${draftPath}`);
  console.log(
    `Selected: ${draft.selected.length}, Reserves: ${draft.reserves.length}, Discarded: ${discarded}`
  );
}

main().catch(console.error);
