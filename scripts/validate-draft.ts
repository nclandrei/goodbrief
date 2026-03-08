#!/usr/bin/env npx tsx

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { refreshDraftValidation } from './lib/draft-pipeline.js';
import { type CounterSignalClassifier } from './lib/counter-signal-validation.js';
import {
  getRootDir,
  resolveDraftWeekId,
  requireGeminiApiKey,
} from './lib/pipeline-artifacts.js';
import { GeminiQuotaError } from './lib/gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = getRootDir(__dirname);

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
  const weekId = resolveDraftWeekId(ROOT_DIR, process.argv.slice(2));
  const mockClassifier = loadMockClassifier();

  console.log(`Re-validating draft candidates for ${weekId}...`);

  try {
    const validation = await refreshDraftValidation({
      rootDir: ROOT_DIR,
      weekId,
      apiKey: requireGeminiApiKey(),
      classifier: mockClassifier,
    });

    const strongFlags = validation.flagged.filter((flag) => flag.verdict === 'strong').length;
    const borderlineFlags = validation.flagged.filter(
      (flag) => flag.verdict === 'borderline'
    ).length;

    console.log(
      `✓ Validation updated: ${validation.flagged.length} flagged (${strongFlags} strong, ${borderlineFlags} borderline)`
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
