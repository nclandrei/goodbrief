import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenRouterProvider,
  buildOpenRouterRequestBody,
  parseOpenRouterResponse,
  parseFallbackModels,
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_FALLBACK_MODELS,
  DEFAULT_MAX_TOKENS,
  OPENROUTER_MAX_MODELS,
} from '../scripts/lib/llm/openrouter-provider.js';
import type { OpenRouterFetcher } from '../scripts/lib/llm/openrouter-provider.js';
import {
  LlmProviderError,
  LlmQuotaError,
  LlmTruncationError,
} from '../scripts/lib/llm/provider.js';
import type { ProcessedArticle, RawArticle } from '../scripts/types.js';

// ---------- fixtures ----------

const RAW: RawArticle = {
  id: 'raw-1',
  sourceId: 'src',
  sourceName: 'Src',
  title: 'Test title',
  url: 'https://example.com/1',
  summary: 'Some content about Romania',
  publishedAt: '2026-04-10T10:00:00Z',
  fetchedAt: '2026-04-10T11:00:00Z',
};

const PROCESSED: ProcessedArticle = {
  id: 'p-1',
  sourceId: 'src',
  sourceName: 'Src',
  originalTitle: 'Proc title',
  url: 'https://example.com/p',
  summary: 'Short Romanian summary',
  positivity: 80,
  impact: 70,
  category: 'wins',
  publishedAt: '2026-04-10T10:00:00Z',
  processedAt: '2026-04-10T12:00:00Z',
};

/** Build a chat completion envelope that mimics OpenRouter's response. */
function chatEnvelope(content: unknown): string {
  return JSON.stringify({
    id: 'gen-abc123',
    object: 'chat.completion',
    created: 1712345678,
    model: 'anthropic/claude-sonnet-4.5',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: typeof content === 'string' ? content : JSON.stringify(content),
          refusal: null,
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
}

function okResponse(body: string) {
  return { status: 200, body };
}

function errorResponse(status: number, message: string) {
  return {
    status,
    body: JSON.stringify({
      error: { code: status, message, metadata: null },
    }),
  };
}

function makeProvider(
  fakeFetcher: OpenRouterFetcher,
  overrides: {
    apiKey?: string;
    model?: string;
    referer?: string;
    title?: string;
    maxRetries?: number;
    retryDelayMs?: number;
    fallbackModels?: string[];
  } = {}
): OpenRouterProvider {
  return new OpenRouterProvider({
    apiKey: overrides.apiKey ?? 'test-or-key',
    model: overrides.model ?? 'anthropic/claude-sonnet-4.5',
    httpReferer: overrides.referer,
    appTitle: overrides.title,
    fetcher: fakeFetcher,
    maxRetries: overrides.maxRetries,
    // Keep the suite fast: never actually sleep between retries in tests.
    // Tests that exercise retry explicitly set `maxRetries` and let this
    // default kick in.
    retryDelayMs: overrides.retryDelayMs ?? 0,
    // Default to no fallbacks in tests so existing tests are unaffected.
    // Tests that exercise model fallback pass their own list.
    fallbackModels: overrides.fallbackModels ?? [],
  });
}

/** Mimics what the default fetcher throws when its AbortController fires. */
function makeAbortError(): Error {
  const err = new Error('This operation was aborted');
  err.name = 'AbortError';
  return err;
}

// ---------- request body builder ----------

test('buildOpenRouterRequestBody: serializes model, messages and json_schema response_format', () => {
  const body = buildOpenRouterRequestBody({
    model: 'anthropic/claude-sonnet-4.5',
    prompt: 'Hello world',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    schemaName: 'test_schema',
  });
  const parsed = JSON.parse(body);
  assert.equal(parsed.model, 'anthropic/claude-sonnet-4.5');
  assert.ok(Array.isArray(parsed.messages));
  assert.equal(parsed.messages[0].role, 'user');
  assert.equal(parsed.messages[0].content, 'Hello world');
  assert.equal(parsed.response_format.type, 'json_schema');
  assert.equal(parsed.response_format.json_schema.name, 'test_schema');
  assert.equal(parsed.response_format.json_schema.strict, false);
  assert.deepEqual(parsed.response_format.json_schema.schema, {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
  });
});

test('buildOpenRouterRequestBody: includes optional temperature + max_tokens', () => {
  const body = buildOpenRouterRequestBody({
    model: 'x/y',
    prompt: 'p',
    schema: {},
    schemaName: 's',
    temperature: 0.2,
    maxTokens: 1234,
  });
  const parsed = JSON.parse(body);
  assert.equal(parsed.temperature, 0.2);
  assert.equal(parsed.max_tokens, 1234);
});

// ---------- response parser ----------

test('parseOpenRouterResponse: extracts JSON from choices[0].message.content', () => {
  const body = chatEnvelope({ hello: 'world' });
  const parsed = parseOpenRouterResponse<{ hello: string }>(body);
  assert.deepEqual(parsed, { hello: 'world' });
});

test('parseOpenRouterResponse: tolerates code fences wrapping the JSON', () => {
  const body = chatEnvelope('```json\n{"hello":"fenced"}\n```');
  const parsed = parseOpenRouterResponse<{ hello: string }>(body);
  assert.deepEqual(parsed, { hello: 'fenced' });
});

test('parseOpenRouterResponse: throws LlmProviderError when choices array is empty', () => {
  const body = JSON.stringify({ id: 'x', object: 'chat.completion', choices: [] });
  assert.throws(
    () => parseOpenRouterResponse(body),
    (err: unknown) =>
      err instanceof LlmProviderError && !(err instanceof LlmQuotaError)
  );
});

test('parseOpenRouterResponse: surfaces error envelope as LlmProviderError', () => {
  const body = JSON.stringify({
    error: { code: 400, message: 'Bad schema', metadata: null },
  });
  assert.throws(
    () => parseOpenRouterResponse(body),
    (err: unknown) => err instanceof LlmProviderError
  );
});

// Repro for the 2026-W15 score-phase failure: HTTP 200 envelope but the
// individual choice carries an upstream `provider_unavailable` error and
// `message.content: null`. Surfacing it as a generic "content is empty" error
// hides the real cause, so the parser must report the choice-level error
// (and quota status codes still map to LlmQuotaError).
test('parseOpenRouterResponse: surfaces choice-level error inside HTTP-200 envelope as LlmProviderError', () => {
  const body = JSON.stringify({
    id: 'gen-x',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: null,
        error: {
          code: 502,
          message: 'Upstream error from OpenInference: Unknown role: assistantfinal',
          metadata: { error_type: 'provider_unavailable' },
        },
        message: { role: 'assistant', content: null, refusal: null },
      },
    ],
  });
  assert.throws(
    () => parseOpenRouterResponse(body),
    (err: unknown) => {
      if (!(err instanceof LlmProviderError)) return false;
      if (err instanceof LlmQuotaError) return false;
      return /upstream|provider_unavailable|502/i.test(err.message);
    }
  );
});

