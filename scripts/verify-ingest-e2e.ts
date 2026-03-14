#!/usr/bin/env npx tsx

import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ArticleCategory, ProcessedArticle, RawArticle } from './types.js';
import type { ArticleScore } from './lib/types.js';
import { checkConfiguredFeedHealth } from './lib/feed-health.js';
import {
  getISOWeekId,
  getPreviousISOWeekId,
  ingestNews,
  loadWeeklyBuffer,
  resolveIngestNow,
  type FetchFeedResult,
} from './lib/news-ingest.js';
import { resolveProjectRoot } from './lib/project-root.js';

const execFileAsync = promisify(execFile);
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
const EDITORIAL_SIGNAL_KEYS = [
  'feltImpact',
  'certainty',
  'humanCloseness',
  'bureaucraticDistance',
  'promoRisk',
] as const;
const SIGNAL_TEMPLATES: Record<
  ArticleCategory,
  Required<Pick<ArticleScore, (typeof EDITORIAL_SIGNAL_KEYS)[number]>>
> = {
  wins: {
    feltImpact: 58,
    certainty: 66,
    humanCloseness: 42,
    bureaucraticDistance: 36,
    promoRisk: 22,
  },
  'local-heroes': {
    feltImpact: 90,
    certainty: 92,
    humanCloseness: 95,
    bureaucraticDistance: 8,
    promoRisk: 4,
  },
  'green-stuff': {
    feltImpact: 84,
    certainty: 87,
    humanCloseness: 76,
    bureaucraticDistance: 16,
    promoRisk: 8,
  },
  'quick-hits': {
    feltImpact: 66,
    certainty: 78,
    humanCloseness: 58,
    bureaucraticDistance: 24,
    promoRisk: 12,
  },
};

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

function createTempRoot(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-ingest-e2e-'));
  mkdirSync(join(tempRoot, 'data', 'raw'), { recursive: true });
  mkdirSync(join(tempRoot, 'data', 'drafts'), { recursive: true });
  mkdirSync(join(tempRoot, 'content', 'issues'), { recursive: true });
  cpSync(join(ROOT_DIR, 'data', 'sources.json'), join(tempRoot, 'data', 'sources.json'));
  return tempRoot;
}

function pickSeedArticles(
  results: FetchFeedResult[],
  articleIndex: number
): RawArticle[] {
  return results
    .filter((result) => !result.error)
    .map((result) => result.articles[articleIndex])
    .filter((article): article is RawArticle => article !== undefined);
}

function createScoreMock(articles: RawArticle[]): ArticleScore[] {
  const categories: ArticleCategory[] = [
    'wins',
    'local-heroes',
    'green-stuff',
    'quick-hits',
  ];

  return articles.map((article, index) => {
    const category = categories[index % categories.length];

    return {
      id: article.id,
      summary: article.summary?.trim() || article.title,
      positivity: 90 - (index % 8),
      impact: 82 - (index % 6),
      ...SIGNAL_TEMPLATES[category],
      romaniaRelevant: true,
      category,
    };
  });
}

function isCommunityCentered(article: ProcessedArticle): boolean {
  return (
    article.category === 'local-heroes' ||
    (article.humanCloseness || 0) >= 75 ||
    ((article.feltImpact || 0) >= 72 && (article.certainty || 0) >= 65)
  );
}

