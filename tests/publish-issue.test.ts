import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewsletterDraft } from '../scripts/types.js';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';

test('publish-issue writes validation metadata for future issues', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-publish-issue-'));
  mkdirSync(join(tempRoot, 'data', 'drafts'), { recursive: true });
  mkdirSync(join(tempRoot, 'content', 'issues'), { recursive: true });

  const draft: NewsletterDraft = {
    weekId: '2026-W11',
    generatedAt: '2026-03-14T10:00:00.000Z',
    selected: [
      {
        id: 'future-1',
        sourceId: 'source',
        sourceName: 'Source',
        originalTitle: 'Future story',
        url: 'https://example.com/future-story',
        summary: 'Future summary',
        positivity: 90,
        impact: 85,
        category: 'wins',
        publishedAt: '2026-03-12T10:00:00.000Z',
        processedAt: '2026-03-14T10:00:00.000Z',
      },
    ],
    reserves: [],
    discarded: 0,
    totalProcessed: 1,
    wrapperCopy: {
      greeting: 'Salut!',
      intro: 'Intro',
      signOff: 'Pa!',
      shortSummary: 'Rezumat viitor',
    },
    validation: {
      generatedAt: '2026-03-14T10:00:00.000Z',
      candidateCount: 1,
      flagged: [],
      status: 'passed',
      approvalSource: 'validation-pipeline',
      checkedAt: '2026-03-14T11:00:00.000Z',
      blockedArticles: [],
      replacements: [],
      agentReviewed: [],
    },
  };

  writeFileSync(
    join(tempRoot, 'data', 'drafts', '2026-W11.json'),
    JSON.stringify(draft, null, 2),
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

## 🏆 Wins
`,
    'utf-8'
  );

  await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'publish-issue.ts'),
    ['--week', '2026-W11'],
    {
      GOODBRIEF_ROOT_DIR: tempRoot,
    }
  );

  const issueFiles = readdirSync(join(tempRoot, 'content', 'issues')).sort();
  assert.deepEqual(issueFiles, ['2026-03-09-issue.md', '2026-03-16-issue.md']);

  const futureIssue = readFileSync(
    join(tempRoot, 'content', 'issues', '2026-03-16-issue.md'),
    'utf-8'
  );

  assert.match(futureIssue, /validated: true/);
  assert.match(futureIssue, /validationSource: "validation-pipeline"/);
  assert.match(futureIssue, /validatedAt: "2026-03-14T11:00:00.000Z"/);
});
