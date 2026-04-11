#!/usr/bin/env npx tsx
/**
 * Orchestrator that runs the full draft pipeline for a given week in a
 * single process. Designed for local recovery when the Gemini quota is
 * exhausted: invoke with `--llm claude-cli` and Claude Code will handle
 * every LLM-using phase without an Anthropic API key.
 *
 * Example:
 *   npm run pipeline:run-all -- --week 2026-W15 --llm claude-cli
 *   npm run pipeline:run-all -- --week 2026-W15 --llm gemini --fallback claude-cli
 */

import 'dotenv/config';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
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
import type { DraftPipelinePhase } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = getRootDir(__dirname);

const ALL_PHASES: DraftPipelinePhase[] = [
  'prepare',
  'score',
  'semantic-dedup',
  'counter-signal-validate',
  'select',
  'wrapper-copy',
  'refine',
];

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function flagValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) {
      return args[i + 1];
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const weekId = resolveWeekId(args);
  const skipExisting = hasFlag(args, '--skip-existing');
  const onlyFrom = flagValue(args, '--from');

  const spec = resolveProviderSpecFromArgs(args);
  // `prepare` and `select` don't need an LLM, but we still build the provider
  // up front so any config errors are caught before phase 1.
  const llm = createLlmProvider(spec);

  console.log(`\n=== Good Brief pipeline: ${weekId} ===`);
  console.log(
    `Provider: ${spec.provider}${spec.fallback ? ` → fallback: ${spec.fallback}` : ''}`
  );
  if (skipExisting) console.log('Mode: skip-existing (resume)');
  if (onlyFrom) console.log(`Starting from phase: ${onlyFrom}`);
  console.log();

  let started = !onlyFrom;

  for (const phase of ALL_PHASES) {
    if (!started) {
      if (phase === onlyFrom) {
        started = true;
      } else {
        console.log(`→ Skipping ${phase} (before --from ${onlyFrom})`);
        continue;
      }
    }

    if (skipExisting) {
      const artifactPath = getPipelineArtifactPath(ROOT_DIR, weekId, phase);
      if (existsSync(artifactPath)) {
        console.log(`✓ ${phase} already exists, skipping`);
        continue;
      }
    }

    const start = Date.now();
    console.log(`\n▶ ${phase}`);
    try {
      switch (phase) {
        case 'prepare':
          await runPreparePhase(ROOT_DIR, weekId);
          break;
        case 'score':
          await runScorePhase(ROOT_DIR, weekId, llm);
          break;
        case 'semantic-dedup':
          await runSemanticDedupPhase(ROOT_DIR, weekId, llm);
          break;
        case 'counter-signal-validate':
          await runCounterSignalValidatePhase({
            rootDir: ROOT_DIR,
            weekId,
            llm,
          });
          break;
        case 'select':
          await runSelectPhase(ROOT_DIR, weekId);
          break;
        case 'wrapper-copy':
          await runWrapperCopyPhase(ROOT_DIR, weekId, llm);
          break;
        case 'refine':
          await runRefinePhase(ROOT_DIR, weekId, llm);
          break;
      }
    } catch (error) {
      console.error(`\n✗ ${phase} failed:`, error);
      process.exit(1);
    }
    console.log(`✓ ${phase} done in ${Math.round((Date.now() - start) / 1000)}s`);
  }

  console.log(`\n=== Pipeline complete for ${weekId} ===`);
  console.log(`Draft: data/drafts/${weekId}.json`);
  console.log('Next: npm run validate-draft -- --week', weekId);
  console.log('      npm run publish-issue -- --week', weekId);
}

main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(1);
});
