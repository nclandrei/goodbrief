import type { RawArticle, ArticleCategory } from '../types.js';

export interface ArticleScore {
  id: string;
  summary: string;
  positivity: number;
  impact: number;
  romaniaRelevant: boolean;
  category: ArticleCategory;
  reasoning?: string;
}

export interface DeduplicationCluster {
  kept: string;
  merged: string[];
  similarity: number;
}

export interface DeduplicationResult {
  outputArticles: RawArticle[];
  clusters: DeduplicationCluster[];
  inputCount: number;
  outputCount: number;
}

export interface GeminiArticleResult extends ArticleScore {
  title: string;
}

export interface GeminiResult {
  articles: GeminiArticleResult[];
}

export interface DiscardReason {
  id: string;
  reason: string;
}

export interface FilterResult {
  passed: ArticleScore[];
  discarded: DiscardReason[];
  passedCount: number;
  discardedCount: number;
}

export interface RankedArticle {
  id: string;
  score: number;
  positivity: number;
  impact: number;
}

export interface RankingResult {
  selected: RankedArticle[];
  reserves: RankedArticle[];
}

export interface PipelineStages {
  input: {
    count: number;
    articles: Array<{ id: string; title: string }>;
  };
  deduplication: {
    inputCount: number;
    outputCount: number;
    clusters: DeduplicationCluster[];
  };
  gemini: {
    articles: GeminiArticleResult[];
  };
  filtering: {
    passed: number;
    discarded: number;
    discardReasons: DiscardReason[];
  };
  ranking: {
    selected: RankedArticle[];
    reserves: RankedArticle[];
  };
}

export interface PipelineSummary {
  inputArticles: number;
  afterDedup: number;
  afterGemini: number;
  afterFiltering: number;
  selected: number;
  reserves: number;
}

export interface PipelineTrace {
  timestamp: string;
  config: {
    limit: number;
    cached: boolean;
    weekId: string;
  };
  stages: PipelineStages;
  summary: PipelineSummary;
}

export interface GeminiOptions {
  useCache: boolean;
  cachePath: string;
  includeReasoning: boolean;
}

export interface GeminiCacheEntry extends ArticleScore {
  cachedAt: string;
}

export type GeminiCache = Record<string, GeminiCacheEntry>;
