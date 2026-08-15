import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CreateEmailOptions,
  CreateEmailResponse,
  ErrorResponse,
} from 'resend';
import {
  ResendEmailDeliveryError,
  buildResendEmailIdempotencyKey,
  sendResendEmailWithRetry,
  type ResendEmailSend,
} from '../scripts/lib/resend-email.js';

const PAYLOAD: CreateEmailOptions = {
  from: 'Good Brief <buna@goodbrief.ro>',
  to: ['editor@example.com', 'wife@example.com'],
  subject: '[PROOF] Good Brief 2026-W33',
  html: '<p>Proof</p>',
};

function failure(
  error: ErrorResponse,
  headers: Record<string, string> | null = null
): CreateEmailResponse {
  return { data: null, error, headers };
}

function success(id = 'email-id'): CreateEmailResponse {
  return { data: { id }, error: null, headers: {} };
}

test('Resend retries use capped exponential backoff and one idempotency key', async () => {
  const responses = [
    failure({
      name: 'internal_server_error',
      statusCode: 503,
      message: 'unavailable',
    }),
    failure({
      name: 'application_error',
      statusCode: null,
      message: 'network reset',
    }),
    failure({
      name: 'application_error',
      statusCode: 502,
      message: 'bad gateway',
    }),
    failure({
      name: 'concurrent_idempotent_requests',
      statusCode: 409,
      message: 'still processing',
    }),
    success(),
  ];
  const delays: number[] = [];
  const keys: Array<string | undefined> = [];
  const send: ResendEmailSend = async (_payload, options) => {
    keys.push(options?.idempotencyKey);
    return responses.shift()!;
  };

  const result = await sendResendEmailWithRetry(send, PAYLOAD, {
    idempotencyKey: 'stable-key',
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 8000,
    jitterRatio: 0.2,
    random: () => 0.5,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(result.id, 'email-id');
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
  assert.deepEqual(keys, Array(5).fill('stable-key'));
});

test('Resend honors Retry-After when it is longer than exponential backoff', async () => {
  const delays: number[] = [];
  let attempt = 0;

  await sendResendEmailWithRetry(
    async () => {
      attempt += 1;
      return attempt === 1
        ? failure(
            {
              name: 'rate_limit_exceeded',
              statusCode: 429,
              message: 'slow down',
            },
            { 'retry-after': '3' }
          )
        : success();
    },
    PAYLOAD,
    {
      idempotencyKey: 'stable-key',
      initialDelayMs: 1000,
      jitterRatio: 0,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    }
  );

  assert.deepEqual(delays, [3000]);
});

test('Resend does not retry quota or validation errors', async () => {
  for (const error of [
    {
      name: 'daily_quota_exceeded',
      statusCode: 429,
      message: 'daily quota reached',
    },
    {
      name: 'validation_error',
      statusCode: 422,
      message: 'invalid recipient',
    },
  ] as ErrorResponse[]) {
    let attempts = 0;
    await assert.rejects(
      () =>
        sendResendEmailWithRetry(
          async () => {
            attempts += 1;
            return failure(error);
          },
          PAYLOAD,
          {
            idempotencyKey: 'stable-key',
            sleep: async () => {
              throw new Error('terminal failures must not sleep');
            },
          }
        ),
      ResendEmailDeliveryError
    );
    assert.equal(attempts, 1);
  }
});

test('Resend idempotency keys are stable for one proof and change with content', () => {
  const first = buildResendEmailIdempotencyKey('proof-2026-W33', PAYLOAD);
  const second = buildResendEmailIdempotencyKey('proof-2026-W33', {
    ...PAYLOAD,
  });
  const changed = buildResendEmailIdempotencyKey('proof-2026-W33', {
    ...PAYLOAD,
    html: '<p>Corrected proof</p>',
  });

  assert.equal(second, first);
  assert.notEqual(changed, first);
  assert.match(first, /^goodbrief-proof-2026-w33-[a-f0-9]{64}$/);
});
