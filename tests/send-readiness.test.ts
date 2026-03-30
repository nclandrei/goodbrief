import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewsletterDraft } from '../scripts/types.js';
import { assertDraftValidated } from '../scripts/lib/draft-delivery.js';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';

test('post-W10 drafts require validation-pipeline approval', () => {
  const invalidFutureDraft: NewsletterDraft = {
    weekId: '2026-W11',
    generatedAt: '2026-03-14T10:00:00.000Z',
    selected: [],
    reserves: [],
    discarded: 0,
    totalProcessed: 0,
    validation: {
      generatedAt: '2026-03-14T10:00:00.000Z',
      candidateCount: 0,
      flagged: [],
      status: 'passed',
      approvalSource: 'legacy-backfill',
      checkedAt: '2026-03-14T11:00:00.000Z',
      blockedArticles: [],
      replacements: [],
      agentReviewed: [],
    },
  };

  assert.throws(
    () => assertDraftValidated(invalidFutureDraft, 'newsletter delivery'),
    /validation-pipeline or editor-review approval/
  );
});

test('post-W10 drafts with editor-review approval pass validation', () => {
  const editorReviewedDraft: NewsletterDraft = {
    weekId: '2026-W11',
    generatedAt: '2026-03-14T10:00:00.000Z',
    selected: [],
    reserves: [],
    discarded: 0,
    totalProcessed: 0,
    validation: {
      generatedAt: '2026-03-14T10:00:00.000Z',
      candidateCount: 0,
      flagged: [],
      status: 'passed',
      approvalSource: 'editor-review',
      checkedAt: '2026-03-14T11:00:00.000Z',
      blockedArticles: [],
      replacements: [],
      agentReviewed: [],
    },
  };

  assert.doesNotThrow(
    () => assertDraftValidated(editorReviewedDraft, 'newsletter delivery')
  );
});

test('send preflight reports an existing issue so the workflow can skip duplicate sends', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-send-preflight-'));
  const outputPath = join(tempRoot, 'github-output.txt');
  mkdirSync(join(tempRoot, 'data', 'drafts'), { recursive: true });
  mkdirSync(join(tempRoot, 'content', 'issues'), { recursive: true });

  writeFileSync(
    join(tempRoot, 'data', 'drafts', '2026-W10.json'),
    JSON.stringify(
      {
        weekId: '2026-W10',
        generatedAt: '2026-03-07T10:48:02.731Z',
        selected: [],
        reserves: [],
        discarded: 0,
        totalProcessed: 0,
      },
      null,
      2
    ),
    'utf-8'
  );
  writeFileSync(
    join(tempRoot, 'content', 'issues', '2026-03-09-issue.md'),
    `---
title: "Good Brief #8 · 9 mar 2026"
date: 2026-03-09
summary: "Rezumat"
validated: true
validationSource: "legacy-backfill"
validatedAt: "2026-03-09T13:30:00.000Z"
---
`,
    'utf-8'
  );

  await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'check-send-preflight.ts'),
    ['--week', '2026-W10'],
    {
      GOODBRIEF_ROOT_DIR: tempRoot,
      GITHUB_OUTPUT: outputPath,
    }
  );

  const output = readFileSync(outputPath, 'utf-8');
  assert.match(output, /draft_exists=true/);
  assert.match(output, /issue_exists=true/);
  assert.match(output, /issue_filename=2026-03-09-issue\.md/);
});
