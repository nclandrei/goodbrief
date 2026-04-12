import type { ProcessedArticle, RawArticle } from '../../types.js';
import type { ArticleScore } from '../types.js';
import type {
  CounterSignalClassifierInput,
  CounterSignalClassifierResult,
} from '../counter-signal-validation.js';
import {
  buildCounterSignalPrompt,
  normalizeVerdict,
} from '../counter-signal-validation.js';
import type { WrapperCopy } from '../../../emails/utils/generate-copy.js';
import { buildWrapperCopyPrompt } from '../../../emails/utils/generate-copy.js';
import {
  formatArticlesForScoring,
  getArticleScoreSchema,
  getScoringPrompt,
  withDefaultSignals,
} from '../gemini.js';
import { getSemanticDedupPrompt } from '../semantic-dedup.js';
import { refineResponseSchema } from './refine-prompt.js';
import { parseJsonPayload } from './json-extract.js';
import type {
  LlmProvider,
  RefinementInput,
  RefinementResult,
  ScoreBatchOptions,
  SemanticDedupResponse,
} from './provider.js';
import {
  LlmProviderError,
  LlmQuotaError,
  LlmTruncationError,
  isQuotaMessage,
} from './provider.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Literal fallback used when neither `OPENROUTER_MODEL` nor a per-phase
 * override is set. Picked for the Good Brief pipeline based on the
 * 2026-W15 post-mortem:
 *
 * - **Free** (`:free` suffix), so it works under the OpenRouter free tier
 *   and with our `max_price: { prompt: 0, completion: 0 }` guard.
 * - **Non-reasoning** — unlike `openai/gpt-oss-120b:free`, DeepSeek V3.1
 *   does not burn its output-token budget on internal `<think>` traces,
 *   so large structured outputs (e.g. 25-article score batches) fit
 *   comfortably in the default 16k `max_tokens` cap without truncation.
 * - **Strong multilingual** (incl. Romanian) and supports OpenAI-style
 *   `response_format: json_schema` structured outputs.
 */
export const DEFAULT_FALLBACK_MODEL = 'deepseek/deepseek-chat-v3.1:free';

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || DEFAULT_FALLBACK_MODEL;
const DEFAULT_REFERER =
  process.env.OPENROUTER_HTTP_REFERER || 'https://goodbrief.ro';
const DEFAULT_APP_TITLE = process.env.OPENROUTER_APP_TITLE || 'Good Brief';
// Per-attempt timeout. 15 minutes is generous but realistic for free-tier
// models like `openai/gpt-oss-120b:free` that queue requests during peak
// hours. Because we use `:free` models with a `max_price` guard, slow
// requests are literally free — so we err on the side of patience.
// Combined with `maxRetries=4` (5 total attempts) and bounded backoff this
// gives ~75 minutes of wall clock per batch in the worst case. The `score`
// job sets `timeout-minutes` to absorb this.
const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.OPENROUTER_TIMEOUT_MS || '900000',
  10
);
// How many retries to attempt on transient failures (AbortError, network
// errors, HTTP 5xx). Total attempts = maxRetries + 1. Set to 0 to disable.
// Default is intentionally generous because the failure mode we see on
// `:free` upstream models is intermittent queue timeouts, which almost
// always succeed on a subsequent attempt.
const DEFAULT_MAX_RETRIES = Number.parseInt(
  process.env.OPENROUTER_MAX_RETRIES || '4',
  10
);
// Base delay for exponential backoff between retries (ms). Actual delay is
// base * 2^attempt, capped at 8x base.
const DEFAULT_RETRY_DELAY_MS = Number.parseInt(
  process.env.OPENROUTER_RETRY_DELAY_MS || '2000',
  10
);
// Default output cap. Reasoning-capable models like `openai/gpt-oss-120b`
// will happily burn their entire output budget on internal `<think>` traces
// and return `content: null` with `finish_reason: "stop"` if the cap is too
// small (documented vLLM issue vllm-project/vllm#30498 and reported across
// multiple inference servers). We default high so the score batch schema
// (up to 25 article scores per call) has plenty of headroom, and we
// additionally set `reasoning.exclude: true` so the reasoning tokens don't
// clobber the structured JSON output.
//
// 2026-W15 post-mortem (option 3): raised from 16000 → 32000 so non-
// reasoning models like `deepseek/deepseek-chat-v3.1:free` have 2× the
// previous headroom for large structured outputs. OpenRouter / the
// upstream provider will silently clamp this to whatever they actually
// honor, so erring high is safe — the only downside is that truly
// broken upstreams may take a moment longer to hit their real cap,
// which our truncation-split path (see `scoreArticles`) now handles.
export const DEFAULT_MAX_TOKENS = Number.parseInt(
  process.env.OPENROUTER_MAX_TOKENS || '32000',
  10
);

// ---------- HTTP abstraction (injectable for tests) ----------

