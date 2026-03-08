#!/usr/bin/env npx tsx

import 'dotenv/config';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sendAlert } from './lib/alert.js';
import { resolveProjectRoot } from './lib/project-root.js';
import { loadHistoricalArticles } from './lib/story-history.js';
import { validateDraftFreshness } from './lib/draft-validation.js';
import type { NewsletterDraft } from './types.js';

const ROOT_DIR = resolveProjectRoot(import.meta.url);
const RECENT_DRAFT_LOOKBACK = 4;

function parseWeekArg(): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--week' && args[i + 1]) {
      return args[i + 1];
    }
  }
  return null;
}

function getLatestDraftWeekId(draftsDir: string): string | null {
  const files = readdirSync(draftsDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  return files[0].replace(/\.json$/, '');
}

function loadDraft(weekId: string): NewsletterDraft {
  const draftPath = join(ROOT_DIR, 'data', 'drafts', `${weekId}.json`);
  if (!existsSync(draftPath)) {
    throw new Error(`Draft not found at ${draftPath}`);
  }

  return JSON.parse(readFileSync(draftPath, 'utf-8')) as NewsletterDraft;
}

async function main(): Promise<void> {
  const draftsDir = join(ROOT_DIR, 'data', 'drafts');
  const weekId = parseWeekArg() || getLatestDraftWeekId(draftsDir);

  if (!weekId) {
    throw new Error('No draft files found to validate');
  }

  console.log(`\n🛡️ Good Brief Draft Archive Gate`);
  console.log(`Week: ${weekId}\n`);

  const draft = loadDraft(weekId);
  console.log(`Loaded draft: ${draft.selected.length} selected, ${draft.reserves.length} reserves`);

  const history = loadHistoricalArticles({
    rootDir: ROOT_DIR,
    currentWeekId: weekId,
    draftLookback: RECENT_DRAFT_LOOKBACK,
  });

  console.log(
    `Loaded ${history.articles.length} historical stories (${history.issueArticleCount} published, ${history.draftArticleCount} recent draft)`
  );

  const result = await validateDraftFreshness({
    draft,
    historicalArticles: history.articles,
    recentDraftCount: history.draftArticleCount,
    publishedHistoryCount: history.issueArticleCount,
  });

  const draftPath = join(ROOT_DIR, 'data', 'drafts', `${weekId}.json`);
  writeFileSync(draftPath, JSON.stringify(result.draft, null, 2), 'utf-8');

  const blocked = result.draft.validation?.blockedArticles?.length ?? 0;
  const replacements = result.draft.validation?.replacements?.length ?? 0;
  const status = result.draft.validation?.status || 'failed';

  console.log(`Validation status: ${status}`);
  console.log(`Blocked articles: ${blocked}`);
  console.log(`Auto-replacements: ${replacements}`);
  console.log(`Remaining approved stories: ${result.approvedCount}`);

  if (status !== 'passed') {
    await sendAlert({
      title: 'Draft archive validation failed',
      weekId,
      reason: 'Not enough fresh stories remained after archive deduplication',
      details: JSON.stringify(result.draft.validation, null, 2),
      actionItems: [
        'Review blocked stories in the draft validation metadata',
        'Promote additional reserves manually or regenerate the draft with more source data',
        'Inspect recent editions for repeated topics that need stronger filtering',
      ],
    });

    process.exit(1);
  }
}

main().catch(async (error) => {
  await sendAlert({
    title: 'Draft archive validation crashed',
    reason: 'An unexpected error occurred during draft archive validation',
    details: error instanceof Error ? error.stack || error.message : String(error),
    actionItems: [
      'Check the GitHub Actions logs for more details',
      'Run `npm run validate-draft-freshness` locally to reproduce the issue',
      'Inspect the validator implementation in `scripts/validate-draft-freshness.ts`',
    ],
  });

  console.error('Fatal error:', error);
  process.exit(1);
});
