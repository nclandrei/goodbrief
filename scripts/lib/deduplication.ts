import { distance } from 'fastest-levenshtein';
import type { RawArticle } from '../types.js';
import type { DeduplicationResult, DeduplicationCluster } from './types.js';

const SIMILARITY_THRESHOLD = 0.7;

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleSimilarity(a: string, b: string): number {
  const normA = normalizeTitle(a);
  const normB = normalizeTitle(b);
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1;
  return 1 - distance(normA, normB) / maxLen;
}

export function deduplicateArticles(articles: RawArticle[]): DeduplicationResult {
  const groups: RawArticle[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < articles.length; i++) {
    if (assigned.has(i)) continue;

    const group: RawArticle[] = [articles[i]];
    assigned.add(i);

    for (let j = i + 1; j < articles.length; j++) {
      if (assigned.has(j)) continue;

      const similarity = titleSimilarity(articles[i].title, articles[j].title);
      if (similarity >= SIMILARITY_THRESHOLD) {
        group.push(articles[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  const clusters: DeduplicationCluster[] = [];
  const representatives: RawArticle[] = [];

  for (const group of groups) {
    const best = group.reduce((best, current) => {
      const bestScore =
        best.summary.length + new Date(best.publishedAt).getTime() / 1e12;
      const currentScore =
        current.summary.length + new Date(current.publishedAt).getTime() / 1e12;
      return currentScore > bestScore ? current : best;
    });

    representatives.push(best);

    if (group.length > 1) {
      const merged = group.filter((a) => a.id !== best.id).map((a) => a.id);
      const maxSimilarity = group
        .filter((a) => a.id !== best.id)
        .reduce((max, a) => {
          const sim = titleSimilarity(best.title, a.title);
          return sim > max ? sim : max;
        }, 0);

      clusters.push({
        kept: best.id,
        merged,
        similarity: Math.round(maxSimilarity * 100) / 100,
      });
    }
  }

  return {
    outputArticles: representatives,
    clusters,
    inputCount: articles.length,
    outputCount: representatives.length,
  };
}
