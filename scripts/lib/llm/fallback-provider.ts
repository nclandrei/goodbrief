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
import { LlmOutputError, LlmQuotaError } from './provider.js';
import type { NaturalTitle } from './natural-title-prompt.js';

/**
 * Wraps a primary + fallback pair. Every method tries the primary first;
 * if the primary hits quota or returns invalid model output, the call is
 * transparently retried against the fallback provider. Request, auth, and
 * other operational errors are rethrown because a different model backend
 * cannot safely repair them.
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
      if (
        error instanceof LlmQuotaError ||
        error instanceof LlmOutputError
      ) {
        const reason =
          error instanceof LlmQuotaError
            ? 'hit quota'
            : 'returned invalid output';
        console.warn(
          `[llm] primary ${this.primary.name} ${reason} on ${op}; falling back to ${this.fallback.name}: ${error.message}`
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

  generateNaturalTitles(
    weekId: string,
    articles: ProcessedArticle[]
  ): Promise<NaturalTitle[]> {
    return this.run('generateNaturalTitles', (provider) =>
      provider.generateNaturalTitles(weekId, articles)
    );
  }

  refineDraft(input: RefinementInput): Promise<RefinementResult> {
    return this.run('refineDraft', (provider) => provider.refineDraft(input));
  }
}