test('parseOpenRouterResponse: choice-level 429 maps to LlmQuotaError', () => {
  const body = JSON.stringify({
    choices: [
      {
        index: 0,
        error: { code: 429, message: 'Rate limit on upstream' },
        message: { role: 'assistant', content: null },
      },
    ],
  });
  assert.throws(
    () => parseOpenRouterResponse(body),
    (err: unknown) => err instanceof LlmQuotaError
  );
});

// ---------- scoreArticles ----------

test('scoreArticles: parses structured output and filters hallucinated IDs', async () => {
  const body = chatEnvelope([
    {
      id: 'raw-1',
      summary: 'rezumat',
      positivity: 85,
      impact: 70,
      feltImpact: 72,
      certainty: 80,
      humanCloseness: 60,
      bureaucraticDistance: 20,
      promoRisk: 10,
      romaniaRelevant: true,
      category: 'wins',
    },
    {
      id: 'hallucinated',
      summary: 'x',
      positivity: 50,
      impact: 50,
      romaniaRelevant: true,
      category: 'wins',
    },
  ]);

  const provider = makeProvider(async () => okResponse(body));
  const scores = await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.equal(scores.length, 1);
  assert.equal(scores[0].id, 'raw-1');
  assert.equal(scores[0].positivity, 85);
});

test('scoreArticles: POSTs to OpenRouter chat completions endpoint with Bearer auth', async () => {
  let capturedUrl = '';
  let capturedInit: {
    method: string;
    headers: Record<string, string>;
    body: string;
  } = { method: '', headers: {}, body: '' };

  const provider = makeProvider(
    async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return okResponse(chatEnvelope([]));
    },
    { apiKey: 'sk-or-v1-abc', referer: 'https://goodbrief.ro', title: 'Good Brief' }
  );

  await provider.scoreArticles([RAW], { includeReasoning: false });

  assert.equal(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(capturedInit.method, 'POST');
  assert.equal(capturedInit.headers['Authorization'], 'Bearer sk-or-v1-abc');
  assert.equal(capturedInit.headers['Content-Type'], 'application/json');
  assert.equal(capturedInit.headers['HTTP-Referer'], 'https://goodbrief.ro');
  assert.equal(capturedInit.headers['X-Title'], 'Good Brief');

  const parsed = JSON.parse(capturedInit.body);
  assert.equal(parsed.response_format.type, 'json_schema');
  assert.ok(parsed.messages[0].content.length > 0);
});

test('scoreArticles: returns [] without calling fetcher when batch is empty', async () => {
  let called = 0;
  const provider = makeProvider(async () => {
    called++;
    return okResponse(chatEnvelope([]));
  });
  const scores = await provider.scoreArticles([], { includeReasoning: false });
  assert.deepEqual(scores, []);
  assert.equal(called, 0);
});

// ---------- semanticDedup ----------

test('semanticDedup: short-circuits without calling fetcher when <2 articles', async () => {
  let called = 0;
  const provider = makeProvider(async () => {
    called++;
    return okResponse(chatEnvelope({}));
  });
  const result = await provider.semanticDedup('2026-W15', [PROCESSED]);
  assert.deepEqual(result, { groups: [] });
  assert.equal(called, 0);
});

test('semanticDedup: parses groups from response', async () => {
  const body = chatEnvelope({
    groups: [{ ids: ['p-1', 'p-2'], reason: 'Aceeași poveste' }],
  });
  const provider = makeProvider(async () => okResponse(body));
  const result = await provider.semanticDedup('2026-W15', [
    PROCESSED,
    { ...PROCESSED, id: 'p-2' },
  ]);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].ids, ['p-1', 'p-2']);
});

// ---------- classifyCounterSignal ----------

