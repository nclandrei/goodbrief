import type { DraftValidation, ProcessedArticle } from '../types.js';
import { getRankingScore } from './ranking.js';

const MAX_SELECTED_PER_NICHE_SOURCE = 2;
const MAX_SELECTED_NICHE_INSTITUTIONAL = 3;
const MAX_SELECTED_BUREAUCRATIC = 2;
const MIN_SELECTED_COMMUNITY = 2;
const MIN_SELECTED_GREEN = 1;
const CANDIDATE_SCORE_DELTA_FOR_FLOORS = 18;

const NICHE_INSTITUTIONAL_SOURCES = new Set([
  'economedia',
  'edupedu',
  'startup-ro',
  'startupcafe',
]);

function getValidationPenalty(articleId: string, validation: DraftValidation): number {
  return validation.flagged.find((flag) => flag.candidateId === articleId)?.penaltyApplied || 0;
}

function getAdjustedScore(article: ProcessedArticle, validation: DraftValidation): number {
  return getRankingScore(article) - getValidationPenalty(article.id, validation);
}

export function isNicheInstitutionalSource(article: ProcessedArticle): boolean {
  return NICHE_INSTITUTIONAL_SOURCES.has(article.sourceId);
}

export function isBureaucraticStory(article: ProcessedArticle): boolean {
  return (
    (article.bureaucraticDistance || 0) >= 70 &&
    ((article.certainty || 0) < 60 || (article.promoRisk || 0) >= 70)
  );
}

export function isCommunityCentered(article: ProcessedArticle): boolean {
  return (
    article.category === 'local-heroes' ||
    (article.humanCloseness || 0) >= 75 ||
    ((article.feltImpact || 0) >= 72 && (article.certainty || 0) >= 65)
  );
}

export function isGreenPreferred(article: ProcessedArticle): boolean {
  return article.category === 'green-stuff';
}

function countSelectedBySource(selected: ProcessedArticle[], sourceId: string): number {
  return selected.filter((article) => article.sourceId === sourceId).length;
}

function countSelectedByPredicate(
  selected: ProcessedArticle[],
  predicate: (article: ProcessedArticle) => boolean
): number {
  return selected.filter(predicate).length;
}

function canAddArticle(selected: ProcessedArticle[], article: ProcessedArticle): boolean {
  if (
    isNicheInstitutionalSource(article) &&
    countSelectedBySource(selected, article.sourceId) >= MAX_SELECTED_PER_NICHE_SOURCE
  ) {
    return false;
  }

  if (
    isNicheInstitutionalSource(article) &&
    countSelectedByPredicate(selected, isNicheInstitutionalSource) >=
      MAX_SELECTED_NICHE_INSTITUTIONAL
  ) {
    return false;
  }

  if (
    isBureaucraticStory(article) &&
    countSelectedByPredicate(selected, isBureaucraticStory) >= MAX_SELECTED_BUREAUCRATIC
  ) {
    return false;
  }

  return true;
}

function pickSeedCandidate(
  pool: ProcessedArticle[],
  selected: ProcessedArticle[],
  predicate: (article: ProcessedArticle) => boolean,
  scoreFloor: number,
  validation: DraftValidation
): ProcessedArticle | null {
  return (
    pool.find(
      (article) =>
        predicate(article) &&
        canAddArticle(selected, article) &&
        getAdjustedScore(article, validation) >= scoreFloor
    ) || null
  );
}

function removeArticle(pool: ProcessedArticle[], articleId: string): ProcessedArticle[] {
  return pool.filter((article) => article.id !== articleId);
}

function buildBalancedSelection(
  rankedArticles: ProcessedArticle[],
  validation: DraftValidation,
  selectedCount: number
): { selected: ProcessedArticle[]; remaining: ProcessedArticle[] } {
  if (rankedArticles.length === 0 || selectedCount <= 0) {
    return { selected: [], remaining: rankedArticles };
  }

  let remaining = [...rankedArticles];
  const selected: ProcessedArticle[] = [];
  const anchorArticle = rankedArticles[Math.min(selectedCount - 1, rankedArticles.length - 1)];
  const scoreFloor = getAdjustedScore(anchorArticle, validation) - CANDIDATE_SCORE_DELTA_FOR_FLOORS;

  const maybeAdd = (article: ProcessedArticle | null) => {
    if (!article) {
      return;
    }
    selected.push(article);
    remaining = removeArticle(remaining, article.id);
  };

  while (
    selected.length < selectedCount &&
    countSelectedByPredicate(selected, isCommunityCentered) < MIN_SELECTED_COMMUNITY
  ) {
    const candidate = pickSeedCandidate(
      remaining,
      selected,
      isCommunityCentered,
      scoreFloor,
      validation
    );
    if (!candidate) {
      break;
    }
    maybeAdd(candidate);
  }

  while (
    selected.length < selectedCount &&
    countSelectedByPredicate(selected, isGreenPreferred) < MIN_SELECTED_GREEN
  ) {
    const candidate = pickSeedCandidate(
      remaining,
      selected,
      isGreenPreferred,
      scoreFloor,
      validation
    );
    if (!candidate) {
      break;
    }
    maybeAdd(candidate);
  }

  for (const article of [...remaining]) {
    if (selected.length >= selectedCount) {
      break;
    }
    if (!canAddArticle(selected, article)) {
      continue;
    }
    maybeAdd(article);
  }

  for (const article of [...remaining]) {
    if (selected.length >= selectedCount) {
      break;
    }
    maybeAdd(article);
  }

  return { selected, remaining };
}

export function selectBalancedShortlist(options: {
  rankedArticles: ProcessedArticle[];
  validation: DraftValidation;
  selectedCount: number;
  reserveCount: number;
}): { selected: ProcessedArticle[]; reserves: ProcessedArticle[] } {
  const { rankedArticles, validation, selectedCount, reserveCount } = options;
  const { selected, remaining } = buildBalancedSelection(
    rankedArticles,
    validation,
    selectedCount
  );

  return {
    selected,
    reserves: remaining.slice(0, reserveCount),
  };
}

export function rebalancePreferredSelection(options: {
  preferredArticles: ProcessedArticle[];
  allArticles: ProcessedArticle[];
  validation: DraftValidation;
}): { selected: ProcessedArticle[]; reserves: ProcessedArticle[] } {
  const { preferredArticles, allArticles, validation } = options;
  const preferredIds = new Set(preferredArticles.map((article) => article.id));

  return selectBalancedShortlist({
    rankedArticles: [
      ...preferredArticles,
      ...allArticles.filter((article) => !preferredIds.has(article.id)),
    ],
    validation,
    selectedCount: preferredArticles.length,
    reserveCount: Math.max(0, allArticles.length - preferredArticles.length),
  });
}
