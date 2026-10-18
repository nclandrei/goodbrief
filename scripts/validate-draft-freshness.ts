#!/usr/bin/env npx tsx

import 'dotenv/config';
import { sendAlert } from './lib/alert.js';
import { runDraftFreshnessValidation } from './lib/draft-freshness-runner.js';
import { resolveProjectRoot } from './lib/project-root.js';

const ROOT_DIR = resolveProjectRoot(import.meta.url);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { weekId, result } = await runDraftFreshnessValidation({
    rootDir: ROOT_DIR,
    args,
  });

  console.log(`Deterministic freshness: ${result.status}`);
  console.log(`Planned read date: ${result.plannedReadDate}`);
  console.log(`Blocked articles: ${result.blockedArticles.length}`);
  console.log(`Selected stories passing deterministic checks: ${result.selectedFreshCount}`);
  console.log('Read-only: no copy, selection, source-review metadata or approval was changed.');
  console.log('Amp must still verify sources and event deadlines; this check does not approve delivery.');

  if (result.status !== 'passed') {
    await sendAlert({
      title: 'Draft archive validation failed',
      weekId,
      reason: 'The selected edition failed deterministic freshness checks',
      details: JSON.stringify(result, null, 2),
      actionItems: [
        'Review the blocked stories reported by the read-only freshness check',
        `Use Amp and scripts/assess-news.ts to reassess the raw pool for ${weekId} and revise the independent proof`,
        'Obtain editor approval of the exact final edition before running approve-draft',
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
