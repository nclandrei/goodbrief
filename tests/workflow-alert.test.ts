import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';

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
