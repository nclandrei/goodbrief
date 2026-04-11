import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenRouterProvider,
  buildOpenRouterRequestBody,
  parseOpenRouterResponse,
} from '../scripts/lib/llm/openrouter-provider.js';
import type { OpenRouterFetcher } from '../scripts/lib/llm/openrouter-provider.js';
import {
  LlmProviderError,
  LlmQuotaError,
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
  overrides: { apiKey?: string; model?: string; referer?: string; title?: string } = {}
): OpenRouterProvider {
  return new OpenRouterProvider({
    apiKey: overrides.apiKey ?? 'test-or-key',
    model: overrides.model ?? 'anthropic/claude-sonnet-4.5',
    httpReferer: overrides.referer,
    appTitle: overrides.title,
    fetcher: fakeFetcher,
  });
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

// ---------- identity ----------

test('provider name is "openrouter"', () => {
  const provider = makeProvider(async () => okResponse(chatEnvelope([])));
  assert.equal(provider.name, 'openrouter');
});