export interface OpenRouterHttpRequest {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

export interface OpenRouterHttpResponse {
  status: number;
  body: string;
}

/**
 * Minimal fetch-like signature used by {@link OpenRouterProvider}. Tests inject
 * a fake implementation; the default implementation uses global `fetch`.
 */
export type OpenRouterFetcher = (
  url: string,
  init: OpenRouterHttpRequest
) => Promise<OpenRouterHttpResponse>;

// ---------- Response shapes (partial) ----------

interface OpenRouterChoiceMessage {
  role?: string;
  content?: string | null;
  refusal?: string | null;
  reasoning?: string | null;
}

interface OpenRouterChoice {
  index?: number;
  message?: OpenRouterChoiceMessage;
  finish_reason?: string | null;
  native_finish_reason?: string | null;
  /**
   * OpenRouter sometimes returns an HTTP-200 envelope where the upstream
   * provider failed mid-stream. In that case the choice carries its own
   * `error` payload (status code, message, metadata.error_type) and
   * `message.content` is `null`. We must surface this so callers can retry
   * provider_unavailable / 5xx blips and bail out cleanly on terminal errors.
   */
  error?: OpenRouterErrorPayload;
}

interface OpenRouterErrorPayload {
  code?: number;
  message?: string;
  metadata?: unknown;
}

interface OpenRouterEnvelope {
  id?: string;
  object?: string;
  choices?: OpenRouterChoice[];
  error?: OpenRouterErrorPayload;
}

// ---------- request body builder ----------

export interface BuildRequestBodyOptions {
  model: string;
  prompt: string;
  schema: unknown;
  schemaName: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Build the JSON body for an OpenRouter chat-completion request.
 *
 * We always wrap the schema in `response_format: { type: 'json_schema', ... }`
 * — OpenRouter normalizes that to the OpenAI-style `response_format` and the
 * underlying model will return structured output in `choices[0].message.content`.
 *
 * `strict` is set to `false` because our existing Gemini schemas don't
 * necessarily set `additionalProperties: false` or list every property in
 * `required`; OpenAI's strict mode would reject them. We keep the schema as
 * guidance and still instruct the model to return only JSON in the prompt.
 */
export function buildOpenRouterRequestBody(
  options: BuildRequestBodyOptions
): string {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: [{ role: 'user', content: options.prompt }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: options.schemaName,
        strict: false,
        schema: options.schema,
      },
    },
    // `reasoning.exclude: true` tells OpenRouter to keep reasoning tokens
    // server-side so the final `choices[0].message.content` receives the
    // structured JSON output (not the `<think>` trace). Without this, models
    // like `openai/gpt-oss-120b:free` may exhaust `max_tokens` on reasoning
    // and return `content: null` with `finish_reason: "stop"`. This is a
    // no-op for non-reasoning models.
    reasoning: { exclude: true },
    // Generous output cap. See DEFAULT_MAX_TOKENS comment above.
    max_tokens: DEFAULT_MAX_TOKENS,
    // Hard cost ceiling: OpenRouter rejects any upstream whose per-token
    // price exceeds zero before billing. Combined with a `:free` model id (or
    // the `openrouter/free` meta-router), this guarantees $0 spend.
    max_price: { prompt: 0, completion: 0 },
  };

  if (typeof options.temperature === 'number') {
    body.temperature = options.temperature;
  }
  if (typeof options.maxTokens === 'number') {
    body.max_tokens = options.maxTokens;
  }

  return JSON.stringify(body);
}

// ---------- response parser ----------

/**
 * Parse an OpenRouter chat-completion response body and return the JSON
 * structure produced by the model.
 *
 * Surfaces:
 *   - `LlmQuotaError` if the envelope's `error.code` is a rate-limit / credit
 *     status.
 *   - `LlmProviderError` for any other error envelope, missing choices, or
 *     unparseable content.
 */
