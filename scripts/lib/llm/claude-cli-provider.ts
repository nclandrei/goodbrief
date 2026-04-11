import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { join } from 'path';
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
import type {
  LlmProvider,
  RefinementInput,
  RefinementResult,
  ScoreBatchOptions,
  SemanticDedupResponse,
} from './provider.js';
import { LlmProviderError, LlmQuotaError, isQuotaMessage } from './provider.js';

const DEFAULT_CLAUDE_BIN = process.env.CLAUDE_CLI_BIN || 'claude';
const DEFAULT_MODEL = process.env.CLAUDE_CLI_MODEL || 'opus';
const DEFAULT_FALLBACK_MODEL = process.env.CLAUDE_CLI_FALLBACK_MODEL || 'sonnet';
const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.CLAUDE_CLI_TIMEOUT_MS || '900000',
  10
);

/** Shape of the envelope returned by `claude -p --output-format json`. */
interface ClaudeEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  error?: unknown;
  structured_output?: unknown;
  session_id?: string;
}

/**
 * Parse the stdout emitted by `claude -p --output-format json` (or
 * `--output-format stream-json`) and return the structured payload.
 *
 * Preference order:
 *   1. `structured_output` field (set when `--json-schema` validation passed)
 *   2. `result` field parsed as JSON
 *
 * Throws `LlmQuotaError` if the envelope reports a rate-limit style failure,
 * `LlmProviderError` for any other error or unparseable output.
 */