test('classifyCounterSignal: normalizes verdict and defaults missing reason', async () => {
  const body = chatEnvelope({
    verdict: 'mystery',
    reason: '',
    relatedArticleIds: ['x', 42, 'y'],
  });
  const provider = makeProvider(async () => okResponse(body));
  const result = await provider.classifyCounterSignal({
    weekId: '2026-W15',
    candidate: PROCESSED,
    relatedArticles: [RAW],
  });
  assert.equal(result.verdict, 'none');
  assert.ok(result.reason.length > 0);
  assert.deepEqual(result.relatedArticleIds, ['x', 'y']);
});

// ---------- generateWrapperCopy ----------

test('generateWrapperCopy: returns greeting/intro/signOff/shortSummary', async () => {
  const body = chatEnvelope({
    greeting: 'Bună dimineața!',
    intro: 'Intro romanesc.',
    signOff: 'Pe săptămâna viitoare!',
    shortSummary: 'Teaser pentru arhivă.',
  });
  const provider = makeProvider(async () => okResponse(body));
  const copy = await provider.generateWrapperCopy('2026-W15', [PROCESSED]);
  assert.equal(copy.greeting, 'Bună dimineața!');
  assert.equal(copy.intro, 'Intro romanesc.');
  assert.equal(copy.signOff, 'Pe săptămâna viitoare!');
  assert.equal(copy.shortSummary, 'Teaser pentru arhivă.');
});

test('generateWrapperCopy: throws LlmProviderError on missing required field', async () => {
  const body = chatEnvelope({ greeting: 'Hi', signOff: 'bye' }); // intro missing
  const provider = makeProvider(async () => okResponse(body));
  await assert.rejects(
    () => provider.generateWrapperCopy('2026-W15', [PROCESSED]),
    (err: unknown) => err instanceof LlmProviderError
  );
});

// ---------- refineDraft ----------

test('refineDraft: parses selectedIds + intro + shortSummary + reasoning', async () => {
  const body = chatEnvelope({
    selectedIds: ['p-1', 'p-2', 42, 'p-3'],
    intro: 'intro',
    shortSummary: 'short',
    reasoning: 'ok',
  });
  const provider = makeProvider(async () => okResponse(body));
  const refined = await provider.refineDraft({
    weekId: '2026-W15',
    prompt: 'refine prompt',
  });
  assert.deepEqual(refined.selectedIds, ['p-1', 'p-2', 'p-3']);
  assert.equal(refined.intro, 'intro');
  assert.equal(refined.shortSummary, 'short');
  assert.equal(refined.reasoning, 'ok');
});

// ---------- HTTP error mapping ----------

test('HTTP 429 surfaces as LlmQuotaError', async () => {
  const provider = makeProvider(async () => errorResponse(429, 'Rate limit exceeded'));
  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => err instanceof LlmQuotaError
  );
});

test('HTTP 402 (payment required / out of credits) surfaces as LlmQuotaError', async () => {
  const provider = makeProvider(async () => errorResponse(402, 'Insufficient credits'));
  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => err instanceof LlmQuotaError
  );
});

test('HTTP 401 (unauthorized) surfaces as LlmProviderError (not quota)', async () => {
  const provider = makeProvider(async () => errorResponse(401, 'Invalid api key'));
  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) =>
      err instanceof LlmProviderError && !(err instanceof LlmQuotaError)
  );
});

test('HTTP 500 (internal error) surfaces as LlmProviderError', async () => {
  const provider = makeProvider(async () => errorResponse(500, 'Internal error'));
  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) =>
      err instanceof LlmProviderError && !(err instanceof LlmQuotaError)
  );
});

test('Fetcher throwing "rate limit" error is mapped to LlmQuotaError', async () => {
  const provider = makeProvider(async () => {
    throw new Error('fetch failed: rate limit exceeded');
  });
  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => err instanceof LlmQuotaError
  );
});

test('Fetcher throwing ENOTFOUND is mapped to LlmProviderError (not quota)', async () => {
  const provider = makeProvider(async () => {
    throw new Error('ENOTFOUND openrouter.ai');
  });
  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) =>
      err instanceof LlmProviderError && !(err instanceof LlmQuotaError)
  );
});

// ---------- retry on transient failures ----------
//
// These tests pin the behavior that a single slow / hung request on a free-
// tier OpenRouter model must not kill the whole draft pipeline. The original
// bug reproduced on 2026-W15 when `openai/gpt-oss-120b:free` took longer
// than OPENROUTER_TIMEOUT_MS (180s), the AbortController fired, and the
// score phase exited with "This operation was aborted".

test('call retries on AbortError and succeeds on the second attempt', async () => {
  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      if (attempts === 1) {
        throw makeAbortError();
      }
      return okResponse(chatEnvelope([]));
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  const scores = await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.deepEqual(scores, []);
  assert.equal(attempts, 2, 'expected one retry after the initial AbortError');
});

test('call retries on generic network error ("fetch failed") and eventually succeeds', async () => {
  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('fetch failed');
      }
      return okResponse(chatEnvelope([]));
    },
    { maxRetries: 3, retryDelayMs: 0 }
  );

  await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.equal(attempts, 3);
});

test('call retries on HTTP 502 (bad gateway) and succeeds when the next attempt is 200', async () => {
  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      if (attempts === 1) {
        return errorResponse(502, 'Bad gateway');
      }
      return okResponse(chatEnvelope([]));
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.equal(attempts, 2);
});

test('call exhausts retries on persistent AbortError and throws LlmProviderError (not quota)', async () => {
  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      throw makeAbortError();
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => {
      if (!(err instanceof LlmProviderError)) return false;
      if (err instanceof LlmQuotaError) return false;
      return /abort/i.test(err.message);
    }
  );
  assert.equal(attempts, 3, 'initial attempt + 2 retries = 3 total');
});

