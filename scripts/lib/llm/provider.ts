import type { ProcessedArticle, RawArticle } from '../../types.js';
import type { ArticleScore } from '../types.js';
import type {
  CounterSignalClassifierInput,
  CounterSignalClassifierResult,
} from '../counter-signal-validation.js';
import type { WrapperCopy } from '../../../emails/utils/generate-copy.js';

export type LlmProviderName = 'gemini' | 'claude-cli' | 'openrouter';

export interface RefinementInput {
  weekId: string;
  prompt: string;
}

export interface RefinementResult {
  selectedIds: string[];
  intro: string;
  shortSummary: string;
  reasoning: string;
}

export interface SemanticDedupGroupResponse {
  ids: string[];
  reason: string;
}

export interface SemanticDedupResponse {
  groups: SemanticDedupGroupResponse[];
}

export interface ScoreBatchOptions {
  includeReasoning: boolean;
}

/**
 * Minimal LLM capability surface used by the Good Brief draft pipeline.
 *
 * Every method returns data in the exact JSON shape the downstream phases
 * already consume, so switching providers is transparent to the rest of the
 * codebase. Providers must throw `LlmQuotaError` on any quota/rate-limit
 * style failure so the caller can surface an alert or fall back.
 */
export interface LlmProvider {
  readonly name: LlmProviderName;
  scoreArticles(
    articles: RawArticle[],
    options: ScoreBatchOptions
  ): Promise<ArticleScore[]>;
  semanticDedup(
    weekId: string,
    articles: ProcessedArticle[]
  ): Promise<SemanticDedupResponse>;
  classifyCounterSignal(
    input: CounterSignalClassifierInput
  ): Promise<CounterSignalClassifierResult>;
  generateWrapperCopy(
    weekId: string,
    articles: ProcessedArticle[]
  ): Promise<WrapperCopy>;
  refineDraft(input: RefinementInput): Promise<RefinementResult>;
}

export class LlmProviderError extends Error {
  readonly provider: LlmProviderName;
  readonly retryable: boolean;

  constructor(
    provider: LlmProviderName,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'LlmProviderError';
    this.provider = provider;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Thrown when the underlying provider is out of quota, rate-limited, or has
 * had its access revoked. Always non-retryable for the originating provider,
 * but a higher layer may fall back to a different provider.
 */
export class LlmQuotaError extends LlmProviderError {
  constructor(
    provider: LlmProviderName,
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(provider, message, { retryable: false, cause: options.cause });
    this.name = 'LlmQuotaError';
  }
}

export function isQuotaMessage(raw: unknown): boolean {
  const text = String(raw instanceof Error ? raw.message : raw).toLowerCase();
  return (
    text.includes('quota') ||
    text.includes('rate limit') ||
    text.includes('rate_limit') ||
    text.includes('resource exhausted') ||
    text.includes('429') ||
    text.includes('403') ||
    text.includes('overloaded') ||
    text.includes('credit balance') ||
    text.includes('usage limit')
  );
}
