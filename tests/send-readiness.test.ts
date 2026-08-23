import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewsletterDraft } from '../scripts/types.js';
import {
  assertDraftValidated,
  lockDraftForDelivery,
  recordDraftTestDelivery,
} from '../scripts/lib/draft-delivery.js';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';

function makeSelectedArticles(count: number): NewsletterDraft['selected'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `story-${index}`,
    sourceId: 'source',
    sourceName: 'Source',
    originalTitle: `Story ${index}`,
    url: `https://example.com/story-${index}`,
    summary: `Summary ${index}`,
    positivity: 80,
    impact: 70,
    category: 'wins' as const,
    publishedAt: '2026-03-12T10:00:00.000Z',
    processedAt: '2026-03-14T10:00:00.000Z',
  }));
}

test('post-W10 drafts require validation-pipeline approval', () => {
  const invalidFutureDraft: NewsletterDraft = {
    weekId: '2026-W11',
    generatedAt: '2026-03-14T10:00:00.000Z',
    selected: makeSelectedArticles(7),
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
    selected: makeSelectedArticles(7),
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

test('post-W10 drafts cannot be delivered below the 7-article safety minimum', () => {
  const tooShortDraft: NewsletterDraft = {
    weekId: '2026-W11',
    generatedAt: '2026-03-14T10:00:00.000Z',
    selected: makeSelectedArticles(6),
    reserves: [],
    discarded: 0,
    totalProcessed: 6,
    validation: {
      generatedAt: '2026-03-14T10:00:00.000Z',
      candidateCount: 6,
      flagged: [],
      status: 'passed',
      approvalSource: 'editor-review',
      checkedAt: '2026-03-14T11:00:00.000Z',
    },
  };

  assert.throws(
    () => assertDraftValidated(tooShortDraft, 'newsletter delivery'),
    /minimum 7 articles/
  );
});

function makeLockedDraft(): NewsletterDraft {
  return {
    weekId: '2026-W34',
    generatedAt: '2026-08-22T10:00:00.000Z',
    selected: makeSelectedArticles(8),
    reserves: [],
    discarded: 0,
    totalProcessed: 8,
    wrapperCopy: {
      greeting: 'Bună dimineața!',
      intro: 'Opt vești bune din România.',
      signOff: 'Pe curând.',
      shortSummary: 'Opt vești bune.',
    },
    validation: {
      generatedAt: '2026-08-22T10:00:00.000Z',
      candidateCount: 8,
      flagged: [],
      status: 'passed',
      approvalSource: 'editor-review',
      checkedAt: '2026-08-23T07:22:49.881Z',
    },
  };
}

test('W34+ delivery approval is bound to the rendered newsletter', () => {
  const draft = makeLockedDraft();
  lockDraftForDelivery(draft, '2026-08-23T07:22:49.881Z');

  assert.doesNotThrow(() =>
    assertDraftValidated(draft, 'newsletter delivery')
  );

  draft.selected[0].summary = 'A changed summary after approval.';

  assert.throws(
    () => assertDraftValidated(draft, 'newsletter delivery'),
    /changed after its delivery approval/
  );
});

test('W34+ delivery fails closed without stored wrapper copy or a content lock', () => {
  const missingLock = makeLockedDraft();
  assert.throws(
    () => assertDraftValidated(missingLock, 'newsletter delivery'),
    /missing its approved delivery content lock/
  );

  const missingWrapper = makeLockedDraft();
  missingWrapper.wrapperCopy = undefined;
  assert.throws(
    () => lockDraftForDelivery(missingWrapper, '2026-08-23T07:22:49.881Z'),
    /stored wrapper copy/
  );
});

test('reapproval clears a stale test record after newsletter content changes', () => {
  const draft = makeLockedDraft();
  lockDraftForDelivery(draft, '2026-08-23T07:22:49.881Z');
  recordDraftTestDelivery(
    draft,
    '2026-08-23T07:25:35.013Z',
    'test-message-id'
  );
  assert.equal(draft.deliveryLock?.testMessageId, 'test-message-id');

  draft.wrapperCopy!.intro = 'A newly approved intro.';
  lockDraftForDelivery(draft, '2026-08-23T08:00:00.000Z');

  assert.equal(draft.deliveryLock?.testedSha256, undefined);
  assert.equal(draft.deliveryLock?.testMessageId, undefined);
});

test('scheduled Monday delivery resolves the previous ISO week instead of the latest draft', () => {
  const workflow = readFileSync(
    join(WORKSPACE_ROOT, '.github', 'workflows', 'send-newsletter.yml'),
    'utf-8'
  );

  assert.match(workflow, /date -u (?:--date|-d) ['"]7 days ago['"] \+%G-W%V/);
  assert.doesNotMatch(workflow, /LATEST_DRAFT/);
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
