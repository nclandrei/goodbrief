import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ClaudeCliProvider,
  parseClaudeEnvelope,
} from '../scripts/lib/llm/claude-cli-provider.js';
import { LlmProviderError, LlmQuotaError } from '../scripts/lib/llm/provider.js';
import type { ProcessedArticle, RawArticle } from '../scripts/types.js';

// ---------- envelope parser ----------

test('parseClaudeEnvelope prefers structured_output when present', () => {
  const stdout = JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: 'ignored fallback text',
    structured_output: { functions: ['a', 'b'] },
    session_id: 's-1',
  });
  const parsed = parseClaudeEnvelope(stdout);
  assert.deepEqual(parsed, { functions: ['a', 'b'] });
});

test('parseClaudeEnvelope falls back to result field when no structured_output', () => {
  const stdout = JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: '{"hello":"world"}',
    session_id: 's-2',
  });
  const parsed = parseClaudeEnvelope<{ hello: string }>(stdout);
  assert.deepEqual(parsed, { hello: 'world' });
});

test('parseClaudeEnvelope handles stream-json: last parseable line wins', () => {
  const stdout = [
    JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1 }),
    JSON.stringify({ type: 'stream_event' }),
    JSON.stringify({
      type: 'result',
      result: '{"ok":true}',
      session_id: 's-3',
    }),
  ].join('\n');
  const parsed = parseClaudeEnvelope<{ ok: boolean }>(stdout);
  assert.deepEqual(parsed, { ok: true });
});

test('parseClaudeEnvelope throws LlmQuotaError on rate_limit error category', () => {
  const stdout = JSON.stringify({
    type: 'result',
    subtype: 'error',
    is_error: true,
    error: 'rate_limit: request limit exceeded',
    session_id: 's-4',
  });
  assert.throws(
    () => parseClaudeEnvelope(stdout),
    (err: unknown) => err instanceof LlmQuotaError
  );
});

test('parseClaudeEnvelope throws LlmProviderError on generic error', () => {
  const stdout = JSON.stringify({
    type: 'result',
    subtype: 'error',
    is_error: true,
    error: 'invalid_request: malformed schema',
  });
  assert.throws(
    () => parseClaudeEnvelope(stdout),
    (err: unknown) =>
      err instanceof LlmProviderError && !(err instanceof LlmQuotaError)
  );
});

test('parseClaudeEnvelope throws when stdout is not JSON', () => {
  assert.throws(
    () => parseClaudeEnvelope('definitely not json at all'),
    /envelope/i
  );
});

// ---------- provider methods with injected fake runner ----------

function makeProvider(
  fakeRunner: (prompt: string, args: string[]) => Promise<string>
): ClaudeCliProvider {
  return new ClaudeCliProvider({ runner: fakeRunner });
}

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

test('scoreArticles: parses Claude structured_output and filters hallucinated IDs', async () => {
  // Anthropic's --json-schema requires the top-level type to be 'object', so
  // the provider wraps the array in { scores: [...] } (see commit 050310f).
  const envelope = {
    type: 'result',
    structured_output: {
      scores: [
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
        // Hallucinated ID that wasn't in the batch — must be filtered out.
        {
          id: 'hallucinated',
          summary: 'x',
          positivity: 50,
          impact: 50,
          romaniaRelevant: true,
          category: 'wins',
        },
      ],
    },
  };

  const provider = makeProvider(async () => JSON.stringify(envelope));
  const scores = await provider.scoreArticles([RAW], { includeReasoning: false });

  assert.equal(scores.length, 1);
  assert.equal(scores[0].id, 'raw-1');
  assert.equal(scores[0].positivity, 85);
});

test('scoreArticles: passes --json-schema and --tools "" and --model to the runner', async () => {
  let capturedArgs: string[] = [];
  const provider = makeProvider(async (_prompt, args) => {
    capturedArgs = args;
    return JSON.stringify({ structured_output: { scores: [] } });
  });
  await provider.scoreArticles([RAW], { includeReasoning: false });

  assert.ok(capturedArgs.includes('-p'), '-p flag present');
  const outputFormatIdx = capturedArgs.indexOf('--output-format');
  assert.notEqual(outputFormatIdx, -1, '--output-format is set');
  assert.equal(capturedArgs[outputFormatIdx + 1], 'json');
  const toolsIdx = capturedArgs.indexOf('--tools');
  assert.notEqual(toolsIdx, -1, '--tools is set');
  assert.equal(capturedArgs[toolsIdx + 1], '', '--tools value is empty string');
  assert.ok(capturedArgs.includes('--json-schema'), '--json-schema is passed');
  assert.ok(capturedArgs.includes('--model'), '--model is passed');
});

