#!/usr/bin/env npx tsx

import 'dotenv/config';
import { sendAlert } from './lib/alert.js';

function parseArgs(): { workflow: string; runUrl: string } {
  const args = process.argv.slice(2);
  let workflow = '';
  let runUrl = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workflow' && args[i + 1]) {
      workflow = args[i + 1];
      i++;
    } else if (args[i] === '--run-url' && args[i + 1]) {
      runUrl = args[i + 1];
      i++;
    }
  }

  return { workflow, runUrl };
}

async function main() {
  const { workflow, runUrl } = parseArgs();

  if (!workflow) {
    console.error('Error: --workflow argument is required');
    process.exit(1);
  }

  console.log(`Sending workflow failure alert for: ${workflow}`);

  const sent = await sendAlert({
    title: `${workflow} workflow failed`,
    reason: 'The GitHub Actions workflow failed during execution',
    workflowRunUrl: runUrl,
    actionItems: [
      'Check the workflow logs for details on what failed',
      'Common causes: network issues, dependency problems, or git conflicts',
      'If this is the first failure, it may be transient - wait for the next scheduled run',
      'If failures persist, investigate and fix the underlying issue',
    ],
  });

  if (!sent) {
    throw new Error(
      'The workflow failed and the Resend alert could not be delivered.'
    );
  }

  console.log('✓ Alert sent');
}

main().catch((error) => {
  console.error('Failed to send alert:', error);
  // The workflow already failed. A non-zero exit lets the independent GitHub
  // incident fallback know that email alerting also failed.
  process.exit(1);
});
