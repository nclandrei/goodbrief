import type { ProcessedArticle, RawArticle } from '../../types.js';
import type { ArticleScore } from '../types.js';
import type {
  CounterSignalClassifierInput,
  CounterSignalClassifierResult,
} from '../counter-signal-validation.js';
import type { WrapperCopy } from '../../../emails/utils/generate-copy.js';
import type {
  LlmProvider,
  LlmProviderName,
  RefinementInput,
  RefinementResult,
  ScoreBatchOptions,
  SemanticDedupResponse,
} from './provider.js';
import { LlmQuotaError } from './provider.js';

/**
 * Wraps a primary + fallback pair. Every method tries the primary first;
 * if the primary throws `LlmQuotaError`, the call is transparently retried
 * against the fallback provider. Any other error (invalid request, parse
 * failure, etc.) is rethrown without touching the fallback — those failures
 * would just repeat on a different backend.
 */
export class FallbackLlmProvider implements LlmProvider {
  readonly primary: LlmProvider;
  readonly fallback: LlmProvider;
  readonly name: LlmProviderName;

  constructor(primary: LlmProvider, fallback: LlmProvider) {
    this.primary = primary;
    this.fallback = fallback;
    this.name = primary.name;
  }

  private async run<T>(
    op: string,
    fn: (provider: LlmProvider) => Promise<T>
  ): Promise<T> {
    try {
      return await fn(this.primary);
    } catch (error) {
      if (error instanceof LlmQuotaError) {
        console.warn(
          `[llm] primary ${this.primary.name} hit quota on ${op}; falling back to ${this.fallback.name}`
        );
        return await fn(this.fallback);
      }
      throw error;
    }
  }

  scoreArticles(
    articles: RawArticle[],
    options: ScoreBatchOptions
  ): Promise<ArticleScore[]> {
    return this.run('scoreArticles', (provider) =>
      provider.scoreArticles(articles, options)
    );
  }

  semanticDedup(
    weekId: string,
    articles: ProcessedArticle[]
  ): Promise<SemanticDedupResponse> {
    return this.run('semanticDedup', (provider) =>
      provider.semanticDedup(weekId, articles)
    );
  }

  classifyCounterSignal(
    input: CounterSignalClassifierInput
  ): Promise<CounterSignalClassifierResult> {
    return this.run('classifyCounterSignal', (provider) =>
      provider.classifyCounterSignal(input)
    );
  }

  generateWrapperCopy(
    weekId: string,
    articles: ProcessedArticle[]
  ): Promise<WrapperCopy> {
    return this.run('generateWrapperCopy', (provider) =>
      provider.generateWrapperCopy(weekId, articles)
    );
  }

  refineDraft(input: RefinementInput): Promise<RefinementResult> {
    return this.run('refineDraft', (provider) => provider.refineDraft(input));
  }
}
