#!/usr/bin/env npx tsx

import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { DraftPipelinePhase } from './types.js';
import type { CounterSignalClassifier } from './lib/counter-signal-validation.js';
import {
  runCounterSignalValidatePhase,
  runPreparePhase,
  runRefinePhase,
  runScorePhase,
  runSelectPhase,
  runSemanticDedupPhase,
  runWrapperCopyPhase,
} from './lib/draft-pipeline.js';
import {
  getPipelineArtifactPath,
  getRootDir,
  resolveWeekId,
} from './lib/pipeline-artifacts.js';
import {
  createLlmProvider,
  resolveProviderSpecFromArgs,
} from './lib/llm/factory.js';
import type { LlmProvider } from './lib/llm/provider.js';

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

  return async ({ candidate }: Parameters<CounterSignalClassifier>[0]) => {
    const entry = mockConfig[candidate.id];
    return {
      verdict: entry?.verdict || 'none',
      reason: entry?.reason || 'Fără semnale relevante.',
      relatedArticleIds: entry?.relatedArticleIds || [],
    };
  };
}

function parsePhase(args: string[]): DraftPipelinePhase {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phase' && args[i + 1]) {
      return args[i + 1] as DraftPipelinePhase;
    }
  }
  throw new Error('Missing required --phase argument');
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function resolveLlm(args: string[], phase: DraftPipelinePhase): LlmProvider | null {
  // Phases that don't touch the LLM don't need a provider.
  if (phase === 'prepare' || phase === 'select') {
    return null;
  }

  const spec = resolveProviderSpecFromArgs(args);
  const provider = createLlmProvider(spec);
  console.log(
    `[llm] phase=${phase} provider=${spec.provider}${spec.fallback ? ` (fallback=${spec.fallback})` : ''}`
  );
  return provider;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const phase = parsePhase(args);
  const weekId = resolveWeekId(args);
  const skipExisting = hasFlag(args, '--skip-existing');

  if (skipExisting) {
    const artifactPath = getPipelineArtifactPath(ROOT_DIR, weekId, phase);
    if (existsSync(artifactPath)) {
      console.log(`Phase "${phase}" artifact already exists at ${artifactPath}, skipping.`);
      return;
    }
  }

  const mockClassifier = loadMockClassifier();
  const llm = resolveLlm(args, phase);

  switch (phase) {
    case 'prepare':
      await runPreparePhase(ROOT_DIR, weekId);
      break;
    case 'score':
      await runScorePhase(ROOT_DIR, weekId, llm!);
      break;
    case 'semantic-dedup':
      await runSemanticDedupPhase(ROOT_DIR, weekId, llm!);
      break;
    case 'counter-signal-validate':
      await runCounterSignalValidatePhase({
        rootDir: ROOT_DIR,
        weekId,
        llm: llm!,
        classifier: mockClassifier,
      });
      break;
    case 'select':
      await runSelectPhase(ROOT_DIR, weekId);
      break;
    case 'wrapper-copy':
      await runWrapperCopyPhase(ROOT_DIR, weekId, llm!);
      break;
    case 'refine':
      await runRefinePhase(ROOT_DIR, weekId, llm!);
      break;
    default:
      throw new Error(`Unsupported phase: ${phase}`);
  }
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
