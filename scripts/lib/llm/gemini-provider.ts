import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ProcessedArticle, RawArticle } from '../../types.js';
import type { ArticleScore } from '../types.js';
import type {
  CounterSignalClassifierInput,
  CounterSignalClassifierResult,
} from '../counter-signal-validation.js';
import type { WrapperCopy } from '../../../emails/utils/generate-copy.js';
import {
  buildWrapperCopyPrompt,
  generateWrapperCopy as geminiGenerateWrapperCopy,
} from '../../../emails/utils/generate-copy.js';
import {
  DEFAULT_GEMINI_MODEL,
  GeminiQuotaError,
  callWithRetry,
  createGeminiModel,
  formatArticlesForScoring,
  getArticleScoreSchema,
  getScoringPrompt,
  processArticleBatch,
  withDefaultSignals,
} from '../gemini.js';
import { createGeminiCounterSignalClassifier } from '../counter-signal-validation.js';
import {
  deduplicateProcessedArticlesSemantically,
} from '../semantic-dedup.js';
import { buildRefinePrompt, refineResponseSchema } from './refine-prompt.js';
import type {
  LlmProvider,
  RefinementInput,
  RefinementResult,
  ScoreBatchOptions,
  SemanticDedupResponse,
} from './provider.js';
import { LlmQuotaError } from './provider.js';

function wrapQuotaError(error: unknown): never {
  if (error instanceof GeminiQuotaError) {
    throw new LlmQuotaError('gemini', error.message, { cause: error });
  }
  throw error;
}

/**
 * Adapter that exposes the existing Gemini codepaths through the LlmProvider
 * interface. It is a thin wrapper: the underlying prompts, schemas, batching
 * behavior, and mock-file env hooks are unchanged.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async scoreArticles(
    articles: RawArticle[],
    options: ScoreBatchOptions
  ): Promise<ArticleScore[]> {
    // Honor the long-standing GOODBRIEF_GEMINI_SCORES_PATH mock hook and the
    // GOODBRIEF_SCORE_MOCK_FILE hook (both are used by existing tests).
    if (process.env.GOODBRIEF_GEMINI_SCORES_PATH) {
      return processArticleBatch(articles, null, options.includeReasoning);
    }

    const model = createGeminiModel(this.apiKey, options.includeReasoning);
    try {
      return await processArticleBatch(articles, model, options.includeReasoning);
    } catch (error) {
      wrapQuotaError(error);
    }
  }

  async semanticDedup(
    weekId: string,
    articles: ProcessedArticle[]
  ): Promise<SemanticDedupResponse> {
    try {
      const result = await deduplicateProcessedArticlesSemantically(
        articles,
        this.apiKey,
        weekId
      );
      return {
        groups: result.clusters.map((cluster) => ({
          ids: [cluster.keepId, ...cluster.dropIds],
          reason: cluster.reason,
        })),
      };
    } catch (error) {
      wrapQuotaError(error);
    }
  }

  async classifyCounterSignal(
    input: CounterSignalClassifierInput
  ): Promise<CounterSignalClassifierResult> {
    const classifier = createGeminiCounterSignalClassifier(this.apiKey);
    try {
      return await classifier(input);
    } catch (error) {
      wrapQuotaError(error);
    }
  }

  async generateWrapperCopy(
    weekId: string,
    articles: ProcessedArticle[]
  ): Promise<WrapperCopy> {
    // Honor GOODBRIEF_WRAPPER_COPY_PATH mock file handled inside the helper.
    try {
      // The existing helper reads GEMINI_API_KEY directly from env; set it for
      // the duration of the call if the provider was constructed with a
      // different value. In the usual case they match.
      if (!process.env.GEMINI_API_KEY) {
        process.env.GEMINI_API_KEY = this.apiKey;
      }
      return await geminiGenerateWrapperCopy(articles, weekId);
    } catch (error) {
      wrapQuotaError(error);
    }
  }

  async refineDraft(input: RefinementInput): Promise<RefinementResult> {
    try {
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const model = genAI.getGenerativeModel({
        model: DEFAULT_GEMINI_MODEL,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: refineResponseSchema,
        } as any,
      });

      const result = await callWithRetry(async () => {
        const response = await model.generateContent(input.prompt);
        const text = response.response.text();
        if (!text) {
          throw new Error('Empty refine response');
        }
        return JSON.parse(text) as RefinementResult;
      });

      return result;
    } catch (error) {
      wrapQuotaError(error);
    }
  }
}

// Re-export for downstream consumers that want the shared prompt builders
export {
  buildRefinePrompt,
  buildWrapperCopyPrompt,
  formatArticlesForScoring,
  getArticleScoreSchema,
  getScoringPrompt,
  withDefaultSignals,
};
