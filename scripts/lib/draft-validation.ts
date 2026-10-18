import type {
  DraftValidationBlockedArticle,
  NewsletterDraft,
  ProcessedArticle,
} from '../types.js';
import {
  canonicalizeStoryUrl,
  compareStories,
  isHighConfidenceStoryMatch,
  normalizeTitle,
} from './deduplication.js';
import { getEditorialBlockReason } from './editorial-rules.js';
import { MIN_SENDABLE_ARTICLE_COUNT } from './newsletter-policy.js';
import { formatIsoDate, getIssuePublicationMonday } from './newsletter-week.js';
import type { HistoricalArticle } from './story-history.js';

export const DEFAULT_FRESHNESS_WINDOW_DAYS = 14;

export interface ValidateDraftFreshnessOptions {
  draft: NewsletterDraft;
  historicalArticles: HistoricalArticle[];
  recentDraftCount: number;
  publishedHistoryCount: number;
  freshnessWindowDays?: number;
  now?: Date;
}

/** A read-only deterministic check, not source verification or delivery approval. */
export interface ValidateDraftFreshnessResult {
  status: 'passed' | 'failed';
  checkedAt: string;
  plannedReadDate: string;
  freshnessWindowDays: number;
  publishedHistoryCount: number;
  recentDraftCount: number;
  blockedArticles: DraftValidationBlockedArticle[];
  selectedFreshCount: number;
  reserveFreshCount: number;
}

function resolveValidationNow(explicitNow?: Date): Date {
  if (explicitNow) {
    return explicitNow;
  }

  const envValue = process.env.GOODBRIEF_VALIDATION_NOW;
  if (envValue) {
    const parsed = new Date(envValue);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function buildBlockedArticle(
  articleId: string,
  reason: string,
  match?: Pick<HistoricalArticle, 'origin' | 'title'>
): DraftValidationBlockedArticle {
  return {
    articleId,
    reason,
    matchedOrigin: match?.origin,
    matchedTitle: match?.title,
  };
}

function checkArticle(
  article: ProcessedArticle,
  historicalArticles: HistoricalArticle[],
  plannedReadAt: Date,
  freshnessWindowDays: number
): DraftValidationBlockedArticle | null {
  const editorialBlockReason = getEditorialBlockReason(article);
  if (editorialBlockReason) {
    return buildBlockedArticle(article.id, `editorial:${editorialBlockReason}`);
  }

  const publishedAt = new Date(article.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) {
    return buildBlockedArticle(article.id, 'unknown-published-at');
  }

  const ageInDays = (plannedReadAt.getTime() - publishedAt) / 86_400_000;
  if (ageInDays > freshnessWindowDays) {
    return buildBlockedArticle(article.id, 'stale-published-at');
  }

  const draftIdMatch = historicalArticles.find(
    (previous) => previous.source === 'draft' && previous.id === article.id
  );
  if (draftIdMatch) {
    return buildBlockedArticle(article.id, 'recent-draft-id', draftIdMatch);
  }

  const canonicalUrl = canonicalizeStoryUrl(article.url);
  const urlMatch = canonicalUrl
    ? historicalArticles.find(
        (previous) => canonicalizeStoryUrl(previous.url) === canonicalUrl
      )
    : undefined;
  if (urlMatch) {
    return buildBlockedArticle(article.id, 'url-match', urlMatch);
  }

  const title = normalizeTitle(article.originalTitle);
  const titleMatch = historicalArticles.find(
    (previous) => normalizeTitle(previous.title) === title
  );
  if (titleMatch) {
    return buildBlockedArticle(article.id, 'title-match', titleMatch);
  }

  const storyMatch = historicalArticles.find((previous) =>
    isHighConfidenceStoryMatch(
      compareStories(
        { title: article.originalTitle, summary: article.summary },
        previous
      )
    )
  );
  return storyMatch
    ? buildBlockedArticle(article.id, 'story-similarity', storyMatch)
    : null;
}

/**
 * Check dates, hard editorial exclusions and archive similarity without changing
 * selection, reviewed copy, semantic-review metadata, or delivery locks. Amp must
 * still verify sources, follow-ups and event deadlines; an editor approves sends.
 */
export async function validateDraftFreshness(
  options: ValidateDraftFreshnessOptions
): Promise<ValidateDraftFreshnessResult> {
  const freshnessWindowDays = options.freshnessWindowDays ?? DEFAULT_FRESHNESS_WINDOW_DAYS;
  if (!Number.isFinite(freshnessWindowDays) || freshnessWindowDays <= 0) {
    throw new Error('Freshness window must be a positive number of days');
  }

  const plannedReadAt = getIssuePublicationMonday(options.draft.weekId);
  const pool = [...options.draft.selected, ...options.draft.reserves];
  const blockedArticles = pool
    .map((article) =>
      checkArticle(article, options.historicalArticles, plannedReadAt, freshnessWindowDays)
    )
    .filter((blocked): blocked is DraftValidationBlockedArticle => blocked !== null);
  const blockedIds = new Set(blockedArticles.map((blocked) => blocked.articleId));
  const selectedFreshCount = options.draft.selected.filter(
    (article) => !blockedIds.has(article.id)
  ).length;

  return {
    status:
      selectedFreshCount === options.draft.selected.length &&
      selectedFreshCount >= MIN_SENDABLE_ARTICLE_COUNT
        ? 'passed'
        : 'failed',
    checkedAt: resolveValidationNow(options.now).toISOString(),
    plannedReadDate: formatIsoDate(plannedReadAt),
    freshnessWindowDays,
    publishedHistoryCount: options.publishedHistoryCount,
    recentDraftCount: options.recentDraftCount,
    blockedArticles,
    selectedFreshCount,
    reserveFreshCount: options.draft.reserves.filter(
      (article) => !blockedIds.has(article.id)
    ).length,
  };
}
