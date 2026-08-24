#!/usr/bin/env npx tsx

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  assertDraftReadyForProduction,
  assertDraftValidated,
} from './lib/draft-delivery.js';
import { resolveProjectRoot } from './lib/project-root.js';
import type { NewsletterDraft } from './types.js';

interface CliArgs {
  weekId: string;
  action: string;
  production: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let weekId = '';
  let action = 'newsletter delivery';
  let production = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--week' && args[i + 1]) {
      weekId = args[i + 1];
      i += 1;
    } else if (arg === '--action' && args[i + 1]) {
      action = args[i + 1];
      i += 1;
    } else if (arg === '--production') {
      production = true;
    }
  }

  if (!weekId) {
    throw new Error('Missing required --week argument');
  }

  return { weekId, action, production };
}

function loadDraft(rootDir: string, weekId: string): NewsletterDraft {
  const draftPath = join(rootDir, 'data', 'drafts', `${weekId}.json`);
  if (!existsSync(draftPath)) {
    throw new Error(`Draft not found at ${draftPath}`);
  }

  return JSON.parse(readFileSync(draftPath, 'utf-8')) as NewsletterDraft;
}

function main(): void {
  const rootDir = resolveProjectRoot(import.meta.url);
  const { weekId, action, production } = parseArgs();
  const draft = loadDraft(rootDir, weekId);
  if (draft.weekId !== weekId) {
    throw new Error(
      `Draft identity mismatch: requested ${weekId}, but the file contains ${draft.weekId}.`
    );
  }

  if (production) {
    assertDraftReadyForProduction(draft, action);
    console.log(`Draft ${weekId} is editor-approved for ${action}.`);
  } else {
    assertDraftValidated(draft, action);
    console.log(`Draft ${weekId} is validated for ${action}.`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
