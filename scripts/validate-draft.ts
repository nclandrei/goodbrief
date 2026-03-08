#!/usr/bin/env npx tsx

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { NewsletterDraft, WeeklyBuffer } from './types.js';
import { deduplicateArticles } from './lib/deduplication.js';
import {
  type CounterSignalClassifier,
  filterValidationForArticles,
  validateSameWeekCounterSignals,
} from './lib/counter-signal-validation.js';
import { GeminiQuotaError } from './lib/gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = process.env.GOODBRIEF_ROOT_DIR || join(__dirname, '..');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

function parseArgs(): string | null {
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

  return files[0].replace('.json', '');
}

function loadMockClassifier(): CounterSignalClassifier | undefined {
  const mockPath = process.env.GOODBRIEF_COUNTER_SIGNAL_MOCK_FILE;
  if (!mockPath) {
    return undefined;
  }

  const mockConfig = JSON.parse(readFileSync(mockPath, 'utf-8')) as Record<
    string,
    {
      verdict?: 'none' | 'borderline' | 'strong';
      reason?: string;
      relatedArticleIds?: string[];
    }
  >;

  return async ({ candidate }) => {
    const entry = mockConfig[candidate.id];
    return {
      verdict: entry?.verdict || 'none',
      reason: entry?.reason || 'Fără semnale relevante.',
      relatedArticleIds: entry?.relatedArticleIds || [],
    };
  };
}

async function main(): Promise<void> {
  const draftsDir = join(ROOT_DIR, 'data', 'drafts');
  const weekId = parseArgs() || getLatestDraftWeekId(draftsDir);

  if (!weekId) {
    console.error('Error: No draft files found in data/drafts/');
    process.exit(1);
  }

  const draftPath = join(draftsDir, `${weekId}.json`);
  const rawPath = join(ROOT_DIR, 'data', 'raw', `${weekId}.json`);

  if (!existsSync(draftPath)) {
    console.error(`Error: Draft not found at ${draftPath}`);
    process.exit(1);
  }

  if (!existsSync(rawPath)) {
    console.error(`Error: Raw data not found at ${rawPath}`);
    process.exit(1);
  }

  const draft = JSON.parse(readFileSync(draftPath, 'utf-8')) as NewsletterDraft;
  const buffer = JSON.parse(readFileSync(rawPath, 'utf-8')) as WeeklyBuffer;

  const deduped = deduplicateArticles(buffer.articles);
  const shortlist = [...draft.selected, ...draft.reserves];
  const mockClassifier = loadMockClassifier();

  console.log(`Re-validating ${shortlist.length} draft candidates for ${weekId}...`);

  try {
    const fullValidation = await validateSameWeekCounterSignals({
      weekId,
      candidates: shortlist,
      rawArticles: deduped.outputArticles,
      apiKey: GEMINI_API_KEY,
      classifier: mockClassifier,
    });
    const draftValidation = filterValidationForArticles(fullValidation, shortlist);

    const updatedDraft: NewsletterDraft = {
      ...draft,
      validation: draftValidation,
    };

    writeFileSync(draftPath, JSON.stringify(updatedDraft, null, 2), 'utf-8');

    const strongFlags = draftValidation.flagged.filter(
      (flag) => flag.verdict === 'strong'
    ).length;
    const borderlineFlags = draftValidation.flagged.filter(
      (flag) => flag.verdict === 'borderline'
    ).length;

    console.log(
      `✓ Validation updated: ${draftValidation.flagged.length} flagged (${strongFlags} strong, ${borderlineFlags} borderline)`
    );
  } catch (error) {
    if (error instanceof GeminiQuotaError) {
      console.error(`Validation failed due to Gemini quota: ${error.message}`);
    } else {
      console.error('Validation failed:', error);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