test('call does NOT retry HTTP 429 (quota) — surfaces immediately as LlmQuotaError', async () => {
  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      return errorResponse(429, 'Rate limit exceeded');
    },
    { maxRetries: 3, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => err instanceof LlmQuotaError
  );
  assert.equal(attempts, 1, 'quota errors must never be retried');
});

// Repro for the 2026-W15 counter-signal-validate failure:
//
//   HTTP 429 with body:
//   {"error":{"message":"Provider returned error","code":429,"metadata":{
//     "raw":"google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream.
//            Please retry shortly, or add your own key ...",
//     "provider_name":"Google AI Studio","is_byok":false}}}
//
// This is NOT our account being out of quota — it's the upstream provider
// briefly throttling a free-tier model. OpenRouter itself explicitly says
// "Please retry shortly", so the whole draft pipeline crashing after one
// attempt is wrong. The call loop must classify `metadata.raw`-flagged
// transient upstream rate-limits as retryable and honor maxRetries.
test('call retries HTTP 429 when metadata.raw reports transient upstream rate-limit', async () => {
  const transientRateLimitBody = JSON.stringify({
    error: {
      message: 'Provider returned error',
      code: 429,
      metadata: {
        raw: 'google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits.',
        provider_name: 'Google AI Studio',
        is_byok: false,
      },
    },
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      if (attempts < 3) {
        return { status: 429, body: transientRateLimitBody };
      }
      return okResponse(chatEnvelope([]));
    },
    { maxRetries: 3, retryDelayMs: 0 }
  );

  const scores = await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.deepEqual(scores, []);
  assert.equal(
    attempts,
    3,
    'transient upstream rate-limit must be retried until success'
  );
});

