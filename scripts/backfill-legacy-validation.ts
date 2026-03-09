#!/usr/bin/env npx tsx

import 'dotenv/config';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { upsertIssueValidationFrontmatter } from './lib/issue-frontmatter.js';
import {
  compareWeekIds,
  LEGACY_VALIDATION_CUTOFF_WEEK,
} from './lib/newsletter-week.js';
import { resolveProjectRoot } from './lib/project-root.js';
import type { NewsletterDraft } from './types.js';

interface CliArgs {
  throughWeek: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let throughWeek = LEGACY_VALIDATION_CUTOFF_WEEK;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--through-week' && args[i + 1]) {
      throughWeek = args[i + 1];
      i += 1;
    }
  }

  if (compareWeekIds(throughWeek, LEGACY_VALIDATION_CUTOFF_WEEK) > 0) {
    throw new Error(
      `Legacy backfill stops at ${LEGACY_VALIDATION_CUTOFF_WEEK}. Refusing ${throughWeek}.`
    );
  }

  return { throughWeek };
}

function resolveTimestamp(): string {
  return process.env.GOODBRIEF_LEGACY_VALIDATED_AT || new Date().toISOString();
}

function updateDraft(
  draftPath: string,
  validatedAt: string
): { weekId: string; changed: boolean } {
  const draft = JSON.parse(readFileSync(draftPath, 'utf-8')) as NewsletterDraft;
  const nextDraft: NewsletterDraft = {
    ...draft,
    validation: {
      generatedAt: draft.generatedAt,
      candidateCount: draft.selected.length + draft.reserves.length,
      flagged: draft.validation?.flagged || [],
      status: 'passed',
      approvalSource: 'legacy-backfill',
      checkedAt: validatedAt,
      blockedArticles: [],
      replacements: [],
      agentReviewed: [],
    },
  };
  const previousContent = JSON.stringify(draft, null, 2);
  const nextContent = JSON.stringify(nextDraft, null, 2);

  if (previousContent !== nextContent) {
    writeFileSync(draftPath, `${nextContent}\n`, 'utf-8');
  }

  return {
    weekId: draft.weekId,
    changed: previousContent !== nextContent,
  };
}

function main(): void {
  const { throughWeek } = parseArgs();
  const validatedAt = resolveTimestamp();
  const rootDir = resolveProjectRoot(import.meta.url);
  const draftsDir = join(rootDir, 'data', 'drafts');
  const issuesDir = join(rootDir, 'content', 'issues');

  const draftFiles = readdirSync(draftsDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  let updatedDrafts = 0;

  for (const file of draftFiles) {
    const weekId = file.replace(/\.json$/, '');
    if (compareWeekIds(weekId, throughWeek) > 0) {
      continue;
    }

    const result = updateDraft(join(draftsDir, file), validatedAt);
    if (result.changed) {
      updatedDrafts += 1;
    }
  }

  const issueFiles = readdirSync(issuesDir)
    .filter((file) => file.endsWith('.md'))
    .sort();
  let updatedIssues = 0;

  for (const file of issueFiles) {
    const issuePath = join(issuesDir, file);
    const current = readFileSync(issuePath, 'utf-8');
    const next = upsertIssueValidationFrontmatter(current, {
      validated: true,
      validationSource: 'legacy-backfill',
      validatedAt,
    });

    if (current !== next) {
      writeFileSync(issuePath, next, 'utf-8');
      updatedIssues += 1;
    }
  }

  console.log(`Legacy validation backfill completed through ${throughWeek}.`);
  console.log(`Drafts updated: ${updatedDrafts}`);
  console.log(`Issues updated: ${updatedIssues}`);
  console.log(`Validated at: ${validatedAt}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
