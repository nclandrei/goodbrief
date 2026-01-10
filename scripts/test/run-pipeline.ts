import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type { RawArticle, WeeklyBuffer } from '../types.js';
import type { PipelineTrace, GeminiArticleResult } from '../lib/types.js';
import { deduplicateArticles } from '../lib/deduplication.js';
import { processArticles } from '../lib/gemini.js';
import { filterArticles, rankArticles } from '../lib/ranking.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(): { limit: number; refresh: boolean } {
  const args = process.argv.slice(2);
  let limit = 20;
  let refresh = false;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10);
    }
    if (arg === '--refresh') {
      refresh = true;
    }
  }

  return { limit, refresh };
}

function getCurrentWeekId(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${weekNumber.toString().padStart(2, '0')}`;
}

function loadArticles(weekId: string, limit: number): RawArticle[] {
  const rawPath = resolve(__dirname, `../../data/raw/${weekId}.json`);
  try {
    const data: WeeklyBuffer = JSON.parse(readFileSync(rawPath, 'utf-8'));
    return data.articles.slice(0, limit);
  } catch (error) {
    console.error(`Failed to load articles from ${rawPath}:`, error);
    process.exit(1);
  }
}

async function runPipeline(): Promise<void> {
  const startTime = Date.now();
  const { limit, refresh } = parseArgs();
  const weekId = getCurrentWeekId();
  const cachePath = resolve(__dirname, 'cache/gemini-responses.json');
  const outputPath = resolve(__dirname, 'output/latest-run.json');

  console.log(`\n🔬 Pipeline Test Run`);
  console.log(`   Week: ${weekId}`);
  console.log(`   Limit: ${limit} articles`);
  console.log(`   Cache: ${refresh ? 'refresh' : 'use cached'}\n`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable not set');
    process.exit(1);
  }

  const articles = loadArticles(weekId, limit);
  console.log(`✓ Loaded ${articles.length} articles`);

  const dedupResult = deduplicateArticles(articles);
  console.log(`✓ Deduplication: ${dedupResult.inputCount} → ${dedupResult.outputCount} (${dedupResult.clusters.length} clusters)`);

  const geminiScores = await processArticles(
    dedupResult.outputArticles,
    {
      useCache: !refresh,
      cachePath,
      includeReasoning: true,
    },
    apiKey
  );
  console.log(`✓ Gemini: processed ${geminiScores.length} articles`);

  const filterResult = filterArticles(geminiScores);
  console.log(`✓ Filtering: ${filterResult.passedCount} passed, ${filterResult.discardedCount} discarded`);

  const rankingResult = rankArticles(filterResult.passed);
  console.log(`✓ Ranking: ${rankingResult.selected.length} selected, ${rankingResult.reserves.length} reserves`);

  const geminiArticles: GeminiArticleResult[] = geminiScores.map((score) => {
    const original = dedupResult.outputArticles.find((a) => a.id === score.id);
    return {
      ...score,
      title: original?.title ?? '',
    };
  });

  const trace: PipelineTrace = {
    timestamp: new Date().toISOString(),
    config: {
      limit,
      cached: !refresh,
      weekId,
    },
    stages: {
      input: {
        count: articles.length,
        articles: articles.map((a) => ({ id: a.id, title: a.title })),
      },
      deduplication: {
        inputCount: dedupResult.inputCount,
        outputCount: dedupResult.outputCount,
        clusters: dedupResult.clusters,
      },
      gemini: {
        articles: geminiArticles,
      },
      filtering: {
        passed: filterResult.passedCount,
        discarded: filterResult.discardedCount,
        discardReasons: filterResult.discarded,
      },
      ranking: {
        selected: rankingResult.selected,
        reserves: rankingResult.reserves,
      },
    },
    summary: {
      inputArticles: articles.length,
      afterDedup: dedupResult.outputCount,
      afterGemini: geminiScores.length,
      afterFiltering: filterResult.passedCount,
      selected: rankingResult.selected.length,
      reserves: rankingResult.reserves.length,
    },
  };

  writeFileSync(outputPath, JSON.stringify(trace, null, 2), 'utf-8');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Pipeline complete (${elapsed}s)`);
  console.log(`  Input: ${trace.summary.inputArticles} → Dedup: ${trace.summary.afterDedup} → Gemini: ${trace.summary.afterGemini} → Filter: ${trace.summary.afterFiltering} → Selected: ${trace.summary.selected}`);
  console.log(`  Output: scripts/test/output/latest-run.json\n`);
}

runPipeline().catch(console.error);