test('call exhausts retries on persistent transient upstream rate-limit and throws LlmQuotaError', async () => {
  const transientRateLimitBody = JSON.stringify({
    error: {
      message: 'Provider returned error',
      code: 429,
      metadata: {
        raw: 'google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream. Please retry shortly.',
        provider_name: 'Google AI Studio',
        is_byok: false,
      },
    },
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      return { status: 429, body: transientRateLimitBody };
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => {
      // After exhausting retries, surface as LlmQuotaError so the
      // FallbackLlmProvider layer can catch it and switch to a
      // different provider (e.g. Gemini).
      if (!(err instanceof LlmQuotaError)) return false;
      return /rate.?limit|upstream/i.test(err.message);
    }
  );
  assert.equal(attempts, 3, 'initial + 2 retries = 3 total');
});

test('call still surfaces HTTP 429 without transient metadata as LlmQuotaError (terminal)', async () => {
  // Regression guard: generic 429 with no transient hint in metadata.raw
  // still means our account is out of quota and must NOT be retried.
  const terminalQuotaBody = JSON.stringify({
    error: {
      message: 'Rate limit exceeded. Please add credits.',
      code: 429,
      metadata: { raw: 'daily free-tier quota exhausted', provider_name: 'OpenRouter' },
    },
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      return { status: 429, body: terminalQuotaBody };
    },
    { maxRetries: 3, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => err instanceof LlmQuotaError
  );
  assert.equal(attempts, 1, 'terminal quota errors must never be retried');
});

// Repro for 2026-W15: an HTTP-200 envelope whose single choice carries
// `error.code: 502` + `metadata.error_type: provider_unavailable` is the
// exact failure mode that killed the score phase. The transport doesn't
// see anything wrong (status 200), so we must inspect the body and treat
// upstream-unavailable choices as transient + retryable.
test('call retries when choice carries provider_unavailable error inside HTTP-200 envelope', async () => {
  const transientChoiceBody = JSON.stringify({
    id: 'gen-x',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: null,
        error: {
          code: 502,
          message: 'Upstream error from OpenInference: Unknown role: assistantfinal',
          metadata: { error_type: 'provider_unavailable' },
        },
        message: { role: 'assistant', content: null, refusal: null },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      if (attempts === 1) return okResponse(transientChoiceBody);
      return okResponse(chatEnvelope([]));
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  const scores = await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.deepEqual(scores, []);
  assert.equal(attempts, 2, 'expected one retry after the choice-level upstream error');
});

test('call exhausts retries on persistent choice-level upstream error and throws non-quota LlmProviderError', async () => {
  const persistentBody = JSON.stringify({
    choices: [
      {
        index: 0,
        finish_reason: null,
        error: {
          code: 502,
          message: 'Upstream error: provider down',
          metadata: { error_type: 'provider_unavailable' },
        },
        message: { role: 'assistant', content: null },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      return okResponse(persistentBody);
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) =>
      err instanceof LlmProviderError &&
      !(err instanceof LlmQuotaError) &&
      /upstream|provider_unavailable|502/i.test(err.message)
  );
  assert.equal(attempts, 3, 'initial attempt + 2 retries = 3 total');
});

test('call surfaces choice-level 429 immediately as LlmQuotaError without retry', async () => {
  const body = JSON.stringify({
    choices: [
      {
        index: 0,
        error: { code: 429, message: 'Upstream rate limit' },
        message: { role: 'assistant', content: null },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      return okResponse(body);
    },
    { maxRetries: 3, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => err instanceof LlmQuotaError
  );
  assert.equal(attempts, 1, 'choice-level quota errors must never be retried');
});

// Repro for the 2026-W15 batch-2 failure: HTTP-200 envelope whose single
// choice has `finish_reason: "stop"`, no `error` field, but `content: null`.
// This is the documented `gpt-oss-120b:free` failure mode where the model
// exhausts its output budget on reasoning tokens (or cold-starts) and
// returns nothing meaningful. OpenRouter's own guidance is "retry with a
// simple retry mechanism" so we must treat it as transient.
//
// See: https://openrouter.ai/docs/api/reference/errors-and-debugging
//      https://github.com/vllm-project/vllm/issues/30498
test('call retries when choice has finish_reason=stop but content is null (empty-content bug)', async () => {
  const emptyContentBody = JSON.stringify({
    id: 'gen-empty',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        logprobs: null,
        finish_reason: 'stop',
        native_finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: null,
          refusal: null,
          reasoning: null,
        },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      if (attempts === 1) return okResponse(emptyContentBody);
      return okResponse(chatEnvelope([]));
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  const scores = await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.deepEqual(scores, []);
  assert.equal(attempts, 2, 'expected one retry after the empty-content response');
});

test('call retries when content is empty string with finish_reason=stop', async () => {
  const emptyStringBody = JSON.stringify({
    id: 'gen-empty-str',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: '', refusal: null },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      if (attempts < 2) return okResponse(emptyStringBody);
      return okResponse(chatEnvelope([]));
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.equal(attempts, 2, 'expected one retry after the empty-string response');
});

test('call retries when finish_reason=length (max_tokens hit) yields null content', async () => {
  const lengthCutoffBody = JSON.stringify({
    id: 'gen-length',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: 'length',
        native_finish_reason: 'length',
        message: { role: 'assistant', content: null },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      if (attempts === 1) return okResponse(lengthCutoffBody);
      return okResponse(chatEnvelope([]));
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.equal(attempts, 2, 'expected one retry on length-cutoff empty content');
});

test('call exhausts retries on persistent null content and throws LlmProviderError mentioning finish_reason', async () => {
  const persistentEmptyBody = JSON.stringify({
    id: 'gen-persistent-empty',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        native_finish_reason: 'stop',
        message: { role: 'assistant', content: null, refusal: null, reasoning: null },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      return okResponse(persistentEmptyBody);
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => {
      if (!(err instanceof LlmProviderError)) return false;
      if (err instanceof LlmQuotaError) return false;
      // Error message should mention the real cause: finish_reason + empty content.
      return (
        /empty|null|finish_reason/i.test(err.message) &&
        /stop/i.test(err.message)
      );
    }
  );
  assert.equal(attempts, 3, 'initial + 2 retries = 3 total');
});

// Repro for the 2026-W15 batch-11 failure: HTTP-200 envelope with
// `finish_reason: "stop"` and a non-empty content field (5.7KB), but the JSON
// inside `message.content` was structurally truncated — unbalanced braces /
// strings. `inspectOpenRouterEnvelope` classified it as `ok`, the retry loop
// returned, and the downstream `parseJsonPayload` crashed the whole score
// phase with "Unbalanced JSON value in LLM response".
//
// This happens on free-tier upstreams that stop streaming mid-output without
// setting `finish_reason: "length"`. OpenRouter's own guidance for no/partial
// content is "retry with a simple retry mechanism", so we must classify
// unparseable content as transient and retry it inside the existing loop.
test('call retries when content is non-empty but structurally truncated JSON (unbalanced)', async () => {
  const truncatedBody = JSON.stringify({
    id: 'gen-truncated',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        native_finish_reason: 'stop',
        message: {
          role: 'assistant',
          // Unbalanced: the string value never closes, so `parseJsonPayload`
          // throws "Unbalanced JSON value in LLM response".
          content: '[{"id":"raw-1","positivity":85,"summary":"unfinished',
          refusal: null,
        },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      if (attempts === 1) return okResponse(truncatedBody);
      return okResponse(chatEnvelope([]));
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  const scores = await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.deepEqual(scores, []);
  assert.equal(attempts, 2, 'expected one retry after the truncated-JSON response');
});

test('call exhausts retries on persistent truncated JSON and throws non-quota LlmProviderError mentioning parse failure', async () => {
  const persistentTruncated = JSON.stringify({
    id: 'gen-persistent-truncated',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        native_finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: '[{"id":"raw-1","positivity":85',
          refusal: null,
        },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      return okResponse(persistentTruncated);
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => {
      if (!(err instanceof LlmProviderError)) return false;
      if (err instanceof LlmQuotaError) return false;
      return (
        /unbalanced|parse|truncat|unparseable/i.test(err.message) &&
        /finish_reason|stop/i.test(err.message)
      );
    }
  );
  assert.equal(attempts, 3, 'initial + 2 retries = 3 total');
});

test('parseOpenRouterResponse: empty-content body surfaces LlmProviderError mentioning finish_reason', () => {
  const body = JSON.stringify({
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: null },
      },
    ],
  });
  assert.throws(
    () => parseOpenRouterResponse(body),
    (err: unknown) => {
      if (!(err instanceof LlmProviderError)) return false;
      if (err instanceof LlmQuotaError) return false;
      return /finish_reason/i.test(err.message) && /stop/i.test(err.message);
    }
  );
});

// Configure request body with reasoning.exclude + generous max_tokens to
// mitigate the gpt-oss-120b empty-content issue. The model exhausts its
// output budget on reasoning tokens if we don't steer it. These settings
// are passed through in the request body builder.
test('buildOpenRouterRequestBody: includes reasoning.exclude and sensible max_tokens by default', () => {
  const body = buildOpenRouterRequestBody({
    model: 'openai/gpt-oss-120b:free',
    prompt: 'p',
    schema: {},
    schemaName: 's',
  });
  const parsed = JSON.parse(body);
  // reasoning.exclude: true prevents reasoning tokens from landing in the
  // final content field (they're consumed server-side).
  assert.deepEqual(parsed.reasoning, { exclude: true });
  // A generous default keeps the model from running out of tokens on
  // reasoning-heavy schemas like the score batch.
  assert.equal(typeof parsed.max_tokens, 'number');
  assert.ok(parsed.max_tokens >= 8000, 'max_tokens should default to at least 8000');
});

// The default output cap is set high (32k+) so non-reasoning models have
// headroom for large structured outputs (e.g. score batches). The upstream
// will silently clamp this to whatever it actually honors, so erring high
// is safe.
test('DEFAULT_MAX_TOKENS is at least 32000 (post-option-3 headroom)', () => {
  assert.ok(
    DEFAULT_MAX_TOKENS >= 32000,
    `DEFAULT_MAX_TOKENS should be >= 32000, got ${DEFAULT_MAX_TOKENS}`
  );
});

test('buildOpenRouterRequestBody: default max_tokens reflects DEFAULT_MAX_TOKENS', () => {
  const body = buildOpenRouterRequestBody({
    model: 'google/gemma-4-26b-a4b-it:free',
    prompt: 'p',
    schema: {},
    schemaName: 's',
  });
  const parsed = JSON.parse(body);
  assert.equal(parsed.max_tokens, DEFAULT_MAX_TOKENS);
  assert.ok(
    parsed.max_tokens >= 32000,
    `request body max_tokens should be >= 32000, got ${parsed.max_tokens}`
  );
});

test('call does NOT retry HTTP 401 (bad auth) — surfaces immediately as non-quota LlmProviderError', async () => {
  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      return errorResponse(401, 'Invalid api key');
    },
    { maxRetries: 3, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) =>
      err instanceof LlmProviderError && !(err instanceof LlmQuotaError)
  );
  assert.equal(attempts, 1, 'auth errors must never be retried');
});

// ---------- identity ----------

test('provider name is "openrouter"', () => {
  const provider = makeProvider(async () => okResponse(chatEnvelope([])));
  assert.equal(provider.name, 'openrouter');
});

// ---------- default fallback model ----------
//
// The default fallback must be a genuinely free, reliable, non-reasoning
// model. Gemma 4 26B is a fast MoE (3.8B active params), supports
// structured outputs, handles Romanian well, is free, and is reliably
// served by Google AI Studio.
test('DEFAULT_FALLBACK_MODEL points to a free non-reasoning model', () => {
  assert.equal(DEFAULT_FALLBACK_MODEL, 'google/gemma-4-26b-a4b-it:free');
});

// ---------- truncation detection (finish_reason=length with non-empty content) ----------
//
// 2026-W15 batch 9 failed with: contentLen=18063 finish_reason=length,
// followed by "Unbalanced JSON value in LLM response". The model hit its
// max_tokens cap mid-JSON and the parser then choked on the truncated
// payload. The existing empty-content handler (line ~720) covers the case
// where length-cutoff yields null/empty content (retryable cold-start),
// but truncated non-empty content is a different failure mode.
//
// Option 4 fix: a truncation error for a single-article batch is still
// terminal (there's nothing left to split), but the surfaced error type is
// now the dedicated `LlmTruncationError` so `scoreArticles` can detect it
// precisely on multi-article batches and recursively split. This test pins
// the base case: batch of 1 with truncation → exactly one attempt → throws
// `LlmTruncationError` with a truncation-flavored message.
test('call treats finish_reason=length with truncated non-empty content as terminal (no retry) for single-article batch', async () => {
  const truncatedContent =
    '[{"id":"raw-1","summary":"rezumat lung","positivity":85,"impact":70,"feltImp';
  const truncatedBody = JSON.stringify({
    id: 'gen-truncated',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: 'length',
        native_finish_reason: 'length',
        message: {
          role: 'assistant',
          content: truncatedContent,
          refusal: null,
        },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      return okResponse(truncatedBody);
    },
    { maxRetries: 3, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => {
      if (!(err instanceof LlmTruncationError)) return false;
      if (err instanceof LlmQuotaError) return false;
      return (
        /truncat/i.test(err.message) &&
        /length|max_tokens/i.test(err.message)
      );
    }
  );
  assert.equal(
    attempts,
    1,
    'single-article truncation must not HTTP-retry — the same prompt will re-truncate at the same place'
  );
});

// ---------- option 4: automatic batch-split on truncation ----------
//
// When `scoreArticles` receives >1 article and the call truncates
// (`finish_reason=length` with non-empty unparseable JSON), the provider
// must recursively split the batch in half and retry each half. This turns
// truncation from a fatal pipeline crash into a transparent recovery, so
// we survive unexpectedly long outputs without babysitting SCORE_BATCH_SIZE.
//
// Base case: a batch of 1 cannot be split further and surfaces the error
// (covered by the test above).

/** Build a minimal truncated response for a batch — content that is length-cut mid-JSON. */
function makeTruncatedResponse(): string {
  return JSON.stringify({
    id: 'gen-truncated-batch',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: 'length',
        native_finish_reason: 'length',
        message: {
          role: 'assistant',
          content: '[{"id":"raw-1","summary":"unfinished',
          refusal: null,
        },
      },
    ],
  });
}

/** Score payload for a single article id. */
function scoreFor(id: string) {
  return {
    id,
    summary: 'ok',
    positivity: 70,
    impact: 60,
    feltImpact: 50,
    certainty: 70,
    humanCloseness: 60,
    bureaucraticDistance: 20,
    promoRisk: 10,
    romaniaRelevant: true,
    category: 'wins' as const,
  };
}

test('scoreArticles: splits batch in half on truncation and returns combined scores', async () => {
  const ids = ['a-1', 'a-2', 'a-3', 'a-4'];
  const articles: RawArticle[] = ids.map((id) => ({ ...RAW, id }));

  // Capture every request body so we can assert on batch boundaries.
  const requestedIdSets: string[][] = [];
  let call = 0;
  const provider = makeProvider(
    async (_url, init) => {
      call++;
      const body = JSON.parse(init.body);
      const prompt = body.messages[0].content as string;
      const idsInPrompt = ids.filter((id) => prompt.includes(id));
      requestedIdSets.push(idsInPrompt);

      // First call contains all 4 ids → truncate.
      if (call === 1 && idsInPrompt.length === 4) {
        return okResponse(makeTruncatedResponse());
      }
      // Each sub-batch succeeds with a score per id it contains.
      return okResponse(chatEnvelope(idsInPrompt.map((id) => scoreFor(id))));
    },
    { maxRetries: 0, retryDelayMs: 0 }
  );

  const scores = await provider.scoreArticles(articles, { includeReasoning: false });

  // All 4 articles get a score back.
  const returnedIds = scores.map((s) => s.id).sort();
  assert.deepEqual(returnedIds, ids.slice().sort());

  // We expect: 1 full-batch call (truncated) + 2 sub-batch calls of 2 ids each.
  assert.equal(call, 3, `expected 3 total calls (1 truncated + 2 halves), got ${call}`);
  assert.deepEqual(requestedIdSets[0], ids, 'first call should contain all 4 ids');
  assert.equal(requestedIdSets[1].length, 2, 'first sub-batch should contain 2 ids');
  assert.equal(requestedIdSets[2].length, 2, 'second sub-batch should contain 2 ids');
  // Sub-batches must partition the input (no overlap, no missing ids).
  const union = [...requestedIdSets[1], ...requestedIdSets[2]].sort();
  assert.deepEqual(union, ids.slice().sort());
});

test('scoreArticles: recursively splits when sub-batches also truncate', async () => {
  const ids = ['a-1', 'a-2', 'a-3', 'a-4'];
  const articles: RawArticle[] = ids.map((id) => ({ ...RAW, id }));

  let call = 0;
  const provider = makeProvider(
    async (_url, init) => {
      call++;
      const body = JSON.parse(init.body);
      const prompt = body.messages[0].content as string;
      const idsInPrompt = ids.filter((id) => prompt.includes(id));

      // Truncate any call with >1 article. Batches of 1 succeed.
      if (idsInPrompt.length > 1) {
        return okResponse(makeTruncatedResponse());
      }
      return okResponse(chatEnvelope(idsInPrompt.map((id) => scoreFor(id))));
    },
    { maxRetries: 0, retryDelayMs: 0 }
  );

  const scores = await provider.scoreArticles(articles, { includeReasoning: false });
  const returnedIds = scores.map((s) => s.id).sort();
  assert.deepEqual(returnedIds, ids.slice().sort());

  // Split tree: [4] → [2, 2] → [1,1, 1,1]. So:
  //   1 (truncated [4]) + 2 (truncated [2]s) + 4 (successful [1]s) = 7 calls.
  assert.equal(call, 7, `expected recursive 1+2+4=7 calls, got ${call}`);
});

test('scoreArticles: non-truncation errors are NOT split — surface immediately', async () => {
  const ids = ['a-1', 'a-2', 'a-3', 'a-4'];
  const articles: RawArticle[] = ids.map((id) => ({ ...RAW, id }));

  // A persistent null-content body — this is the transient empty-content
  // path, not truncation. Should exhaust retries and throw, NOT split.
  const nullContentBody = JSON.stringify({
    id: 'gen-null',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        native_finish_reason: 'stop',
        message: { role: 'assistant', content: null },
      },
    ],
  });

  let call = 0;
  const provider = makeProvider(
    async () => {
      call++;
      return okResponse(nullContentBody);
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  await assert.rejects(
    () => provider.scoreArticles(articles, { includeReasoning: false }),
    (err: unknown) =>
      err instanceof LlmProviderError && !(err instanceof LlmTruncationError)
  );
  // Exactly the retry budget (1 + 2 retries = 3), with no batch-splitting.
  assert.equal(call, 3, `expected 3 HTTP attempts, no split; got ${call}`);
});

test('inspectOpenRouterEnvelope: length cutoff with null content remains transient (retryable)', async () => {
  // Guards against regressions in the existing empty-content retry path —
  // the new truncation detection must NOT swallow the null-content case.
  const emptyLengthBody = JSON.stringify({
    id: 'gen-empty-length',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        finish_reason: 'length',
        native_finish_reason: 'length',
        message: { role: 'assistant', content: null },
      },
    ],
  });

  let attempts = 0;
  const provider = makeProvider(
    async () => {
      attempts++;
      if (attempts === 1) return okResponse(emptyLengthBody);
      return okResponse(chatEnvelope([]));
    },
    { maxRetries: 2, retryDelayMs: 0 }
  );

  await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.equal(attempts, 2, 'null-content length cutoffs stay retryable');
});

// ---------- parseFallbackModels ----------

test('parseFallbackModels: undefined returns undefined (use defaults)', () => {
  assert.equal(parseFallbackModels(undefined), undefined);
});

test('parseFallbackModels: empty string returns empty array (opt-out)', () => {
  assert.deepEqual(parseFallbackModels(''), []);
  assert.deepEqual(parseFallbackModels('  '), []);
});

test('parseFallbackModels: comma-separated string returns trimmed array', () => {
  assert.deepEqual(
    parseFallbackModels('a/b:free, c/d:free ,e/f:free'),
    ['a/b:free', 'c/d:free', 'e/f:free']
  );
});

test('parseFallbackModels: ignores empty segments from trailing commas', () => {
  assert.deepEqual(parseFallbackModels('a/b:free,,c/d:free,'), ['a/b:free', 'c/d:free']);
});

// ---------- DEFAULT_FALLBACK_MODELS ----------

test('DEFAULT_FALLBACK_MODELS are all free-tier models', () => {
  for (const model of DEFAULT_FALLBACK_MODELS) {
    assert.ok(model.endsWith(':free'), `fallback model ${model} must be a :free model`);
  }
});

test('DEFAULT_FALLBACK_MODELS contains at least 2 models for provider diversity', () => {
  assert.ok(
    DEFAULT_FALLBACK_MODELS.length >= 2,
    `expected ≥2 fallback models for provider diversity, got ${DEFAULT_FALLBACK_MODELS.length}`
  );
});

test('DEFAULT_FALLBACK_MODELS + primary fits within OpenRouter models limit', () => {
  assert.ok(
    1 + DEFAULT_FALLBACK_MODELS.length <= OPENROUTER_MAX_MODELS,
    `primary + ${DEFAULT_FALLBACK_MODELS.length} fallbacks exceeds OpenRouter limit of ${OPENROUTER_MAX_MODELS}`
  );
});

// ---------- buildOpenRouterRequestBody: models array ----------

test('buildOpenRouterRequestBody: uses single model field when no fallbacks', () => {
  const body = JSON.parse(
    buildOpenRouterRequestBody({
      model: 'x/primary:free',
      prompt: 'p',
      schema: {},
      schemaName: 's',
    })
  );
  assert.equal(body.model, 'x/primary:free');
  assert.equal(body.models, undefined, 'should not have models array without fallbacks');
});

test('buildOpenRouterRequestBody: uses models array when fallbacks provided', () => {
  const body = JSON.parse(
    buildOpenRouterRequestBody({
      model: 'x/primary:free',
      prompt: 'p',
      schema: {},
      schemaName: 's',
      fallbackModels: ['a/fb1:free', 'b/fb2:free'],
    })
  );
  assert.equal(body.model, undefined, 'should not have single model field');
  assert.deepEqual(body.models, ['x/primary:free', 'a/fb1:free', 'b/fb2:free']);
});

test('buildOpenRouterRequestBody: deduplicates primary from fallback list', () => {
  const body = JSON.parse(
    buildOpenRouterRequestBody({
      model: 'x/primary:free',
      prompt: 'p',
      schema: {},
      schemaName: 's',
      fallbackModels: ['x/primary:free', 'a/fb1:free'],
    })
  );
  assert.deepEqual(body.models, ['x/primary:free', 'a/fb1:free']);
});

test('buildOpenRouterRequestBody: truncates models array to OPENROUTER_MAX_MODELS', () => {
  const body = JSON.parse(
    buildOpenRouterRequestBody({
      model: 'x/primary:free',
      prompt: 'p',
      schema: {},
      schemaName: 's',
      fallbackModels: ['a/fb1:free', 'b/fb2:free', 'c/fb3:free', 'd/fb4:free'],
    })
  );
  assert.equal(body.model, undefined, 'should not have single model field');
  assert.equal(body.models.length, OPENROUTER_MAX_MODELS, `models array must not exceed ${OPENROUTER_MAX_MODELS}`);
  assert.deepEqual(body.models, ['x/primary:free', 'a/fb1:free', 'b/fb2:free']);
});

test('buildOpenRouterRequestBody: empty fallbackModels array uses single model field', () => {
  const body = JSON.parse(
    buildOpenRouterRequestBody({
      model: 'x/primary:free',
      prompt: 'p',
      schema: {},
      schemaName: 's',
      fallbackModels: [],
    })
  );
  assert.equal(body.model, 'x/primary:free');
  assert.equal(body.models, undefined);
});

// ---------- provider with fallback models ----------

test('provider passes models array in request body when fallbackModels configured', async () => {
  let capturedBody: Record<string, unknown> | undefined;

  const provider = makeProvider(
    async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return okResponse(chatEnvelope([]));
    },
    {
      model: 'x/primary:free',
      fallbackModels: ['a/fb1:free', 'b/fb2:free'],
      maxRetries: 0,
    }
  );

  await provider.scoreArticles([RAW], { includeReasoning: false });
  assert.ok(capturedBody, 'fetcher should have been called');
  assert.deepEqual(
    capturedBody!.models,
    ['x/primary:free', 'a/fb1:free', 'b/fb2:free'],
    'request body should use models array with primary + fallbacks'
  );
  assert.equal(capturedBody!.model, undefined, 'should not have single model field');
});
