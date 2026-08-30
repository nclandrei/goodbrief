#!/usr/bin/env npx tsx

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { sendAlert } from './lib/alert.js';

export interface WorkflowFailureArgs {
  workflow: string;
  runUrl: string;
  weekId?: string;
  artifactName?: string;
  resumeCommand?: string;
}

export function parseArgs(args = process.argv.slice(2)): WorkflowFailureArgs {
  let workflow = '';
  let runUrl = '';
  let weekId: string | undefined;
  let artifactName: string | undefined;
  let resumeCommand: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workflow' && args[i + 1]) {
      workflow = args[i + 1];
      i++;
    } else if (args[i] === '--run-url' && args[i + 1]) {
      runUrl = args[i + 1];
      i++;
    } else if (args[i] === '--week' && args[i + 1]) {
      weekId = args[i + 1];
      i++;
    } else if (args[i] === '--artifact-name' && args[i + 1]) {
      artifactName = args[i + 1];
      i++;
    } else if (args[i] === '--resume-command' && args[i + 1]) {
      resumeCommand = args[i + 1];
      i++;
    }
  }

  return { workflow, runUrl, weekId, artifactName, resumeCommand };
}

export function buildWorkflowFailureAlert({
  workflow,
  runUrl,
  weekId,
  artifactName,
  resumeCommand,
}: WorkflowFailureArgs) {
  const recoveryDetails = [
    weekId ? `Săptămână: ${weekId}` : '',
    artifactName ? `Artefact de reluare: ${artifactName}` : '',
    resumeCommand ? `Comandă de reluare: ${resumeCommand}` : '',
  ].filter(Boolean);

  return {
    title: `Workflow-ul ${workflow} a eșuat`,
    weekId,
    reason: 'Workflow-ul GitHub Actions s-a oprit înainte să termine',
    details: recoveryDetails.length > 0 ? recoveryDetails.join('\n') : undefined,
    workflowRunUrl: runUrl,
    actionItems: [
      'Deschide imediat logurile rulării și identifică prima comandă care a eșuat.',
      'Rulează imediat workflow-ul din nou din GitHub Actions după ce confirmi cauza.',
      resumeCommand
        ? 'Folosește comanda de reluare din secțiunea „Detalii” pentru a păstra rezultatele fazelor deja reușite.'
        : 'Dacă există un artefact de diagnostic, reia workflow-ul din ultima fază reușită.',
      'Dacă reluarea eșuează din nou, deschide un incident și investighează cauza înainte de următoarea livrare.',
    ],
  };
}

async function main() {
  const args = parseArgs();
  const { workflow } = args;

  if (!workflow) {
    console.error('Error: --workflow argument is required');
    process.exit(1);
  }

  console.log(`Sending workflow failure alert for: ${workflow}`);

  const sent = await sendAlert(buildWorkflowFailureAlert(args));

  if (!sent) {
    throw new Error(
      'The workflow failed and the Resend alert could not be delivered.'
    );
  }

  console.log('✓ Alert sent');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Failed to send alert:', error);
    // The workflow already failed. A non-zero exit lets the independent GitHub
    // incident fallback know that email alerting also failed.
    process.exit(1);
  });
}
