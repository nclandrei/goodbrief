import type { ArticleScore, FilterResult, RankingResult, DiscardReason, RankedArticle } from './types.js';

const POSITIVITY_THRESHOLD = 40;
const POSITIVITY_WEIGHT = 0.6;
const IMPACT_WEIGHT = 0.4;

export function filterArticles(articles: ArticleScore[]): FilterResult {
  const passed: ArticleScore[] = [];
  const discarded: DiscardReason[] = [];

  for (const article of articles) {
    if (!article.romaniaRelevant) {
      discarded.push({
        id: article.id,
        reason: 'romaniaRelevant: false',
      });
      continue;
    }

    if (article.positivity < POSITIVITY_THRESHOLD) {
      discarded.push({
        id: article.id,
        reason: `positivity ${article.positivity} < ${POSITIVITY_THRESHOLD}`,
      });
      continue;
    }

    passed.push(article);
  }

  return {
    passed,
    discarded,
    passedCount: passed.length,
    discardedCount: discarded.length,
  };
}

export function rankArticles(
  articles: ArticleScore[],
  selectedCount: number = 10,
  reserveCount: number = 20
): RankingResult {
  const ranked: RankedArticle[] = articles.map((article) => ({
    id: article.id,
    score: article.positivity * POSITIVITY_WEIGHT + article.impact * IMPACT_WEIGHT,
    positivity: article.positivity,
    impact: article.impact,
  }));

  ranked.sort((a, b) => b.score - a.score);

  return {
    selected: ranked.slice(0, selectedCount),
    reserves: ranked.slice(selectedCount, selectedCount + reserveCount),
  };
}
