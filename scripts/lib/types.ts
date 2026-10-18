import type { RawArticle } from '../types.js';

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
