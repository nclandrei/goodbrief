import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GEMINI_MAX_ATTEMPTS,
  GeminiQuotaError,
  GeminiRetryExhaustedError,
  callWithRetry,
  isRetryableGeminiError,
} from '../scripts/lib/gemini.js';
import { LlmProviderError } from '../scripts/lib/llm/provider.js';

test('callWithRetry keeps retrying Gemini 503 high-demand errors past the legacy ceiling', async () => {
  let attempts = 0;
  const delays: number[] = [];

  const result = await callWithRetry(
    async () => {
      attempts++;
      if (attempts < 7) {
        throw new Error(
          '[GoogleGenerativeAI Error]: [503 Service Unavailable] This model is currently experiencing high demand. Please try again later.'
        );
      }
      return 'ok';
    },
    {
      maxAttempts: 7,
      initialDelayMs: 1,
      maxDelayMs: 1,
      random: () => 0.5,
      sleep: async (ms) => {
        delays.push(ms);
      },
    }
  );

  assert.equal(result, 'ok');
  assert.equal(attempts, 7);
  assert.deepEqual(delays, [1, 1, 1, 1, 1, 1]);
});

test('callWithRetry does not retry quota or auth errors', async () => {
  let attempts = 0;

  await assert.rejects(
    () =>
      callWithRetry(
        async () => {
          attempts++;
          throw new Error('[429 Resource exhausted] quota exceeded');
        },
        {
          maxAttempts: 7,
          initialDelayMs: 1,
          sleep: async () => {},
        }
      ),
    GeminiQuotaError
  );

  assert.equal(attempts, 1);
});

test('callWithRetry has a finite default retry budget and surfaces retryable provider error', async () => {
  let attempts = 0;
  const delays: number[] = [];

  await assert.rejects(
    () =>
      callWithRetry(
        async () => {
          attempts++;
          throw new Error('[503 Service Unavailable] high demand');
        },
        {
          initialDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0,
          sleep: async (ms) => {
            delays.push(ms);
          },
        }
      ),
    (error: unknown) =>
      error instanceof GeminiRetryExhaustedError &&
      error instanceof LlmProviderError &&
      error.provider === 'gemini' &&
      error.retryable &&
      /503|high demand/i.test(error.message)
  );

  assert.equal(attempts, DEFAULT_GEMINI_MAX_ATTEMPTS);
  assert.equal(delays.length, DEFAULT_GEMINI_MAX_ATTEMPTS - 1);
});

test('callWithRetry rejects invalid retry configuration before calling Gemini', async () => {
  let attempts = 0;

  await assert.rejects(
    () =>
      callWithRetry(
        async () => {
          attempts++;
          return 'unused';
        },
        { maxAttempts: Number.POSITIVE_INFINITY }
      ),
    /maxAttempts.*finite integer/i
  );

  assert.equal(attempts, 0);
});

test('isRetryableGeminiError classifies service and network failures as retryable', () => {
  assert.equal(
    isRetryableGeminiError(new Error('[503 Service Unavailable] high demand')),
    true
  );
  assert.equal(isRetryableGeminiError(new Error('fetch failed')), true);
  assert.equal(isRetryableGeminiError(new Error('ECONNRESET')), true);
  assert.equal(isRetryableGeminiError(new Error('invalid api key')), false);
});