test('semanticDedup: returns empty groups for <2 articles without calling claude', async () => {
  let called = 0;
  const provider = makeProvider(async () => {
    called++;
    return '{}';
  });
  const result = await provider.semanticDedup('2026-W15', [PROCESSED]);
  assert.deepEqual(result, { groups: [] });
  assert.equal(called, 0);
});

test('semanticDedup: parses groups from Claude response', async () => {
  const envelope = {
    type: 'result',
    structured_output: {
      groups: [
        { ids: ['p-1', 'p-2'], reason: 'Aceeași poveste' },
      ],
    },
  };
  const provider = makeProvider(async () => JSON.stringify(envelope));
  const result = await provider.semanticDedup('2026-W15', [
    PROCESSED,
    { ...PROCESSED, id: 'p-2' },
  ]);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].ids, ['p-1', 'p-2']);
});

test('classifyCounterSignal: normalizes verdict and defaults missing reason', async () => {
  const envelope = {
    type: 'result',
    structured_output: {
      verdict: 'garbage-value',
      reason: '',
      relatedArticleIds: ['x', 42, 'y'],
    },
  };
  const provider = makeProvider(async () => JSON.stringify(envelope));
  const result = await provider.classifyCounterSignal({
    weekId: '2026-W15',
    candidate: PROCESSED,
    relatedArticles: [RAW],
  });
  assert.equal(result.verdict, 'none');
  assert.ok(result.reason.length > 0);
  assert.deepEqual(result.relatedArticleIds, ['x', 'y']);
});

test('generateWrapperCopy: returns greeting/intro/signOff/shortSummary', async () => {
  const envelope = {
    type: 'result',
    structured_output: {
      greeting: 'Bună dimineața!',
      intro: 'Intro romanesc.',
      signOff: 'Pe săptămâna viitoare!',
      shortSummary: 'Teaser pentru arhivă.',
    },
  };
  const provider = makeProvider(async () => JSON.stringify(envelope));
  const copy = await provider.generateWrapperCopy('2026-W15', [PROCESSED]);
  assert.equal(copy.greeting, 'Bună dimineața!');
  assert.equal(copy.intro, 'Intro romanesc.');
  assert.equal(copy.signOff, 'Pe săptămâna viitoare!');
  assert.equal(copy.shortSummary, 'Teaser pentru arhivă.');
});

test('generateWrapperCopy: throws LlmProviderError on missing required field', async () => {
  const envelope = {
    type: 'result',
    structured_output: {
      greeting: 'Hi',
      // intro missing
      signOff: 'bye',
    },
  };
  const provider = makeProvider(async () => JSON.stringify(envelope));
  await assert.rejects(
    () => provider.generateWrapperCopy('2026-W15', [PROCESSED]),
    (err: unknown) => err instanceof LlmProviderError
  );
});

test('refineDraft: parses selectedIds + intro + shortSummary + reasoning', async () => {
  const envelope = {
    type: 'result',
    structured_output: {
      selectedIds: ['p-1', 'p-2', 42, 'p-3'],
      intro: 'intro',
      shortSummary: 'short',
      reasoning: 'ok',
    },
  };
  const provider = makeProvider(async () => JSON.stringify(envelope));
  const refined = await provider.refineDraft({
    weekId: '2026-W15',
    prompt: 'refine prompt',
  });
  // Non-string IDs filtered out
  assert.deepEqual(refined.selectedIds, ['p-1', 'p-2', 'p-3']);
  assert.equal(refined.intro, 'intro');
  assert.equal(refined.shortSummary, 'short');
  assert.equal(refined.reasoning, 'ok');
});

test('runner error with rate-limit message surfaces as LlmQuotaError', async () => {
  const provider = makeProvider(async () => {
    throw new Error('Error: rate_limit exceeded, please retry later');
  });
  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) => err instanceof LlmQuotaError
  );
});

test('runner error with non-quota message surfaces as LlmProviderError', async () => {
  const provider = makeProvider(async () => {
    throw new Error('ENOENT: claude binary not found');
  });
  await assert.rejects(
    () => provider.scoreArticles([RAW], { includeReasoning: false }),
    (err: unknown) =>
      err instanceof LlmProviderError && !(err instanceof LlmQuotaError)
  );
});