export function parseClaudeEnvelope<T = unknown>(stdout: string): T {
  const envelope = pickEnvelope(stdout);

  if (envelope.is_error || envelope.subtype === 'error') {
    const errorMessage = formatErrorMessage(envelope);
    if (isQuotaMessage(errorMessage)) {
      throw new LlmQuotaError('claude-cli', errorMessage);
    }
    throw new LlmProviderError('claude-cli', errorMessage);
  }

  if (envelope.structured_output !== undefined) {
    return envelope.structured_output as T;
  }

  if (typeof envelope.result === 'string' && envelope.result.length > 0) {
    try {
      return JSON.parse(envelope.result) as T;
    } catch (error) {
      throw new LlmProviderError(
        'claude-cli',
        `claude result field is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    }
  }

  throw new LlmProviderError(
    'claude-cli',
    `claude envelope has neither structured_output nor a JSON result field: ${JSON.stringify(
      envelope
    ).slice(0, 300)}`
  );
}

function pickEnvelope(stdout: string): ClaudeEnvelope {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new LlmProviderError('claude-cli', 'claude returned empty stdout');
  }

  // Try the simple single-object case first.
  try {
    return JSON.parse(trimmed) as ClaudeEnvelope;
  } catch {
    /* fall through to stream-json parsing */
  }

  // Stream-json: newline-delimited events. Walk backwards to find the last
  // parseable line — that's the final result event after any retries.
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as ClaudeEnvelope;
      if (parsed && (parsed.type === 'result' || parsed.result !== undefined || parsed.structured_output !== undefined)) {
        return parsed;
      }
    } catch {
      // Ignore and keep walking backwards.
    }
  }

  throw new LlmProviderError(
    'claude-cli',
    `Could not parse claude JSON envelope. Raw (first 400 chars): ${trimmed.slice(0, 400)}`
  );
}

function formatErrorMessage(envelope: ClaudeEnvelope): string {
  if (typeof envelope.error === 'string') return envelope.error;
  if (typeof envelope.result === 'string') return envelope.result;
  return 'claude reported an error with no message';
}

/** Signature of the subprocess runner. Injectable for tests. */
export type ClaudeRunner = (prompt: string, args: string[]) => Promise<string>;

export interface ClaudeCliProviderOptions {
  bin?: string;
  defaultModel?: string;
  fallbackModel?: string | null;
  timeoutMs?: number;
  /** For tests: inject a fake runner in place of the real subprocess. */
  runner?: ClaudeRunner;
}

// Anthropic's `--json-schema` requires an object at the top level, but the
// shared score schema is an array. Wrap it in a `{ scores: [...] }` envelope
// for the claude-cli path and unwrap after parsing.
function wrapScoreSchema(includeReasoning: boolean): unknown {
  return {
    type: 'object',
    properties: {
      scores: getArticleScoreSchema(includeReasoning),
    },
    required: ['scores'],
  };
}

const SCORE_RESPONSE_SCHEMA_CACHE = {
  withReasoning: wrapScoreSchema(true),
  withoutReasoning: wrapScoreSchema(false),
};

const SEMANTIC_DEDUP_RESPONSE_SCHEMA = {
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

const COUNTER_SIGNAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['none', 'borderline', 'strong'] },
    reason: { type: 'string' },
    relatedArticleIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'reason', 'relatedArticleIds'],
};

const WRAPPER_COPY_RESPONSE_SCHEMA = {
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
 * Claude Code headless provider.
 *
 * Shells out to `claude -p --output-format json --json-schema <schema>
 * --tools ""` for each pipeline step. No Anthropic API key is required: the
 * CLI authenticates through the user's existing Claude Code credentials
 * (subscription OAuth or `CLAUDE_CODE_OAUTH_TOKEN`).
 *
 * Why the flags:
 *   - `--json-schema` gives us the same guarantees Gemini's `responseSchema`
 *     mode provides — validated output lands in `structured_output`.
 *   - `--tools ""` disables all tool use so the model only generates text.
 *   - `--fallback-model` covers transient "model overloaded" errors.
 *   - Prompts are piped via stdin to avoid argv length limits on the ~400-
 *     line refine prompt.
 */
export class ClaudeCliProvider implements LlmProvider {
  readonly name = 'claude-cli' as const;

  private readonly bin: string;
  private readonly defaultModel: string;
  private readonly fallbackModel: string | null;
  private readonly timeoutMs: number;
  private readonly runner: ClaudeRunner;

  constructor(options: ClaudeCliProviderOptions = {}) {
    this.bin = options.bin ?? DEFAULT_CLAUDE_BIN;
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.fallbackModel =
      options.fallbackModel === undefined
        ? DEFAULT_FALLBACK_MODEL
        : options.fallbackModel;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.runner = options.runner ?? this.createDefaultRunner();
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

OUTPUT RULES (Claude Code headless mode):
- Respond with ONLY a JSON object of shape { "scores": [ ... ] }.
- The "scores" array MUST contain exactly one object per input article ID.
- No markdown, no code fences, no prose before or after the JSON.`;

    const schema = options.includeReasoning
      ? SCORE_RESPONSE_SCHEMA_CACHE.withReasoning
      : SCORE_RESPONSE_SCHEMA_CACHE.withoutReasoning;

    const stdout = await this.callClaude(prompt, {
      label: 'score',
      schema,
      model: process.env.CLAUDE_CLI_SCORE_MODEL || 'sonnet',
    });

    const parsed = parseClaudeEnvelope<{ scores?: unknown }>(stdout);
    const scores = parsed?.scores;
    if (!Array.isArray(scores)) {
      throw new LlmProviderError(
        'claude-cli',
        `scoreArticles: expected { scores: [...] }, got ${typeof parsed}`
      );
    }

    const sentIds = new Set(articles.map((article) => article.id));
    return (scores as ArticleScore[])
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

OUTPUT RULES (Claude Code headless mode):
- Respond with ONLY a JSON object of shape { "groups": [{ "ids": [...], "reason": "..." }] }.
- No markdown, no code fences.
- If no duplicates are found, return { "groups": [] }.`;

    const stdout = await this.callClaude(prompt, {
      label: 'semantic-dedup',
      schema: SEMANTIC_DEDUP_RESPONSE_SCHEMA,
    });

    const parsed = parseClaudeEnvelope<SemanticDedupResponse>(stdout);
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

OUTPUT RULES (Claude Code headless mode):
- Respond with ONLY the JSON object described above.
- "reason" MUST be in Romanian.
- No markdown, no code fences.`;

    const stdout = await this.callClaude(prompt, {
      label: 'counter-signal',
      schema: COUNTER_SIGNAL_RESPONSE_SCHEMA,
    });

    const parsed = parseClaudeEnvelope<CounterSignalClassifierResult>(stdout);
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

OUTPUT RULES (Claude Code headless mode):
- Respond with ONLY the JSON object described above.
- No markdown, no code fences.
- All Romanian text must use informal "tu", never "dumneavoastră".`;

    const stdout = await this.callClaude(prompt, {
      label: 'wrapper-copy',
      schema: WRAPPER_COPY_RESPONSE_SCHEMA,
    });

    const parsed = parseClaudeEnvelope<Partial<WrapperCopy>>(stdout);
    if (!parsed || !parsed.greeting || !parsed.intro || !parsed.signOff) {
      throw new LlmProviderError(
        'claude-cli',
        `generateWrapperCopy: missing required fields in response (got: ${Object.keys(
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

OUTPUT RULES (Claude Code headless mode):
- Respond with ONLY the JSON object described above.
- Keys: selectedIds (array of 9-12 strings), intro (Romanian), shortSummary (Romanian), reasoning (Romanian).
- No markdown, no code fences.`;

    const stdout = await this.callClaude(prompt, {
      label: 'refine',
      schema: refineResponseSchema,
      model: process.env.CLAUDE_CLI_REFINE_MODEL || this.defaultModel,
    });

    const parsed = parseClaudeEnvelope<Partial<RefinementResult>>(stdout);
    if (!parsed || !Array.isArray(parsed.selectedIds)) {
      throw new LlmProviderError(
        'claude-cli',
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

  // --- shared call path ---

  private async callClaude(
    prompt: string,
    options: {
      label: string;
      schema: unknown;
      model?: string;
    }
  ): Promise<string> {
    const model = options.model ?? this.defaultModel;
    const args = [
      '-p',
      '--output-format',
      'json',
      '--tools',
      '',
      '--model',
      model,
      '--json-schema',
      JSON.stringify(options.schema),
    ];
    // claude rejects --fallback-model when it matches the main model, so only
    // attach it when the two differ. Phases like `score` pin themselves to
    // `sonnet`, which collides with the default fallback of `sonnet`.
    if (this.fallbackModel && this.fallbackModel !== model) {
      args.push('--fallback-model', this.fallbackModel);
    }

    try {
      return await this.runner(prompt, args);
    } catch (error) {
      if (error instanceof LlmProviderError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (isQuotaMessage(message)) {
        throw new LlmQuotaError('claude-cli', message, { cause: error });
      }
      throw new LlmProviderError('claude-cli', message, { cause: error });
    }
  }

  private createDefaultRunner(): ClaudeRunner {
    return async (prompt: string, args: string[]): Promise<string> => {
      const promptFile = join(
        tmpdir(),
        `goodbrief-claude-${randomBytes(4).toString('hex')}.prompt`
      );
      await fs.writeFile(promptFile, prompt, 'utf-8');

      console.log(
        `[claude-cli] model=${extractArg(args, '--model')} prompt=${promptFile} (${prompt.length} chars)`
      );

      try {
        const { stdout, stderr, code } = await spawnAndCollect(
          this.bin,
          args,
          prompt,
          this.timeoutMs
        );

        if (code !== 0) {
          const errText = stderr.trim() || stdout.trim();
          if (isQuotaMessage(errText)) {
            throw new LlmQuotaError(
              'claude-cli',
              errText || 'claude returned non-zero exit with quota-like error'
            );
          }
          throw new LlmProviderError(
            'claude-cli',
            `claude exited with code ${code}: ${errText}`
          );
        }

        return stdout;
      } finally {
        if (!process.env.GOODBRIEF_KEEP_CLAUDE_PROMPTS) {
          await fs.unlink(promptFile).catch(() => {
            /* best-effort */
          });
        }
      }
    };
  }
}

function extractArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function spawnAndCollect(
  bin: string,
  args: string[],
  stdin: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref();
      reject(
        new LlmProviderError(
          'claude-cli',
          `claude invocation exceeded ${timeoutMs}ms`
        )
      );
    }, timeoutMs);
    timeout.unref?.();

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', (error) => {
      clearTimeout(timeout);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new LlmProviderError(
            'claude-cli',
            `claude CLI not found on PATH (looked for "${bin}"). Install Claude Code or set CLAUDE_CLI_BIN.`
          )
        );
        return;
      }
      reject(
        new LlmProviderError('claude-cli', error.message, { cause: error })
      );
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        code,
      });
    });

    // Without an error listener, an EPIPE on stdin (claude closed its stdin
    // before we finished writing) becomes an unhandled 'error' event and
    // crashes the whole pipeline. Swallow EPIPE here and let the `close`
    // handler surface claude's real exit code + stderr instead.
    proc.stdin.on('error', (error) => {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'EPIPE') return;
      clearTimeout(timeout);
      reject(
        new LlmProviderError('claude-cli', error.message, { cause: error })
      );
    });

    // `end(payload)` writes + closes in one shot and handles backpressure
    // properly (the previous `write` + immediate `end` could race for large
    // prompts).
    proc.stdin.end(stdin);
  });
}
