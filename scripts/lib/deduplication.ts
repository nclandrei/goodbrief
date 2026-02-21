import { distance } from 'fastest-levenshtein';
import type { RawArticle } from '../types.js';
import type { DeduplicationResult, DeduplicationCluster } from './types.js';

const INTRA_WEEK_SIMILARITY_THRESHOLD = 0.7;
const CROSS_WEEK_TITLE_SIMILARITY_THRESHOLD = 0.74;
const CROSS_WEEK_TOKEN_OVERLAP_THRESHOLD = 0.5;
const MIN_COMMON_TOKENS_FOR_OVERLAP = 3;

const TITLE_STOPWORDS = new Set([
  'a',
  'ai',
  'al',
  'ale',
  'au',
  'ca',
  'care',
  'ce',
  'cu',
  'de',
  'din',
  'doar',
  'este',
  'fost',
  'in',
  'la',
  'mai',
  'nu',
  'pe',
  'pentru',
  'prin',
  'se',
  'si',
  'sunt',
  'un',
  'una',
  'unui',
  'unei',
  'vor',
]);

export interface HistoricalArticleCandidate {
  id?: string;
  title: string;
  url: string;
}

type CrossWeekDuplicateReason =
  | 'id-match'
  | 'url-match'
  | 'title-similarity'
  | 'token-overlap';

export interface CrossWeekDuplicateMatch {
  reason: CrossWeekDuplicateReason;
  previousTitle: string;
  previousUrl: string;
  titleSimilarity: number;
  tokenOverlap: number;
}

export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeTitle(title: string): string {
  return stripDiacritics(title)
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

export function tokenizeTitle(title: string): string[] {
  return normalizeTitle(title)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !TITLE_STOPWORDS.has(token));
}

export function tokenOverlap(a: string, b: string): { score: number; commonTokens: number } {
  const tokensA = new Set(tokenizeTitle(a));
  const tokensB = new Set(tokenizeTitle(b));

  if (tokensA.size === 0 || tokensB.size === 0) {
    return { score: 0, commonTokens: 0 };
  }

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }

  const unionSize = new Set([...tokensA, ...tokensB]).size;
  return {
    score: unionSize === 0 ? 0 : intersection / unionSize,
    commonTokens: intersection,
  };
}

export function canonicalizeStoryUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    const cleanPath = stripDiacritics(decodeURIComponent(parsed.pathname || '/'))
      .toLowerCase()
      .replace(/\/+$/, '')
      .replace(/[^a-z0-9/_-]/g, '');

    return `${hostname}${cleanPath || '/'}`;
  } catch {
    return '';
  }
}

export function findCrossWeekDuplicate(
  article: Pick<RawArticle, 'id' | 'title' | 'url'>,
  historicalArticles: HistoricalArticleCandidate[]
): CrossWeekDuplicateMatch | null {
  const articleCanonicalUrl = canonicalizeStoryUrl(article.url);
  let bestMatch: CrossWeekDuplicateMatch | null = null;
  let bestStrength = 0;

  for (const previous of historicalArticles) {
    if (previous.id && previous.id === article.id) {
      return {
        reason: 'id-match',
        previousTitle: previous.title,
        previousUrl: previous.url,
        titleSimilarity: 1,
        tokenOverlap: 1,
      };
    }

    const previousCanonicalUrl = canonicalizeStoryUrl(previous.url);
    if (
      articleCanonicalUrl &&
      previousCanonicalUrl &&
      articleCanonicalUrl === previousCanonicalUrl
    ) {
      return {
        reason: 'url-match',
        previousTitle: previous.title,
        previousUrl: previous.url,
        titleSimilarity: titleSimilarity(article.title, previous.title),
        tokenOverlap: tokenOverlap(article.title, previous.title).score,
      };
    }

    const similarity = titleSimilarity(article.title, previous.title);
    const overlap = tokenOverlap(article.title, previous.title);

    const isTitleMatch = similarity >= CROSS_WEEK_TITLE_SIMILARITY_THRESHOLD;
    const isTokenOverlapMatch =
      overlap.score >= CROSS_WEEK_TOKEN_OVERLAP_THRESHOLD &&
      overlap.commonTokens >= MIN_COMMON_TOKENS_FOR_OVERLAP;

    if (!isTitleMatch && !isTokenOverlapMatch) {
      continue;
    }

    const reason: CrossWeekDuplicateReason = isTitleMatch
      ? 'title-similarity'
      : 'token-overlap';
    const strength = Math.max(similarity, overlap.score);

    if (strength > bestStrength) {
      bestStrength = strength;
      bestMatch = {
        reason,
        previousTitle: previous.title,
        previousUrl: previous.url,
        titleSimilarity: similarity,
        tokenOverlap: overlap.score,
      };
    }
  }

  return bestMatch;
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
      if (similarity >= INTRA_WEEK_SIMILARITY_THRESHOLD) {
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
