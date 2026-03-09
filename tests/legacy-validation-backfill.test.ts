import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewsletterDraft } from '../scripts/types.js';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';

test('legacy backfill updates drafts through W10 and annotates published issues', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-legacy-backfill-'));
  mkdirSync(join(tempRoot, 'data', 'drafts'), { recursive: true });
  mkdirSync(join(tempRoot, 'content', 'issues'), { recursive: true });

  const legacyDraft: NewsletterDraft = {
    weekId: '2026-W10',
    generatedAt: '2026-03-07T10:48:02.731Z',
    selected: [
      {
        id: 'legacy-1',
        sourceId: 'source',
        sourceName: 'Source',
        originalTitle: 'Legacy story',
        url: 'https://example.com/legacy-story',
        summary: 'Legacy summary',
        positivity: 90,
        impact: 80,
        category: 'wins',
        publishedAt: '2026-03-06T10:00:00.000Z',
        processedAt: '2026-03-07T10:48:02.731Z',
      },
    ],
    reserves: [],
    discarded: 0,
    totalProcessed: 1,
    wrapperCopy: {
      greeting: 'Salut!',
      intro: 'Intro',
      signOff: 'Pa!',
      shortSummary: 'Rezumat',
    },
  };
  const futureDraft: NewsletterDraft = {
    ...legacyDraft,
    weekId: '2026-W11',
  };

  writeFileSync(
    join(tempRoot, 'data', 'drafts', '2026-W10.json'),
    JSON.stringify(legacyDraft, null, 2),
    'utf-8'
  );
  writeFileSync(
    join(tempRoot, 'data', 'drafts', '2026-W11.json'),
    JSON.stringify(futureDraft, null, 2),
    'utf-8'
  );
  writeFileSync(
    join(tempRoot, 'content', 'issues', '2026-03-02-issue.md'),
    `---
title: "Good Brief #7 · 2 mar 2026"
date: 2026-03-02
summary: "Rezumat"
---

## 🏆 Wins

### Legacy story
Legacy summary

→ [Citește pe Source](https://example.com/legacy-story)
`,
    'utf-8'
  );

  await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'backfill-legacy-validation.ts'),
    [],
    {
      GOODBRIEF_ROOT_DIR: tempRoot,
      GOODBRIEF_LEGACY_VALIDATED_AT: '2026-03-09T13:30:00.000Z',
    }
  );

  const updatedLegacy = JSON.parse(
    readFileSync(join(tempRoot, 'data', 'drafts', '2026-W10.json'), 'utf-8')
  ) as NewsletterDraft;
  const untouchedFuture = JSON.parse(
    readFileSync(join(tempRoot, 'data', 'drafts', '2026-W11.json'), 'utf-8')
  ) as NewsletterDraft;
  const issueMarkdown = readFileSync(
    join(tempRoot, 'content', 'issues', '2026-03-02-issue.md'),
    'utf-8'
  );

  assert.equal(updatedLegacy.validation?.status, 'passed');
  assert.equal(updatedLegacy.validation?.approvalSource, 'legacy-backfill');
  assert.equal(updatedLegacy.validation?.checkedAt, '2026-03-09T13:30:00.000Z');
  assert.equal(updatedLegacy.validation?.generatedAt, legacyDraft.generatedAt);
  assert.equal(updatedLegacy.validation?.candidateCount, 1);
  assert.deepEqual(updatedLegacy.validation?.flagged, []);
  assert.deepEqual(updatedLegacy.validation?.blockedArticles, []);
  assert.deepEqual(updatedLegacy.validation?.replacements, []);
  assert.deepEqual(updatedLegacy.validation?.agentReviewed, []);
  assert.equal(untouchedFuture.validation, undefined);
  assert.match(issueMarkdown, /validated: true/);
  assert.match(issueMarkdown, /validationSource: "legacy-backfill"/);
  assert.match(issueMarkdown, /validatedAt: "2026-03-09T13:30:00.000Z"/);
});
