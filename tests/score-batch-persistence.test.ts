import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  DraftPipelineArtifact,
  PreparedPipelineData,
  RawArticle,
  ScoredPipelineData,
} from '../scripts/types.js';
import type { ArticleScore } from '../scripts/lib/types.js';
import type { LlmProvider, ScoreBatchOptions } from '../scripts/lib/llm/provider.js';
import { PIPELINE_ARTIFACT_FILENAMES } from '../scripts/lib/pipeline-artifacts.js';
import { runScorePhase } from '../scripts/lib/draft-pipeline.js';

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

function makeRawArticle(id: string): RawArticle {
  return {
    id,
    sourceId: 'fixture',
    sourceName: 'Fixture',
    title: `Story ${id}`,
    url: `https://example.ro/${id}`,
    summary: `Summary for ${id}`,
    publishedAt: '2026-03-08T10:00:00.000Z',
    fetchedAt: '2026-03-08T10:05:00.000Z',
  };
}

function makeScore(id: string, positivity = 80): ArticleScore {
  return {
    id,
    summary: `Scored summary for ${id}`,
    positivity,
    impact: 70,
    feltImpact: 60,
    certainty: 80,
    humanCloseness: 70,
    bureaucraticDistance: 20,
    promoRisk: 10,
    romaniaRelevant: true,
    category: 'wins',
  };
}

const WEEK_ID = '2026-W10';

/** Creates a temp directory with a prepared artifact containing the given articles. */
function setupScorePhaseRoot(articleIds: string[]): string {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-score-batch-'));
  const articles = articleIds.map(makeRawArticle);

  const prepared: DraftPipelineArtifact<PreparedPipelineData, 'prepare'> = {
    weekId: WEEK_ID,
    phase: 'prepare',
    generatedAt: '2026-03-08T10:00:00.000Z',
    inputFile: 'data/raw/2026-W10.json',
    data: {
      sameWeekRepresentatives: articles,
      preparedArticles: articles,
      deduplication: {
        inputCount: articles.length,
        outputCount: articles.length,
        clusters: [],
      },
      historicalFilter: {
        inputCount: articles.length,
        outputCount: articles.length,
        filteredOut: 0,
        historicalCount: 0,
      },
    },
  };

  const pipelineDir = join(rootDir, 'data', 'pipeline', WEEK_ID);
  writeJson(join(pipelineDir, PIPELINE_ARTIFACT_FILENAMES.prepare), prepared);

  return rootDir;
}

/**
 * Creates a mock LLM provider that scores articles in sequence and optionally
 * throws an error on a specific batch call.
 */
function createMockLlm(options: {
  failOnCall?: number;
  callLog?: Array<string[]>;
} = {}): LlmProvider {
  let callCount = 0;
  const callLog = options.callLog ?? [];

  return {
    name: 'gemini',
    async scoreArticles(articles: RawArticle[], _opts: ScoreBatchOptions): Promise<ArticleScore[]> {
      callCount++;
      callLog.push(articles.map((a) => a.id));

      if (options.failOnCall && callCount === options.failOnCall) {
        throw new Error(`Simulated LLM failure on call ${callCount}`);
      }

      return articles.map((a) => makeScore(a.id));
    },
    async semanticDedup() {
      return { groups: [] };
    },
    async classifyCounterSignal() {
      return { verdict: 'none' as const, reason: '', relatedArticleIds: [], relatedArticleTitles: [] };
    },
    async generateWrapperCopy() {
      return { greeting: '', intro: '', signOff: '', shortSummary: '' };
    },
    async refineDraft() {
      return { selectedIds: [], intro: '', shortSummary: '', reasoning: '' };
    },
  };
}

function getPartialScorePath(rootDir: string): string {
  return join(rootDir, 'data', 'pipeline', WEEK_ID, '02-scored.partial.json');
}

function getScoredArtifactPath(rootDir: string): string {
  return join(rootDir, 'data', 'pipeline', WEEK_ID, PIPELINE_ARTIFACT_FILENAMES.score);
}

// --- RED TESTS ---

test('score phase: saves partial scores after each batch', async () => {
  // 10 articles with batch size 3 = 4 batches
  const ids = Array.from({ length: 10 }, (_, i) => `art-${i}`);
  const rootDir = setupScorePhaseRoot(ids);
  const callLog: Array<string[]> = [];
  const llm = createMockLlm({ callLog });

  await runScorePhase(rootDir, WEEK_ID, llm, { batchSize: 3 });

  // After success, partial file should be cleaned up
  assert.equal(existsSync(getPartialScorePath(rootDir)), false,
    'Partial file should be removed after successful completion');

  // Final artifact should exist with all articles scored
  const artifact = JSON.parse(
    readFileSync(getScoredArtifactPath(rootDir), 'utf-8')
  ) as DraftPipelineArtifact<ScoredPipelineData, 'score'>;

  assert.equal(artifact.data.totalProcessed, 10);
  // All 4 batches should have been called
  assert.equal(callLog.length, 4);
});

