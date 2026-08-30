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
import {
  LlmOutputError,
  LlmProviderError,
  LlmQuotaError,
} from './provider.js';
import {
  NaturalTitlesPartialError,
  type NaturalTitle,
} from './natural-title-prompt.js';

/**
 * Wraps a primary + fallback pair. Every method tries the primary first;
 * if the primary hits quota, exhausts a retryable transient failure, or
 * returns invalid model output, the call is transparently retried against the
 * fallback provider. Non-retryable request, auth, and configuration errors
 * are rethrown because a different model backend cannot safely repair them.
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
      const reason = getFallbackReason(error);
      if (reason) {
        console.warn(
          `[llm] primary ${this.primary.name} ${reason} on ${op}; falling back to ${this.fallback.name}: ${getErrorMessage(error)}`
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

  async generateNaturalTitles(
    weekId: string,
    articles: ProcessedArticle[]
  ): Promise<NaturalTitle[]> {
    try {
      return await this.primary.generateNaturalTitles(weekId, articles);
    } catch (error) {
      if (error instanceof NaturalTitlesPartialError) {
        return this.completePartialNaturalTitles(weekId, articles, error);
      }
      const reason = getFallbackReason(error);
      if (reason) {
        console.warn(
          `[llm] primary ${this.primary.name} ${reason} on generateNaturalTitles; falling back to ${this.fallback.name}: ${getErrorMessage(error)}`
        );
        return this.fallback.generateNaturalTitles(weekId, articles);
      }
      throw error;
    }
  }

  private async completePartialNaturalTitles(
    weekId: string,
    articles: ProcessedArticle[],
    primaryError: NaturalTitlesPartialError
  ): Promise<NaturalTitle[]> {
    const unresolvedIds = new Set(primaryError.unresolvedArticleIds);
    if (unresolvedIds.size === 0) {
      throw primaryError;
    }
    const unresolvedArticles = articles.filter((article) =>
      unresolvedIds.has(article.id)
    );

    if (unresolvedArticles.length !== unresolvedIds.size) {
      throw primaryError;
    }

    console.warn(
      `[llm] primary ${this.primary.name} returned partial invalid output on generateNaturalTitles; falling back to ${this.fallback.name} for ${unresolvedArticles.length}/${articles.length} unresolved article(s): ${primaryError.unresolvedArticleIds.join(', ')}`
    );

    try {
      const fallbackTitles = await this.fallback.generateNaturalTitles(
        weekId,
        unresolvedArticles
      );
      const merged = mergeNaturalTitlesInArticleOrder(
        articles,
        primaryError.partialTitles,
        fallbackTitles
      );
      const stillUnresolved = articles
        .map((article) => article.id)
        .filter((id) => !merged.some((title) => title.id === id));

      if (stillUnresolved.length > 0) {
        throw new NaturalTitlesPartialError(
          this.fallback.name,
          merged,
          stillUnresolved,
          [`fallback omitted article IDs ${stillUnresolved.join(', ')}`]
        );
      }

      return merged;
    } catch (error) {
      if (error instanceof NaturalTitlesPartialError) {
        throw new NaturalTitlesPartialError(
          error.provider,
          mergeNaturalTitlesInArticleOrder(
            articles,
            primaryError.partialTitles,
            error.partialTitles
          ),
          error.unresolvedArticleIds,
          [...primaryError.diagnostics, ...error.diagnostics],
          { cause: error }
        );
      }
      if (error instanceof LlmOutputError) {
        throw new NaturalTitlesPartialError(
          error.provider,
          primaryError.partialTitles,
          primaryError.unresolvedArticleIds,
          [...primaryError.diagnostics, error.message],
          { cause: error }
        );
      }
      throw error;
    }
  }

  refineDraft(input: RefinementInput): Promise<RefinementResult> {
    return this.run('refineDraft', (provider) => provider.refineDraft(input));
  }
}

function mergeNaturalTitlesInArticleOrder(
  articles: ProcessedArticle[],
  ...titleGroups: NaturalTitle[][]
): NaturalTitle[] {
  const requestedIds = new Set(articles.map((article) => article.id));
  const byId = new Map<string, string>();

  for (const titles of titleGroups) {
    for (const title of titles) {
      if (requestedIds.has(title.id) && !byId.has(title.id)) {
        byId.set(title.id, title.title);
      }
    }
  }

  return articles
    .filter((article) => byId.has(article.id))
    .map((article) => ({
      id: article.id,
      title: byId.get(article.id)!,
    }));
}

function getFallbackReason(error: unknown): string | null {
  if (error instanceof LlmQuotaError) {
    return 'hit quota';
  }
  if (error instanceof LlmOutputError) {
    return 'returned invalid output';
  }
  if (error instanceof LlmProviderError && error.retryable) {
    return 'had a transient failure';
  }
  return null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
