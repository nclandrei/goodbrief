import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

test('proof delivery retries a transient Resend failure with one idempotency key', async () => {
  const idempotencyKeys: Array<string | undefined> = [];
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    idempotencyKeys.push(
      Array.isArray(request.headers['idempotency-key'])
        ? request.headers['idempotency-key'][0]
        : request.headers['idempotency-key']
    );

    response.setHeader('content-type', 'application/json');
    if (requestCount === 1) {
      response.statusCode = 503;
      response.end(
        JSON.stringify({
          name: 'internal_server_error',
          statusCode: 503,
          message: 'Temporary provider outage',
        })
      );
      return;
    }

    response.statusCode = 200;
    response.end(JSON.stringify({ id: 'proof-email-id' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const result = await execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(ROOT_DIR, 'scripts', 'notify-draft.ts'),
        '--week',
        '2026-W32',
      ],
      {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          RESEND_API_KEY: 're_test_key',
          RESEND_BASE_URL: `http://127.0.0.1:${address.port}`,
          RESEND_RETRY_INITIAL_DELAY_MS: '0',
          TEST_EMAIL: 'editor@example.com,wife@example.com',
        },
      }
    );

    assert.equal(requestCount, 2);
    assert.ok(idempotencyKeys[0]);
    assert.equal(idempotencyKeys[1], idempotencyKeys[0]);
    assert.match(result.stdout, /proof-email-id/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
