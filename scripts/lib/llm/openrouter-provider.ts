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
import { LlmProviderError, LlmQuotaError, isQuotaMessage } from './provider.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';
const DEFAULT_REFERER =
  process.env.OPENROUTER_HTTP_REFERER || 'https://goodbrief.ro';
const DEFAULT_APP_TITLE = process.env.OPENROUTER_APP_TITLE || 'Good Brief';
const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.OPENROUTER_TIMEOUT_MS || '120000',
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
}

interface OpenRouterChoice {
  index?: number;
  message?: OpenRouterChoiceMessage;
  finish_reason?: string;
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

  const content = envelope.choices[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new LlmProviderError(
      'openrouter',
      `OpenRouter response content is empty or non-string: ${JSON.stringify(
        envelope.choices[0]
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
    this.fetcher = options.fetcher ?? createDefaultFetcher(this.timeoutMs);
  }

  async scoreArticles(
    articles: RawArticle[],
    options: ScoreBatchOptions
  ): Promise<ArticleScore[]> {
    if (articles.length === 0) {
      return [];
    }

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

    let response: OpenRouterHttpResponse;
    try {
      response = await this.fetcher(OPENROUTER_URL, {
        method: 'POST',
        headers,
        body,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isQuotaMessage(message)) {
        throw new LlmQuotaError('openrouter', message, { cause: error });
      }
      throw new LlmProviderError('openrouter', message, { cause: error });
    }

    if (response.status >= 200 && response.status < 300) {
      return response.body;
    }

    const message = extractErrorMessage(response.body) ||
      `OpenRouter HTTP ${response.status}`;

    if (isQuotaStatusCode(response.status) || isQuotaMessage(message)) {
      throw new LlmQuotaError('openrouter', message);
    }
    throw new LlmProviderError(
      'openrouter',
      `OpenRouter HTTP ${response.status}: ${message}`
    );
  }
}

function extractErrorMessage(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as OpenRouterEnvelope;
    if (parsed.error && typeof parsed.error.message === 'string') {
      return parsed.error.message;
    }
  } catch {
    /* ignore */
  }
  return body.slice(0, 300);
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
