import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';
import {
  buildWorkflowFailureAlert,
  parseArgs,
} from '../scripts/alert-workflow-failure.js';

test('workflow failure alert includes immediate recovery context when supplied', () => {
  const args = parseArgs([
    '--workflow',
    'Generate Newsletter',
    '--run-url',
    'https://github.com/example/run/123',
    '--week',
    '2026-W35',
    '--artifact-name',
    'pipeline-diagnostics-2026-W35-1',
    '--resume-command',
    'npm run recover-week -- --week 2026-W35 --run-id 123',
  ]);
  const alert = buildWorkflowFailureAlert(args);

  assert.equal(alert.weekId, '2026-W35');
  assert.match(alert.details ?? '', /pipeline-diagnostics-2026-W35-1/);
  assert.match(alert.details ?? '', /npm run recover-week/);
  assert.ok(
    alert.actionItems.some((item) => item.includes('imediat')),
    'the alert should direct an immediate recovery action'
  );
  assert.ok(
    alert.actionItems.some((item) => item.includes('comanda de reluare')),
    'the alert should explain how to use the resume command'
  );
  assert.match(alert.title, /a eșuat/);
  assert.match(alert.reason, /s-a oprit/);
});

test('generation workflow supplies resume context and has an incident fallback', () => {
  const workflow = readFileSync(
    join(WORKSPACE_ROOT, '.github', 'workflows', 'generate-newsletter.yml'),
    'utf-8'
  );

  assert.match(workflow, /--artifact-name/);
  assert.match(workflow, /--resume-command/);
  assert.match(workflow, /id: failure_email/);
  assert.match(workflow, /steps\.failure_email\.outcome == 'failure'/);
  assert.match(workflow, /uses: actions\/github-script@v7/);
  assert.match(workflow, /issues: write/);
});

test('workflow failure alert no longer advises waiting for a weekly retry', () => {
  const alert = buildWorkflowFailureAlert({
    workflow: 'Generate Newsletter',
    runUrl: 'https://github.com/example/run/123',
  });

  assert.doesNotMatch(
    alert.actionItems.join(' '),
    /wait for the next scheduled run|așteaptă următoarea rulare/i
  );
});

test('workflow alert exits nonzero when Resend cannot deliver the alert', async () => {
  await assert.rejects(
    runTypeScriptScript(
      join(WORKSPACE_ROOT, 'scripts', 'alert-workflow-failure.ts'),
      ['--workflow', 'Test Workflow', '--run-url', 'https://example.com/run'],
      {
        RESEND_API_KEY: '',
        TEST_EMAIL: '',
      }
    ),
    /The workflow failed and the Resend alert could not be delivered/
  );
});
