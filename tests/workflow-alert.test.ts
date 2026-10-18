import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';
import {
  buildWorkflowFailureAlert,
  parseArgs,
} from '../scripts/alert-workflow-failure.js';

test('workflow failure alert includes immediate recovery context when supplied', () => {
  const args = parseArgs([
    '--workflow',
    'Ingest News',
    '--run-url',
    'https://github.com/example/run/123',
    '--week',
    '2026-W35',
    '--artifact-name',
    'ingest-diagnostics-2026-W35-1',
    '--resume-command',
    'npm run ingest-news',
  ]);
  const alert = buildWorkflowFailureAlert(args);

  assert.equal(alert.weekId, '2026-W35');
  assert.match(alert.details ?? '', /ingest-diagnostics-2026-W35-1/);
  assert.match(alert.details ?? '', /npm run ingest-news/);
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

test('workflow failure alert no longer advises waiting for a weekly retry', () => {
  const alert = buildWorkflowFailureAlert({
    workflow: 'Ingest News',
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
