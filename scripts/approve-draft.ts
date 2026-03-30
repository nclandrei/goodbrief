#!/usr/bin/env npx tsx

/**
 * Manually approve a draft after editor review (e.g. reshuffling articles).
 * Sets validation.status = 'passed' with approvalSource = 'editor-review'
 * so the Monday send workflow accepts it.
 *
 * Usage: npm run approve-draft -- --week 2026-W13
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveProjectRoot } from './lib/project-root.js';
import type { NewsletterDraft } from './types.js';

const MIN_SELECTED_ARTICLES = 8;

function parseArgs(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--week' && args[i + 1]) {
      return args[i + 1];
    }
  }
  throw new Error('Missing required --week argument (e.g. --week 2026-W13)');
}

function main(): void {
  const rootDir = resolveProjectRoot(import.meta.url);
  const weekId = parseArgs();
  const draftPath = join(rootDir, 'data', 'drafts', `${weekId}.json`);

  if (!existsSync(draftPath)) {
    throw new Error(`Draft not found at ${draftPath}`);
  }

  const draft: NewsletterDraft = JSON.parse(readFileSync(draftPath, 'utf-8'));

  if (draft.selected.length < MIN_SELECTED_ARTICLES) {
    throw new Error(
      `Draft has only ${draft.selected.length} selected articles (minimum ${MIN_SELECTED_ARTICLES}). Add more articles before approving.`
    );
  }

  const now = new Date().toISOString();

  draft.validation = {
    ...draft.validation,
    generatedAt: draft.validation?.generatedAt || now,
    candidateCount: draft.validation?.candidateCount || draft.selected.length + (draft.reserves?.length || 0),
    flagged: draft.validation?.flagged || [],
    status: 'passed',
    approvalSource: 'editor-review',
    checkedAt: now,
  };

  writeFileSync(draftPath, JSON.stringify(draft, null, 2) + '\n');

  console.log(`Draft ${weekId} approved (editor-review).`);
  console.log(`  Selected articles: ${draft.selected.length}`);
  console.log(`  Reserves: ${draft.reserves?.length || 0}`);
  console.log(`  Approved at: ${now}`);
  console.log('\nRemember to commit and push this change.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
