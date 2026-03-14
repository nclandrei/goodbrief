import type { ArticleScore, FilterResult, RankingResult, DiscardReason, RankedArticle } from './types.js';

const POSITIVITY_THRESHOLD = 40;
export const POSITIVITY_WEIGHT = 0.35;
export const IMPACT_WEIGHT = 0.15;
export const FELT_IMPACT_WEIGHT = 0.25;
export const CERTAINTY_WEIGHT = 0.1;
export const HUMAN_CLOSENESS_WEIGHT = 0.1;
export const BUREAUCRATIC_DISTANCE_WEIGHT = 0.12;
export const PROMO_RISK_WEIGHT = 0.08;

type EditorialSignals = Pick<
  ArticleScore,
  | 'positivity'
  | 'impact'
  | 'category'
  | 'feltImpact'
  | 'certainty'
  | 'humanCloseness'
  | 'bureaucraticDistance'
  | 'promoRisk'
>;

const DEFAULTS_BY_CATEGORY: Record<
  NonNullable<ArticleScore['category']>,
  {
    feltImpact: number;
    certainty: number;
    humanCloseness: number;
    bureaucraticDistance: number;
    promoRisk: number;
  }
> = {
  'green-stuff': {
    feltImpact: 75,
    certainty: 78,
    humanCloseness: 70,
    bureaucraticDistance: 24,
    promoRisk: 12,
  },
  'local-heroes': {
    feltImpact: 82,
    certainty: 80,
    humanCloseness: 88,
    bureaucraticDistance: 12,
    promoRisk: 10,
  },
  wins: {
    feltImpact: 58,
    certainty: 66,
    humanCloseness: 42,
    bureaucraticDistance: 36,
    promoRisk: 22,
  },
  'quick-hits': {
    feltImpact: 62,
    certainty: 72,
    humanCloseness: 60,
    bureaucraticDistance: 28,
    promoRisk: 16,
  },
};

function getDefaults(article: EditorialSignals) {
  return DEFAULTS_BY_CATEGORY[article.category];
}

function getSignal(
  value: number | undefined,
  fallback: number
): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, value));
}

function getBureaucraticLanguagePenalty(article: Pick<ArticleScore, 'summary'> & Partial<{
  originalTitle: string;
}>): number {
  const text = `${article.originalTitle || ''} ${article.summary || ''}`.toLowerCase();
  const riskMatches = [
    /\bar putea\b/u,
    /\bapel(?:ul)?\b/u,
    /\bgrant(?:uri)?\b/u,
    /\bfinan(?:ț|t)are\b/u,
    /\bfond(?:uri)?\b/u,
    /\b(program|schema|strategie)\b/u,
    /\b(î|i)nscrieri\b/u,
    /\banun(?:ț|t)(?:ă|a)\b/u,
    /\bministrul\b/u,
    /\bministerul\b/u,
  ].filter((pattern) => pattern.test(text)).length;

  return Math.min(10, riskMatches * 2);
}

export function getRankingScore(
  article: EditorialSignals & Pick<ArticleScore, 'summary'> & Partial<{ originalTitle: string }>
): number {
  const defaults = getDefaults(article);
  const feltImpact = getSignal(article.feltImpact, defaults.feltImpact);
  const certainty = getSignal(article.certainty, defaults.certainty);
  const humanCloseness = getSignal(article.humanCloseness, defaults.humanCloseness);
  const bureaucraticDistance = getSignal(
    article.bureaucraticDistance,
    defaults.bureaucraticDistance
  );
  const promoRisk = getSignal(article.promoRisk, defaults.promoRisk);
  const languagePenalty = getBureaucraticLanguagePenalty(article);

  return (
    article.positivity * POSITIVITY_WEIGHT +
    article.impact * IMPACT_WEIGHT +
    feltImpact * FELT_IMPACT_WEIGHT +
    certainty * CERTAINTY_WEIGHT +
    humanCloseness * HUMAN_CLOSENESS_WEIGHT -
    bureaucraticDistance * BUREAUCRATIC_DISTANCE_WEIGHT -
    promoRisk * PROMO_RISK_WEIGHT -
    languagePenalty
  );
}

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
    score: getRankingScore(article),
    positivity: article.positivity,
    impact: article.impact,
  }));

  ranked.sort((a, b) => b.score - a.score);

  return {
    selected: ranked.slice(0, selectedCount),
    reserves: ranked.slice(selectedCount, selectedCount + reserveCount),
  };
}