async function runScript(
  scriptName: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  await execFileAsync(
    process.execPath,
    ['--import', 'tsx', join(ROOT_DIR, 'scripts', scriptName), ...args],
    {
      cwd: ROOT_DIR,
      env,
      maxBuffer: 10 * 1024 * 1024,
    }
  );
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

  const tempRoot = createTempRoot();
  const liveResults = await ingestNews({
    rootDir: tempRoot,
    weekId,
    now,
  });

  const previousSeedArticles = pickSeedArticles(liveResults.fetchResults, 0);
  const currentSeedArticles = pickSeedArticles(liveResults.fetchResults, 1);

  writeJson(join(tempRoot, 'data', 'raw', `${previousWeekId}.json`), {
    weekId: previousWeekId,
    articles: previousSeedArticles,
    lastUpdated: now.toISOString(),
  });
  writeJson(join(tempRoot, 'data', 'raw', `${weekId}.json`), {
    weekId,
    articles: currentSeedArticles,
    lastUpdated: now.toISOString(),
  });

  const ingestResult = await ingestNews({
    rootDir: tempRoot,
    weekId,
    now,
  });
  writeJson(join(tempRoot, 'data', 'raw', `${weekId}.json`), ingestResult.buffer);

  const duplicatePreviousDrops = ingestResult.sourceStats.reduce(
    (sum, stats) => sum + stats.droppedDuplicatePreviousWeek,
    0
  );
  assert.ok(
    duplicatePreviousDrops > 0,
    'Expected previous-week duplicate drops during isolated ingest verification'
  );

  for (const sourceId of EXPECTED_KEPT_SOURCE_IDS) {
    const stats = ingestResult.sourceStats.find((entry) => entry.sourceId === sourceId);
    assert.ok(stats, `Missing ingest stats for ${sourceId}`);
    assert.ok(
      (stats?.kept || 0) > 0,
      `Expected at least one kept article from ${sourceId}`
    );
  }

  const rawBuffer = loadWeeklyBuffer(tempRoot, weekId);
  assert.ok(rawBuffer.articles.length >= 5, 'Need at least 5 raw articles for pipeline verification');

  const scoreMockPath = join(tempRoot, 'score-mock.json');
  const archiveReviewMockPath = join(tempRoot, 'archive-review-mock.json');
  const counterSignalMockPath = join(tempRoot, 'counter-signal-mock.json');
  const wrapperCopyMockPath = join(tempRoot, 'wrapper-copy-mock.json');
  const proofOutputPath = join(tempRoot, 'proof.html');

  writeJson(scoreMockPath, createScoreMock(rawBuffer.articles));
  writeJson(counterSignalMockPath, {});
  writeJson(wrapperCopyMockPath, {
    greeting: 'Salut!',
    intro: 'Avem un test local end-to-end pentru noul mix de surse.',
    signOff: 'Pe curând!',
    shortSummary: 'Test local end-to-end.',
  });

  const sharedEnv = {
    ...process.env,
    GOODBRIEF_ROOT_DIR: tempRoot,
    GOODBRIEF_SCORE_MOCK_FILE: scoreMockPath,
    GOODBRIEF_WRAPPER_COPY_MOCK_FILE: wrapperCopyMockPath,
    GOODBRIEF_DISABLE_SEMANTIC_DEDUP: '1',
    GOODBRIEF_DISABLE_DRAFT_REFINEMENT: '1',
    GOODBRIEF_VALIDATION_NOW: now.toISOString(),
    GEMINI_API_KEY: 'test-key',
  };

  await runScript(
    'generate-draft.ts',
    ['--week', weekId],
    {
      ...sharedEnv,
      GOODBRIEF_COUNTER_SIGNAL_MOCK_FILE: counterSignalMockPath,
    }
  );

  const draftPath = join(tempRoot, 'data', 'drafts', `${weekId}.json`);
  const generatedDraft = JSON.parse(readFileSync(draftPath, 'utf-8')) as {
    selected: Array<{ id: string }>;
    reserves: Array<{ id: string }>;
  };
  writeJson(archiveReviewMockPath, {
    reviews: [...generatedDraft.selected, ...generatedDraft.reserves].map((article) => ({
      articleId: article.id,
      verdict: 'fresh',
      notes: 'Approved in isolated end-to-end verification.',
    })),
  });

  await runScript(
    'validate-draft-freshness.ts',
    ['--week', weekId],
    {
      ...sharedEnv,
      GOODBRIEF_ARCHIVE_REVIEW_PATH: archiveReviewMockPath,
    }
  );
  await runScript(
    'notify-draft.ts',
    ['--week', weekId, '--dry-run', '--output', proofOutputPath],
    sharedEnv
  );

  assert.equal(existsSync(draftPath), true, 'Expected draft file to be created');
  assert.equal(existsSync(proofOutputPath), true, 'Expected proof HTML to be created');

  const draft = JSON.parse(readFileSync(draftPath, 'utf-8')) as {
    selected: ProcessedArticle[];
    reserves: ProcessedArticle[];
    validation?: { status?: string };
  };
  assert.ok(draft.selected.length > 0, 'Expected selected stories in generated draft');
  assert.equal(draft.validation?.status, 'passed');

  const shortlisted = [...draft.selected, ...draft.reserves];
  assert.ok(shortlisted.length > 0, 'Expected selected or reserve stories in generated draft');
  assert.ok(
    shortlisted.every((article) =>
      EDITORIAL_SIGNAL_KEYS.every((key) => typeof article[key] === 'number')
    ),
    'Expected all shortlisted draft articles to keep detailed editorial signal scores'
  );
  assert.ok(
    draft.selected.filter((article) => article.category === 'green-stuff').length >= 1,
    'Expected the selected draft to keep at least one green story'
  );
  assert.ok(
    draft.selected.filter(isCommunityCentered).length >= 2,
    'Expected the selected draft to keep at least two community-centered stories'
  );

  console.log(`Temporary verification root: ${tempRoot}`);
  console.log(`Week verified: ${weekId}`);
  console.log('Feed health: all configured sources returned usable items');
  console.log(
    `Ingest duplicate drops: previous_week=${duplicatePreviousDrops}, stale=${ingestResult.sourceStats.reduce((sum, stats) => sum + stats.droppedStale, 0)}`
  );
  for (const stats of ingestResult.sourceStats) {
    console.log(
      `  - ${stats.sourceName}: kept=${stats.kept} duplicate_previous=${stats.droppedDuplicatePreviousWeek} stale=${stats.droppedStale}`
    );
  }
  console.log(`Proof output: ${proofOutputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