test('score phase: resumes from partial file on restart after failure', async () => {
  // 10 articles, batch size 3 = 4 batches. Fail on batch 3.
  const ids = Array.from({ length: 10 }, (_, i) => `art-${i}`);
  const rootDir = setupScorePhaseRoot(ids);

  const firstRunLog: Array<string[]> = [];
  const failingLlm = createMockLlm({ failOnCall: 3, callLog: firstRunLog });

  // First run: should fail on batch 3
  await assert.rejects(
    runScorePhase(rootDir, WEEK_ID, failingLlm, { batchSize: 3 }),
    /Simulated LLM failure/
  );

  // Batches 1 and 2 completed (6 articles), batch 3 failed
  assert.equal(firstRunLog.length, 3); // called 3 times, 3rd threw

  // Partial file should exist with scores from batches 1 and 2
  assert.equal(existsSync(getPartialScorePath(rootDir)), true,
    'Partial file should exist after failure');
  const partial = JSON.parse(readFileSync(getPartialScorePath(rootDir), 'utf-8'));
  assert.equal(partial.scores.length, 6, 'Should have saved 6 scores from 2 completed batches');

  // Second run: should resume and only process remaining articles
  const secondRunLog: Array<string[]> = [];
  const successLlm = createMockLlm({ callLog: secondRunLog });

  await runScorePhase(rootDir, WEEK_ID, successLlm, { batchSize: 3 });

  // Should only have processed the 4 remaining articles (art-6..art-9)
  const allReprocessedIds = secondRunLog.flat();
  assert.equal(allReprocessedIds.length, 4,
    'Should only process the 4 articles not in partial file');
  assert.ok(
    !allReprocessedIds.includes('art-0'),
    'Should not re-score articles from completed batches'
  );
  assert.ok(
    allReprocessedIds.includes('art-6'),
    'Should score articles from failed batch onwards'
  );

  // Final artifact should exist
  const artifact = JSON.parse(
    readFileSync(getScoredArtifactPath(rootDir), 'utf-8')
  ) as DraftPipelineArtifact<ScoredPipelineData, 'score'>;
  assert.equal(artifact.data.totalProcessed, 10);

  // Partial file should be cleaned up
  assert.equal(existsSync(getPartialScorePath(rootDir)), false);
});

test('score phase: partial file includes scores from failed batch\'s articles that weren\'t scored', async () => {
  // Verify we don't lose track of which articles were in a failed batch
  const ids = Array.from({ length: 6 }, (_, i) => `art-${i}`);
  const rootDir = setupScorePhaseRoot(ids);

  const failingLlm = createMockLlm({ failOnCall: 2 });

  await assert.rejects(
    runScorePhase(rootDir, WEEK_ID, failingLlm, { batchSize: 3 }),
    /Simulated LLM failure/
  );

  // Only batch 1 (art-0, art-1, art-2) succeeded
  const partial = JSON.parse(readFileSync(getPartialScorePath(rootDir), 'utf-8'));
  const savedIds = partial.scores.map((s: ArticleScore) => s.id);
  assert.deepEqual(savedIds, ['art-0', 'art-1', 'art-2']);
});

test('score phase: final artifact is identical whether run fresh or resumed from partial', async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `art-${i}`);

  // Fresh run
  const freshRoot = setupScorePhaseRoot(ids);
  await runScorePhase(freshRoot, WEEK_ID, createMockLlm(), { batchSize: 3 });

  // Resumed run (fail on batch 2, then succeed)
  const resumeRoot = setupScorePhaseRoot(ids);
  const failingLlm = createMockLlm({ failOnCall: 2 });
  await assert.rejects(
    runScorePhase(resumeRoot, WEEK_ID, failingLlm, { batchSize: 3 }),
    /Simulated LLM failure/
  );
  await runScorePhase(resumeRoot, WEEK_ID, createMockLlm(), { batchSize: 3 });

  // Compare artifacts (strip volatile timestamps)
  const freshArtifact = JSON.parse(readFileSync(getScoredArtifactPath(freshRoot), 'utf-8'));
  const resumeArtifact = JSON.parse(readFileSync(getScoredArtifactPath(resumeRoot), 'utf-8'));

  // Data should match (articles, counts)
  assert.equal(freshArtifact.data.totalProcessed, resumeArtifact.data.totalProcessed);
  assert.equal(freshArtifact.data.discarded, resumeArtifact.data.discarded);
  assert.deepEqual(
    freshArtifact.data.articles.map((a: { id: string }) => a.id).sort(),
    resumeArtifact.data.articles.map((a: { id: string }) => a.id).sort()
  );
});

test('score phase: with no partial file and no failure, no partial file is ever written to final state', async () => {
  // Simple happy path - 5 articles, batch size 5 = 1 batch
  const ids = Array.from({ length: 5 }, (_, i) => `art-${i}`);
  const rootDir = setupScorePhaseRoot(ids);

  await runScorePhase(rootDir, WEEK_ID, createMockLlm(), { batchSize: 5 });

  assert.equal(existsSync(getPartialScorePath(rootDir)), false);
  assert.equal(existsSync(getScoredArtifactPath(rootDir)), true);
});
