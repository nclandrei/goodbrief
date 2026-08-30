import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  getPartialScorePath,
  getPipelineArtifactPath,
  getPipelinePhaseSkipReason,
  readPartialScores,
  readPipelineArtifact,
  writePartialScores,
  writePipelineArtifact,
} from '../scripts/lib/pipeline-artifacts.js';
import type { PreparedPipelineData } from '../scripts/types.js';

const WEEK_ID = '2026-W35';

function preparedData(): PreparedPipelineData {
  return {
    sameWeekRepresentatives: [],
    preparedArticles: [],
    deduplication: {
      inputCount: 0,
      outputCount: 0,
      clusters: [],
    },
    historicalFilter: {
      inputCount: 0,
      outputCount: 0,
      filteredOut: 0,
      historicalCount: 0,
    },
  };
}

test('pipeline artifact writes are atomic and produce a validated checkpoint', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-pipeline-artifact-'));
  const artifactPath = writePipelineArtifact<PreparedPipelineData, 'prepare'>(
    rootDir,
    {
      weekId: WEEK_ID,
      phase: 'prepare',
      generatedAt: '2026-08-29T08:17:00.000Z',
      inputFile: `data/raw/${WEEK_ID}.json`,
      data: preparedData(),
    }
  );

  assert.equal(existsSync(artifactPath), true);
  assert.deepEqual(
    readPipelineArtifact<PreparedPipelineData, 'prepare'>(
      rootDir,
      WEEK_ID,
      'prepare'
    ).data,
    preparedData()
  );
  assert.match(
    getPipelinePhaseSkipReason(rootDir, WEEK_ID, 'prepare') || '',
    /validated artifact already exists/
  );
  assert.equal(
    readdirSync(dirname(artifactPath)).some((entry) => entry.endsWith('.tmp')),
    false
  );
});

test('skip-existing ignores malformed or mismatched pipeline artifacts', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-invalid-artifact-'));
  const artifactPath = getPipelineArtifactPath(rootDir, WEEK_ID, 'prepare');
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, '{not-json', 'utf-8');

  assert.equal(getPipelinePhaseSkipReason(rootDir, WEEK_ID, 'prepare'), null);
  assert.throws(
    () => readPipelineArtifact(rootDir, WEEK_ID, 'prepare'),
    /malformed JSON/
  );

  writeFileSync(
    artifactPath,
    JSON.stringify({
      weekId: '2026-W34',
      phase: 'score',
      generatedAt: 'not-a-date',
      inputFile: '',
      data: [],
    }),
    'utf-8'
  );

  assert.equal(getPipelinePhaseSkipReason(rootDir, WEEK_ID, 'prepare'), null);
  assert.throws(
    () => readPipelineArtifact(rootDir, WEEK_ID, 'prepare'),
    /weekId must be 2026-W35.*phase must be prepare.*generatedAt.*inputFile.*data/s
  );
});

test('partial score checkpoints are atomic and invalid checkpoints are ignored', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-partial-score-'));
  writePartialScores(rootDir, WEEK_ID, []);

  const partialPath = getPartialScorePath(rootDir, WEEK_ID);
  assert.deepEqual(readPartialScores(rootDir, WEEK_ID), []);
  assert.equal(
    readdirSync(dirname(partialPath)).some((entry) => entry.endsWith('.tmp')),
    false
  );

  const partial = JSON.parse(readFileSync(partialPath, 'utf-8')) as Record<
    string,
    unknown
  >;
  partial.weekId = '2026-W34';
  writeFileSync(partialPath, JSON.stringify(partial), 'utf-8');

  assert.equal(readPartialScores(rootDir, WEEK_ID), null);
});
