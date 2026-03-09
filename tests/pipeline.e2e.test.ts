import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  WORKSPACE_ROOT,
  createTempProjectFromFixture,
  getIsoWeekId,
  runTypeScriptScript,
  seedRawWeek,
} from './helpers.js';

test('Saturday pipeline generates, validates, and renders a proof without sending', async () => {
  const tempRoot = createTempProjectFromFixture();
  const weekId = getIsoWeekId(new Date());
  const draftPath = join(tempRoot, 'data', 'drafts', `${weekId}.json`);
  const proofOutputPath = join(tempRoot, 'proof.html');
  const sharedEnv = {
    GOODBRIEF_ROOT_DIR: tempRoot,
    GOODBRIEF_GEMINI_SCORES_PATH: join(tempRoot, 'mocks', 'generate-scores.json'),
    GOODBRIEF_WRAPPER_COPY_PATH: join(tempRoot, 'mocks', 'wrapper-copy.json'),
    GOODBRIEF_ARCHIVE_REVIEW_PATH: join(tempRoot, 'mocks', 'archive-review.json'),
    GOODBRIEF_DISABLE_SEMANTIC_DEDUP: '1',
    GOODBRIEF_DISABLE_DRAFT_REFINEMENT: '1',
    GOODBRIEF_VALIDATION_NOW: '2026-03-08T10:00:00.000Z',
    GEMINI_API_KEY: 'test-key',
  };

  seedRawWeek(tempRoot, weekId);

  await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'generate-draft.ts'),
    [],
    sharedEnv
  );

  await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'validate-draft-freshness.ts'),
    ['--week', weekId],
    sharedEnv
  );

  await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'notify-draft.ts'),
    ['--week', weekId, '--dry-run', '--output', proofOutputPath],
    sharedEnv
  );

  assert.equal(existsSync(draftPath), true);
  assert.equal(existsSync(proofOutputPath), true);

  const draft = JSON.parse(readFileSync(draftPath, 'utf-8'));
  const proofHtml = readFileSync(proofOutputPath, 'utf-8');

  assert.equal(draft.validation.status, 'passed');
  assert.equal(draft.validation.approvalSource, 'validation-pipeline');
  assert.deepEqual(draft.validation.replacements, [
    {
      removedArticleId: 'raw-neurodiverse-services',
      replacementArticleId: 'raw-school-orchestra',
    },
  ]);
  assert.equal(
    draft.selected.some((article: { id: string }) => article.id === 'raw-school-orchestra'),
    true
  );
  assert.equal(
    draft.selected.some((article: { id: string }) => article.id === 'raw-neurodiverse-services'),
    false
  );
  assert.match(proofHtml, /festival european/);
  assert.doesNotMatch(proofHtml, /neurodivergenți/);
});