export function parseOpenRouterResponse<T = unknown>(rawBody: string): T {
  const envelope = safeParseEnvelope(rawBody);

  if (envelope.error) {
    if (process.env.OPENROUTER_DEBUG === '1') {
      console.error('[openrouter] envelope error', JSON.stringify(envelope.error).slice(0, 1000));
    }
    const message =
      envelope.error.message || 'OpenRouter returned an error envelope';
    if (isQuotaMessage(message) || isQuotaStatusCode(envelope.error.code)) {
      throw new LlmQuotaError('openrouter', message);
    }
    throw new LlmProviderError('openrouter', message);
  }

  if (!Array.isArray(envelope.choices) || envelope.choices.length === 0) {
    throw new LlmProviderError(
      'openrouter',
      `OpenRouter response has no choices: ${rawBody.slice(0, 300)}`
    );
  }

  const choice = envelope.choices[0];

  // Per-choice error: HTTP envelope was 200 but the upstream provider died
  // mid-stream (e.g. provider_unavailable, upstream 5xx). Surface the real
  // cause instead of the misleading "content is empty" path below.
  if (choice?.error) {
    const choiceMessage = choice.error.message || 'OpenRouter choice-level error';
    if (isQuotaMessage(choiceMessage) || isQuotaStatusCode(choice.error.code)) {
      throw new LlmQuotaError('openrouter', choiceMessage);
    }
    throw new LlmProviderError(
      'openrouter',
      `OpenRouter choice-level error (code=${
        choice.error.code ?? 'unknown'
      }): ${choiceMessage}`
    );
  }

  const content = choice?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    const finishReason = choice?.finish_reason ?? 'unknown';
    const nativeFinishReason = choice?.native_finish_reason ?? 'unknown';
    throw new LlmProviderError(
      'openrouter',
      `OpenRouter response content is empty or non-string (finish_reason=${finishReason} native_finish_reason=${nativeFinishReason}): ${JSON.stringify(
        choice
      ).slice(0, 300)}`
    );
  }

  try {
    return parseJsonPayload<T>(content);
  } catch (error) {
    throw new LlmProviderError(
      'openrouter',
      `Failed to parse JSON from OpenRouter content: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

function safeParseEnvelope(rawBody: string): OpenRouterEnvelope {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    throw new LlmProviderError('openrouter', 'OpenRouter returned empty body');
  }
  try {
    return JSON.parse(trimmed) as OpenRouterEnvelope;
  } catch (error) {
    throw new LlmProviderError(
      'openrouter',
      `OpenRouter returned non-JSON body: ${trimmed.slice(0, 300)}`,
      { cause: error }
    );
  }
}

function isQuotaStatusCode(code: number | undefined): boolean {
  return code === 429 || code === 402 || code === 403;
}

function isTransientStatusCode(code: number | undefined): boolean {
  return typeof code === 'number' && code >= 500 && code < 600;
}

function isProviderUnavailableMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const errorType = (metadata as { error_type?: unknown }).error_type;
  return (
    errorType === 'provider_unavailable' ||
    errorType === 'provider_overloaded' ||
    errorType === 'timeout'
  );
}

/**
 * Detect OpenRouter's "upstream provider is briefly throttling us" flavor of
 * HTTP 429. OpenRouter surfaces these with a generic top-level
 * `error.message: "Provider returned error"` plus the real reason in
 * `error.metadata.raw`, e.g.:
 *
 *   "google/gemma-3-27b-it:free is temporarily rate-limited upstream.
 *    Please retry shortly, or add your own key ..."
 *
 * This is distinct from our own account being out of quota — the upstream
 * model provider (e.g. Google AI Studio, Groq) is briefly rejecting traffic
 * and OpenRouter itself tells us to retry. Classifying these as terminal
 * `LlmQuotaError` crashes the whole draft pipeline after one attempt, so we
 * surface them as transient and let the retry loop handle them.
 *
 * Reproduces the 2026-W15 `counter-signal-validate` failure where
 * `google/gemma-3-27b-it:free` returned HTTP 429 on attempt 1/5 and the
 * pipeline bailed out instead of honoring the remaining retries.
 */
export function isTransientUpstreamRateLimit(
  error: OpenRouterErrorPayload | null | undefined
): boolean {
  if (!error) return false;
  const metadata = error.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  const raw = (metadata as { raw?: unknown }).raw;
  if (typeof raw !== 'string') return false;
  const lower = raw.toLowerCase();
  return (
    lower.includes('temporarily rate-limited') ||
    lower.includes('temporarily rate limited') ||
    lower.includes('rate-limited upstream') ||
    lower.includes('rate limited upstream') ||
    lower.includes('retry shortly') ||
    lower.includes('try again shortly')
  );
}

/**
 * Result of inspecting an HTTP-2xx OpenRouter response body. Distinguishes
 * healthy responses from per-choice errors that the transport layer cannot
 * see (because the HTTP envelope is 200) so {@link OpenRouterProvider.call}
 * can retry transient upstream blips and bail out cleanly on terminal ones.
 */
export type OpenRouterEnvelopeStatus =
  | { kind: 'ok' }
  | { kind: 'quota'; message: string }
  | { kind: 'transient'; message: string }
  | { kind: 'terminal'; message: string }
  /**
   * Model hit its `max_tokens` cap mid-output and returned structurally
   * truncated JSON (`finish_reason: "length"` with non-empty content).
   * HTTP-retrying is pointless — the same prompt will re-truncate at the
   * same place — but batch callers can recover by splitting the input.
   * {@link OpenRouterProvider.call} surfaces this as an
   * {@link LlmTruncationError}; {@link OpenRouterProvider.scoreArticles}
   * catches it and recursively halves the batch.
   */
  | { kind: 'truncation'; message: string };

/**
 * Inspect an OpenRouter response body and classify its status. Used by
 * {@link OpenRouterProvider.call} on the 2xx path to detect upstream
 * `provider_unavailable` errors that arrive embedded inside an otherwise
 * successful HTTP envelope (the 2026-W15 score-phase failure mode).
 */
export function inspectOpenRouterEnvelope(
  rawBody: string
): OpenRouterEnvelopeStatus {
  let envelope: OpenRouterEnvelope;
  try {
    envelope = JSON.parse(rawBody) as OpenRouterEnvelope;
  } catch {
    return {
      kind: 'terminal',
      message: `OpenRouter returned non-JSON body: ${rawBody.slice(0, 200)}`,
    };
  }

  if (envelope.error) {
    const message =
      envelope.error.message || 'OpenRouter returned an error envelope';
    if (isQuotaMessage(message) || isQuotaStatusCode(envelope.error.code)) {
      return { kind: 'quota', message };
    }
    if (isTransientStatusCode(envelope.error.code)) {
      return { kind: 'transient', message };
    }
    return { kind: 'terminal', message };
  }

  if (!Array.isArray(envelope.choices) || envelope.choices.length === 0) {
    return {
      kind: 'terminal',
      message: 'OpenRouter response has no choices',
    };
  }

  const choice = envelope.choices[0];
  if (choice?.error) {
    const message = choice.error.message || 'OpenRouter choice-level error';
    if (isQuotaMessage(message) || isQuotaStatusCode(choice.error.code)) {
      return { kind: 'quota', message };
    }
    if (
      isTransientStatusCode(choice.error.code) ||
      isProviderUnavailableMetadata(choice.error.metadata)
    ) {
      return {
        kind: 'transient',
        message: `choice-level error (code=${
          choice.error.code ?? 'unknown'
        }): ${message}`,
      };
    }
    return {
      kind: 'terminal',
      message: `choice-level error (code=${
        choice.error.code ?? 'unknown'
      }): ${message}`,
    };
  }

  // No explicit error, but the choice may still be unusable if the model
  // returned null/empty content. This is the `gpt-oss-120b:free` failure
  // mode reproduced on 2026-W15 batch 2 — `finish_reason: "stop"` with
  // `content: null` because the model burned its output budget on
  // reasoning tokens (or cold-started without producing output). OpenRouter's
  // own errors-and-debugging guide explicitly recommends retrying with a
  // simple retry mechanism when no content is generated, so we classify
  // this as `transient`.
  //
  // Refs:
  //   - https://openrouter.ai/docs/api/reference/errors-and-debugging
  //     ("When No Content is Generated")
  //   - https://github.com/vllm-project/vllm/issues/30498
  const content = choice?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    const finishReason = choice?.finish_reason ?? 'unknown';
    const nativeFinishReason = choice?.native_finish_reason ?? 'unknown';
    return {
      kind: 'transient',
      message: `empty content (finish_reason=${finishReason} native_finish_reason=${nativeFinishReason}) — model returned null/empty output`,
    };
  }

  // Content is non-empty but `finish_reason: "length"` means the model ran
  // out of `max_tokens` mid-output. The payload will be structurally
  // truncated JSON (unbalanced braces/strings) and HTTP-retrying the same
  // prompt will re-truncate at the same place. This is the 2026-W15 batch 9
  // failure mode. We classify it as a dedicated `truncation` status so the
  // call layer can surface it as {@link LlmTruncationError} and batch
  // callers like `scoreArticles` can recover by splitting the input.
  if (choice?.finish_reason === 'length') {
    return {
      kind: 'truncation',
      message: `output truncated (finish_reason=length, contentLen=${content.length}) — the model hit max_tokens mid-output. Reduce batch size (e.g. SCORE_BATCH_SIZE) or raise OPENROUTER_MAX_TOKENS, or switch to a non-reasoning model with a larger output budget.`,
    };
  }

  // Content is non-empty and `finish_reason` looks healthy, but the body may
  // still be structurally broken JSON: some free-tier upstreams (reproduced
  // on 2026-W15 batch 11 with `openai/gpt-oss-120b:free`) stop streaming
  // mid-output and report `finish_reason: "stop"` without ever setting
  // `length`. The downstream `parseJsonPayload` would then crash the whole
  // phase because the error is raised outside the retry loop in
  // `OpenRouterProvider.call`.
  //
  // Validate the content here so the retry loop gets a chance to recover.
  // Classify as `transient` (not `terminal`) because re-running the same
  // prompt against a non-deterministic upstream commonly succeeds on a
  // subsequent attempt — this is the same recommendation as OpenRouter's
  // "retry with a simple retry mechanism" guidance for no/partial content.
  try {
    parseJsonPayload(content);
  } catch (error) {
    const parseMessage = error instanceof Error ? error.message : String(error);
    const finishReason = choice?.finish_reason ?? 'unknown';
    const nativeFinishReason = choice?.native_finish_reason ?? 'unknown';
    return {
      kind: 'transient',
      message: `content is non-empty but JSON is unparseable/truncated (finish_reason=${finishReason} native_finish_reason=${nativeFinishReason} contentLen=${content.length}): ${parseMessage} — upstream likely stopped streaming mid-output`,
    };
  }

  return { kind: 'ok' };
}

// ---------- provider implementation ----------

export interface OpenRouterProviderOptions {
  apiKey: string;
  model?: string;
  /** Optional HTTP-Referer header (OpenRouter app attribution). */
  httpReferer?: string;
  /** Optional X-Title header (OpenRouter app attribution). */
  appTitle?: string;
  /** Overridable fetcher for tests. Defaults to global `fetch`. */
  fetcher?: OpenRouterFetcher;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Max retries on transient failures (abort, network, HTTP 5xx). */
  maxRetries?: number;
  /** Base delay for exponential backoff between retries, in ms. */
  retryDelayMs?: number;
}

const SCORE_SCHEMA_CACHE = {
  withReasoning: getArticleScoreSchema(true),
  withoutReasoning: getArticleScoreSchema(false),
};

const SEMANTIC_DEDUP_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['ids', 'reason'],
      },
    },
  },
  required: ['groups'],
};

const COUNTER_SIGNAL_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['none', 'borderline', 'strong'] },
    reason: { type: 'string' },
    relatedArticleIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'reason', 'relatedArticleIds'],
};

const WRAPPER_COPY_SCHEMA = {
  type: 'object',
  properties: {
    greeting: { type: 'string' },
    intro: { type: 'string' },
    signOff: { type: 'string' },
    shortSummary: { type: 'string' },
  },
  required: ['greeting', 'intro', 'signOff', 'shortSummary'],
};

/**
 * OpenRouter LLM provider.
 *
 * Drop-in replacement for {@link GeminiProvider} and {@link ClaudeCliProvider}
 * that speaks to OpenRouter's OpenAI-compatible chat completions endpoint.
 * Authenticates with `OPENROUTER_API_KEY` as a bearer token and uses
 * structured output via `response_format: { type: 'json_schema' }` so the same
 * downstream phases can consume the results without changes.
 *
 * The default model is read from `OPENROUTER_MODEL` (fallback:
 * `anthropic/claude-sonnet-4.5`). Attribution headers default to the Good
 * Brief site URL / app title but can be overridden via
 * `OPENROUTER_HTTP_REFERER` and `OPENROUTER_APP_TITLE`.
 */
export class OpenRouterProvider implements LlmProvider {
  readonly name = 'openrouter' as const;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly httpReferer: string;
  private readonly appTitle: string;
  private readonly fetcher: OpenRouterFetcher;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: OpenRouterProviderOptions) {
    if (!options.apiKey) {
      throw new Error(
        'OpenRouterProvider requires an apiKey (set OPENROUTER_API_KEY)'
      );
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.httpReferer = options.httpReferer ?? DEFAULT_REFERER;
    this.appTitle = options.appTitle ?? DEFAULT_APP_TITLE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.fetcher = options.fetcher ?? createDefaultFetcher(this.timeoutMs);
    console.error(
      `[openrouter] provider ready model=${this.model} timeoutMs=${this.timeoutMs} maxRetries=${this.maxRetries} retryDelayMs=${this.retryDelayMs}`
    );
  }

  async scoreArticles(
    articles: RawArticle[],
    options: ScoreBatchOptions
  ): Promise<ArticleScore[]> {
    if (articles.length === 0) {
      return [];
    }

    try {
      return await this.scoreArticlesOnce(articles, options);
    } catch (error) {
      // Option 4: on truncation, recursively halve the batch and retry.
      // This turns "model hit max_tokens mid-output" from a fatal crash
      // into a transparent recovery, regardless of how we picked
      // SCORE_BATCH_SIZE. Base case: a batch of 1 can't be split further,
      // so we surface the error for the caller to handle.
      if (error instanceof LlmTruncationError && articles.length > 1) {
        const mid = Math.floor(articles.length / 2);
        console.error(
          `[openrouter] scoreArticles: truncation on batch of ${articles.length}; splitting into ${mid} + ${articles.length - mid} and retrying each half`
        );
        const firstHalf = articles.slice(0, mid);
        const secondHalf = articles.slice(mid);
        const [first, second] = await Promise.all([
          this.scoreArticles(firstHalf, options),
          this.scoreArticles(secondHalf, options),
        ]);
        return [...first, ...second];
      }
      throw error;
    }
  }

  /**
   * Single-shot score call — no split/retry. Extracted so `scoreArticles`
   * can wrap it with the option-4 truncation recovery path without having
   * to thread recursion state through the body.
   */
  private async scoreArticlesOnce(
    articles: RawArticle[],
    options: ScoreBatchOptions
  ): Promise<ArticleScore[]> {
    const articlesText = formatArticlesForScoring(articles);
    const basePrompt = getScoringPrompt(articlesText, options.includeReasoning);
    const prompt = `${basePrompt}

OUTPUT RULES (OpenRouter structured output):
- Respond with ONLY the JSON array described above.
- No markdown, no code fences, no prose before or after the JSON.
- The JSON array MUST contain exactly one object per input article ID.`;

    const schema = options.includeReasoning
      ? SCORE_SCHEMA_CACHE.withReasoning
      : SCORE_SCHEMA_CACHE.withoutReasoning;

    const raw = await this.call(prompt, {
      schema,
      schemaName: 'article_scores',
      model: process.env.OPENROUTER_SCORE_MODEL || this.model,
    });

    const parsed = parseOpenRouterResponse<unknown>(raw);
    if (!Array.isArray(parsed)) {
      throw new LlmProviderError(
        'openrouter',
        `scoreArticles: expected JSON array, got ${typeof parsed}`
      );
    }

    const sentIds = new Set(articles.map((article) => article.id));
    return (parsed as ArticleScore[])
      .filter((score): score is ArticleScore =>
        Boolean(score && typeof score.id === 'string' && sentIds.has(score.id))
      )
      .map((score) => withDefaultSignals(score));
  }

  async semanticDedup(
    weekId: string,
    articles: ProcessedArticle[]
  ): Promise<SemanticDedupResponse> {
    if (articles.length < 2) {
      return { groups: [] };
    }

    const basePrompt = getSemanticDedupPrompt(weekId, articles);
    const prompt = `${basePrompt}

OUTPUT RULES (OpenRouter structured output):
- Respond with ONLY a JSON object of shape { "groups": [{ "ids": [...], "reason": "..." }] }.
- No markdown, no code fences.
- If no duplicates are found, return { "groups": [] }.`;

    const raw = await this.call(prompt, {
      schema: SEMANTIC_DEDUP_SCHEMA,
      schemaName: 'semantic_dedup',
      model: process.env.OPENROUTER_DEDUP_MODEL || this.model,
    });

    const parsed = parseOpenRouterResponse<SemanticDedupResponse>(raw);
    const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
    return { groups };
  }

  async classifyCounterSignal(
    input: CounterSignalClassifierInput
  ): Promise<CounterSignalClassifierResult> {
    const basePrompt = buildCounterSignalPrompt(
      input.weekId,
      input.candidate,
      input.relatedArticles
    );
    const prompt = `${basePrompt}

OUTPUT RULES (OpenRouter structured output):
- Respond with ONLY the JSON object described above.
- "reason" MUST be in Romanian.
- No markdown, no code fences.`;

    const raw = await this.call(prompt, {
      schema: COUNTER_SIGNAL_SCHEMA,
      schemaName: 'counter_signal',
      model: process.env.OPENROUTER_COUNTER_SIGNAL_MODEL || this.model,
    });

    const parsed = parseOpenRouterResponse<CounterSignalClassifierResult>(raw);
    return {
      verdict: normalizeVerdict(parsed.verdict),
      reason:
        (typeof parsed.reason === 'string' && parsed.reason.trim()) ||
        'Există semnale mixte în acoperirea din aceeași săptămână.',
      relatedArticleIds: Array.isArray(parsed.relatedArticleIds)
        ? parsed.relatedArticleIds.filter(
            (id): id is string => typeof id === 'string'
          )
        : [],
    };
  }

  async generateWrapperCopy(
    weekId: string,
    articles: ProcessedArticle[]
  ): Promise<WrapperCopy> {
    const basePrompt = buildWrapperCopyPrompt(articles, weekId);
    const prompt = `${basePrompt}

OUTPUT RULES (OpenRouter structured output):
- Respond with ONLY the JSON object described above.
- No markdown, no code fences.
- All Romanian text must use informal "tu", never "dumneavoastră".`;

    const raw = await this.call(prompt, {
      schema: WRAPPER_COPY_SCHEMA,
      schemaName: 'wrapper_copy',
      model: process.env.OPENROUTER_WRAPPER_COPY_MODEL || this.model,
    });

    const parsed = parseOpenRouterResponse<Partial<WrapperCopy>>(raw);
    if (!parsed || !parsed.greeting || !parsed.intro || !parsed.signOff) {
      throw new LlmProviderError(
        'openrouter',
        `generateWrapperCopy: missing required fields (got: ${Object.keys(
          parsed || {}
        ).join(',')})`
      );
    }

    return {
      greeting: parsed.greeting,
      intro: parsed.intro,
      signOff: parsed.signOff,
      shortSummary: parsed.shortSummary || '',
    };
  }

  async refineDraft(input: RefinementInput): Promise<RefinementResult> {
    const prompt = `${input.prompt}

OUTPUT RULES (OpenRouter structured output):
- Respond with ONLY the JSON object described above.
- Keys: selectedIds (array of 9-12 strings), intro (Romanian), shortSummary (Romanian), reasoning (Romanian).
- No markdown, no code fences.`;

    const raw = await this.call(prompt, {
      schema: refineResponseSchema,
      schemaName: 'refine_draft',
      model: process.env.OPENROUTER_REFINE_MODEL || this.model,
    });

    const parsed = parseOpenRouterResponse<Partial<RefinementResult>>(raw);
    if (!parsed || !Array.isArray(parsed.selectedIds)) {
      throw new LlmProviderError(
        'openrouter',
        'refineDraft: selectedIds missing or not an array'
      );
    }

    return {
      selectedIds: parsed.selectedIds.filter(
        (id): id is string => typeof id === 'string'
      ),
      intro: typeof parsed.intro === 'string' ? parsed.intro : '',
      shortSummary:
        typeof parsed.shortSummary === 'string' ? parsed.shortSummary : '',
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    };
  }

  // ---------- shared call path ----------

  private async call(
    prompt: string,
    options: { schema: unknown; schemaName: string; model?: string }
  ): Promise<string> {
    const model = options.model ?? this.model;
    const body = buildOpenRouterRequestBody({
      model,
      prompt,
      schema: options.schema,
      schemaName: options.schemaName,
    });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.httpReferer) {
      headers['HTTP-Referer'] = this.httpReferer;
    }
    if (this.appTitle) {
      headers['X-Title'] = this.appTitle;
    }

    const totalAttempts = this.maxRetries + 1;
    const logPrefix = `[openrouter] schema=${options.schemaName} model=${model} promptLen=${prompt.length}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      const attemptLabel = `attempt=${attempt}/${totalAttempts}`;
      const startedAt = Date.now();
      console.error(`${logPrefix} ${attemptLabel} starting`);

      let response: OpenRouterHttpResponse | undefined;
      try {
        response = await this.fetcher(OPENROUTER_URL, {
          method: 'POST',
          headers,
          body,
        });
      } catch (error) {
        const elapsed = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        const isAbort =
          error instanceof Error && error.name === 'AbortError';
        console.error(
          `${logPrefix} ${attemptLabel} fetch-error elapsedMs=${elapsed} abort=${isAbort} message=${message}`
        );

        // Quota / rate-limit is terminal for this provider.
        if (isQuotaMessage(message)) {
          throw new LlmQuotaError('openrouter', message, { cause: error });
        }

        // Transient (abort, network) errors are retryable.
        lastError = error;
        if (attempt < totalAttempts) {
          await this.sleepBackoff(attempt);
          continue;
        }
        throw new LlmProviderError(
          'openrouter',
          `OpenRouter call failed after ${totalAttempts} attempts: ${message}`,
          { cause: error }
        );
      }

      const elapsed = Date.now() - startedAt;

      if (response.status >= 200 && response.status < 300) {
        // HTTP transport succeeded, but OpenRouter sometimes returns a
        // 200 envelope whose single choice carries an upstream error
        // (e.g. provider_unavailable, upstream 5xx). Inspect the body so
        // those failures get retried instead of crashing the pipeline.
        const envelopeStatus = inspectOpenRouterEnvelope(response.body);
        const diag = summarizeEnvelopeForLog(response.body);

        if (envelopeStatus.kind === 'ok') {
          console.error(
            `${logPrefix} ${attemptLabel} ok status=${response.status} elapsedMs=${elapsed} bodyLen=${response.body.length} finish_reason=${diag.finishReason} native_finish_reason=${diag.nativeFinishReason} contentLen=${diag.contentLen}`
          );
          return response.body;
        }

        if (envelopeStatus.kind === 'quota') {
          console.error(
            `${logPrefix} ${attemptLabel} quota-in-200-envelope elapsedMs=${elapsed} finish_reason=${diag.finishReason} message=${envelopeStatus.message}`
          );
          throw new LlmQuotaError('openrouter', envelopeStatus.message);
        }

        if (envelopeStatus.kind === 'transient') {
          // Always emit a body preview on transient errors — we need to
          // see what the upstream actually returned when the pipeline
          // fails on CI (where OPENROUTER_DEBUG is typically unset).
          console.error(
            `${logPrefix} ${attemptLabel} transient-in-200-envelope elapsedMs=${elapsed} bodyLen=${response.body.length} finish_reason=${diag.finishReason} native_finish_reason=${diag.nativeFinishReason} contentLen=${diag.contentLen} usage=${diag.usage} message=${envelopeStatus.message}`
          );
          console.error(
            `${logPrefix} ${attemptLabel} body-preview=${response.body.slice(0, 1000)}`
          );
          lastError = new LlmProviderError(
            'openrouter',
            `OpenRouter transient choice error: ${envelopeStatus.message}`
          );
          if (attempt < totalAttempts) {
            await this.sleepBackoff(attempt);
            continue;
          }
          throw lastError;
        }

        if (envelopeStatus.kind === 'truncation') {
          // `finish_reason: "length"` with non-empty unparseable content.
          // HTTP-retrying is pointless, but batch-aware callers can split
          // the input and retry each half — surface a dedicated error so
          // they can detect this precisely.
          console.error(
            `${logPrefix} ${attemptLabel} truncation-in-200-envelope elapsedMs=${elapsed} finish_reason=${diag.finishReason} message=${envelopeStatus.message}`
          );
          console.error(
            `${logPrefix} ${attemptLabel} body-preview=${response.body.slice(0, 1000)}`
          );
          throw new LlmTruncationError(
            'openrouter',
            `OpenRouter envelope error: ${envelopeStatus.message}`
          );
        }

        // kind === 'terminal' — bail out without retrying.
        console.error(
          `${logPrefix} ${attemptLabel} terminal-in-200-envelope elapsedMs=${elapsed} finish_reason=${diag.finishReason} message=${envelopeStatus.message}`
        );
        console.error(
          `${logPrefix} ${attemptLabel} body-preview=${response.body.slice(0, 1000)}`
        );
        throw new LlmProviderError(
          'openrouter',
          `OpenRouter envelope error: ${envelopeStatus.message}`
        );
      }

      // Non-2xx: decide whether to retry, map to quota, or bail out.
      const parsedError = extractErrorPayload(response.body);
      const message =
        (parsedError && typeof parsedError.message === 'string' && parsedError.message) ||
        response.body.slice(0, 300) ||
        `OpenRouter HTTP ${response.status}`;
      const bodyPreview = response.body.slice(0, 1000);
      console.error(
        `${logPrefix} ${attemptLabel} non-2xx status=${response.status} elapsedMs=${elapsed} message=${message}`
      );
      // Always emit the body preview on non-2xx errors — we need to see
      // what the upstream actually returned when CI fails.
      console.error(`${logPrefix} ${attemptLabel} body-preview=${bodyPreview}`);

      // Transient upstream rate-limit (HTTP 429 with `metadata.raw` reporting
      // "temporarily rate-limited upstream") is what OpenRouter returns when
      // the underlying provider — not our account — is briefly throttling us.
      // OpenRouter itself says "Please retry shortly", so treat it as
      // retryable instead of a terminal quota error.
      if (
        response.status === 429 &&
        isTransientUpstreamRateLimit(parsedError)
      ) {
        console.error(
          `${logPrefix} ${attemptLabel} transient-upstream-rate-limit status=429 message=${message}`
        );
        lastError = new LlmProviderError(
          'openrouter',
          `OpenRouter upstream rate-limit: ${message}`
        );
        if (attempt < totalAttempts) {
          await this.sleepBackoff(attempt);
          continue;
        }
        throw lastError;
      }

      if (isQuotaStatusCode(response.status) || isQuotaMessage(message)) {
        throw new LlmQuotaError('openrouter', message);
      }

      // 5xx → retry; 4xx → terminal.
      if (response.status >= 500 && response.status < 600) {
        lastError = new LlmProviderError(
          'openrouter',
          `OpenRouter HTTP ${response.status}: ${message}`
        );
        if (attempt < totalAttempts) {
          await this.sleepBackoff(attempt);
          continue;
        }
      }

      throw new LlmProviderError(
        'openrouter',
        `OpenRouter HTTP ${response.status}: ${message}`
      );
    }

    // Unreachable in practice — the loop either returns or throws.
    throw new LlmProviderError(
      'openrouter',
      `OpenRouter call exhausted ${totalAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      { cause: lastError }
    );
  }

  private async sleepBackoff(attempt: number): Promise<void> {
    if (this.retryDelayMs <= 0) return;
    // attempt is 1-indexed; delay = base * 2^(attempt-1), capped at 8x base.
    const factor = Math.min(2 ** (attempt - 1), 8);
    const delay = this.retryDelayMs * factor;
    console.error(`[openrouter] backing off ${delay}ms before retry #${attempt + 1}`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function extractErrorPayload(body: string): OpenRouterErrorPayload | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as OpenRouterEnvelope;
    if (parsed.error) {
      return parsed.error;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Pull a few high-signal fields out of an OpenRouter response body for
 * logging. Returns `'n/a'` strings on parse failure rather than throwing so
 * the log line never replaces the real error the caller is trying to print.
 */
export function summarizeEnvelopeForLog(rawBody: string): {
  finishReason: string;
  nativeFinishReason: string;
  contentLen: number;
  usage: string;
} {
  try {
    const parsed = JSON.parse(rawBody) as OpenRouterEnvelope & {
      usage?: Record<string, unknown>;
    };
    const choice = parsed.choices?.[0];
    const content = choice?.message?.content;
    const contentLen =
      typeof content === 'string' ? content.length : content == null ? 0 : -1;
    return {
      finishReason: String(choice?.finish_reason ?? 'n/a'),
      nativeFinishReason: String(choice?.native_finish_reason ?? 'n/a'),
      contentLen,
      usage: parsed.usage ? JSON.stringify(parsed.usage) : 'n/a',
    };
  } catch {
    return {
      finishReason: 'parse-error',
      nativeFinishReason: 'parse-error',
      contentLen: -1,
      usage: 'parse-error',
    };
  }
}

function createDefaultFetcher(timeoutMs: number): OpenRouterFetcher {
  return async (url, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.status, body: text };
    } finally {
      clearTimeout(timeout);
    }
  };
}
