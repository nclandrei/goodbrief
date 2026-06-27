#!/usr/bin/env npx tsx

import 'dotenv/config';
import { sendAlert } from './lib/alert.js';
import { runDraftFreshnessValidation } from './lib/draft-freshness-runner.js';
import {
  createLlmProvider,
  resolveProviderSpecFromArgs,
} from './lib/llm/factory.js';
import type { LlmProvider } from './lib/llm/provider.js';
import { resolveProjectRoot } from './lib/project-root.js';

const ROOT_DIR = resolveProjectRoot(import.meta.url);

function hasExplicitLlmConfig(args: string[]): boolean {
  return (
    args.includes('--llm') ||
    args.includes('--fallback') ||
    Boolean(process.env.LLM_PROVIDER) ||
    Boolean(process.env.LLM_FALLBACK)
  );
}

function resolveOptionalLlm(args: string[]): LlmProvider | undefined {
  if (!hasExplicitLlmConfig(args)) {
    return undefined;
  }

  const spec = resolveProviderSpecFromArgs(args);
  const provider = createLlmProvider(spec);
  console.log(
    `[llm] freshness provider=${spec.provider}${spec.fallback ? ` (fallback=${spec.fallback})` : ''}`
  );
  return provider;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const llm = resolveOptionalLlm(args);
  const { weekId, result } = await runDraftFreshnessValidation({
    rootDir: ROOT_DIR,
    args,
    llm,
  });

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
