import type { DraftValidation, ProcessedArticle } from '../types.js';
import { getRankingScore } from './ranking.js';

const MAX_SELECTED_PER_NICHE_SOURCE = 2;
const MAX_SELECTED_NICHE_INSTITUTIONAL = 3;
const MAX_SELECTED_BUREAUCRATIC = 2;
const MIN_SELECTED_COMMUNITY = 2;
const MIN_SELECTED_GREEN = 1;
const MAX_DIVERSITY_SCORE_GAP = 8;
export const MIN_EDITORIAL_INTEREST_SCORE = 55;
export const MIN_ADJUSTED_RANKING_SCORE = 50;
const LEGACY_EDITORIAL_INTEREST_SCORE = 65;

const NON_SUBJECT_NAME_PAIRS = new Set([
  'business checkin',
  'doctor de',
  'români din',
]);

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

export function meetsNewsletterQualityFloor(
  article: ProcessedArticle,
  validation: DraftValidation
): boolean {
  const editorialInterest =
    typeof article.editorialInterest === 'number' &&
    Number.isFinite(article.editorialInterest)
      ? article.editorialInterest
      : LEGACY_EDITORIAL_INTEREST_SCORE;

  return (
    editorialInterest >= MIN_EDITORIAL_INTEREST_SCORE &&
    getAdjustedScore(article, validation) >= MIN_ADJUSTED_RANKING_SCORE
  );
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

function getNamedSubjectKeys(article: ProcessedArticle): Set<string> {
  const matches = [
    ...article.originalTitle.matchAll(/\p{L}[\p{L}’'-]*/gu),
  ];
  const keys = new Set<string>();

  for (let index = 0; index < matches.length - 1; index += 1) {
    const left = matches[index];
    const right = matches[index + 1];
    const leftWord = left[0];
    const rightWord = right[0];
    const leftEnd = (left.index || 0) + leftWord.length;
    const separator = article.originalTitle.slice(leftEnd, right.index);
    if (!/^\s+$/u.test(separator)) {
      continue;
    }

    const isNameWord = (word: string) => {
      const first = [...word][0] || '';
      return (
        word.length >= 2 &&
        first === first.toLocaleUpperCase('ro-RO') &&
        first !== first.toLocaleLowerCase('ro-RO')
      );
    };
    if (!isNameWord(leftWord) || !isNameWord(rightWord)) {
      continue;
    }

    const key = `${leftWord} ${rightWord}`.toLocaleLowerCase('ro-RO');
    if (!NON_SUBJECT_NAME_PAIRS.has(key)) {
      keys.add(key);
    }
  }

  return keys;
}

function repeatsNamedSubject(
  selected: ProcessedArticle[],
  candidate: ProcessedArticle
): boolean {
  const candidateKeys = getNamedSubjectKeys(candidate);
  if (candidateKeys.size === 0) {
    return false;
  }

  return selected.some((article) => {
    const selectedKeys = getNamedSubjectKeys(article);
    return [...candidateKeys].some((key) => selectedKeys.has(key));
  });
}

function keepTopRankedNamedSubjects(
  rankedArticles: ProcessedArticle[]
): ProcessedArticle[] {
  const kept: ProcessedArticle[] = [];
  for (const article of rankedArticles) {
    if (!repeatsNamedSubject(kept, article)) {
      kept.push(article);
    }
  }
  return kept;
}

function canAddArticle(selected: ProcessedArticle[], article: ProcessedArticle): boolean {
  if (repeatsNamedSubject(selected, article)) {
    return false;
  }

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
  const scoreFloor = getAdjustedScore(anchorArticle, validation) - MAX_DIVERSITY_SCORE_GAP;

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
    if (repeatsNamedSubject(selected, article)) {
      continue;
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
  const qualifyingArticles = keepTopRankedNamedSubjects(
    rankedArticles.filter((article) =>
      meetsNewsletterQualityFloor(article, validation)
    )
  );
  const { selected, remaining } = buildBalancedSelection(
    qualifyingArticles,
    validation,
    selectedCount
  );

  const visibleArticles = [...selected];
  const reserves: ProcessedArticle[] = [];
  for (const article of remaining) {
    if (reserves.length >= reserveCount) {
      break;
    }
    if (repeatsNamedSubject(visibleArticles, article)) {
      continue;
    }
    reserves.push(article);
    visibleArticles.push(article);
  }

  return { selected, reserves };
}

export function rebalancePreferredSelection(options: {
  preferredArticles: ProcessedArticle[];
  allArticles: ProcessedArticle[];
  validation: DraftValidation;
}): { selected: ProcessedArticle[]; reserves: ProcessedArticle[] } {
  const { preferredArticles, allArticles, validation } = options;
  const selected: ProcessedArticle[] = [];
  for (const article of preferredArticles) {
    if (
      meetsNewsletterQualityFloor(article, validation) &&
      canAddArticle(selected, article)
    ) {
      selected.push(article);
    }
  }
  const selectedIds = new Set(selected.map((article) => article.id));

  return {
    selected,
    reserves: allArticles.filter((article) => !selectedIds.has(article.id)),
  };
}
