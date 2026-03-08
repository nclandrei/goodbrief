import { readFileSync } from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateWrapperCopy as defaultGenerateWrapperCopy } from '../../emails/utils/generate-copy.js';
import type {
  DraftValidation,
  DraftValidationAgentReviewedArticle,
  DraftValidationBlockedArticle,
  DraftValidationReplacement,
  DraftValidationVerdict,
  NewsletterDraft,
  ProcessedArticle,
  WrapperCopy,
} from '../types.js';
import {
  canonicalizeStoryUrl,
  compareStories,
  isHighConfidenceStoryMatch,
  normalizeTitle,
} from './deduplication.js';
import { callWithRetry } from './gemini.js';
import type { HistoricalArticle } from './story-history.js';

export const DEFAULT_FRESHNESS_WINDOW_DAYS = 14;
const MAX_CANDIDATES_PER_ARTICLE = 5;

export interface HistoricalCandidateMatch {
  article: HistoricalArticle;
  titleSimilarity: number;
  titleTokenOverlap: number;
  summaryTokenOverlap: number;
  combinedScore: number;
}

export interface ArchiveReviewInputItem {
  article: ProcessedArticle;
  candidates: HistoricalCandidateMatch[];
  requiresDateReview: boolean;
}

export interface ArchiveReviewDecision {
  articleId: string;
  verdict: DraftValidationVerdict;
  notes: string;
  matchedOrigin?: string;
  matchedTitle?: string;
}

export interface ValidateDraftFreshnessOptions {
  draft: NewsletterDraft;
  historicalArticles: HistoricalArticle[];
  recentDraftCount: number;
  publishedHistoryCount: number;
  freshnessWindowDays?: number;
  now?: Date;
  reviewArchive?: (
    items: ArchiveReviewInputItem[],
    weekId: string
  ) => Promise<ArchiveReviewDecision[]>;
  generateWrapperCopy?: (
    articles: ProcessedArticle[],
    weekId: string
  ) => Promise<WrapperCopy>;
}

export interface ValidateDraftFreshnessResult {
  draft: NewsletterDraft;
  changed: boolean;
  approvedCount: number;
}

interface ArchiveReviewResponse {
  reviews: Array<{
    articleId: string;
    verdict: DraftValidationVerdict;
    notes: string;
    matchedOrigin?: string;
    matchedTitle?: string;
  }>;
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

function getPublishedAtTimestamp(article: Pick<ProcessedArticle, 'publishedAt'>): number | null {
  const timestamp = new Date(article.publishedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function needsDateReview(article: Pick<ProcessedArticle, 'publishedAt'>): boolean {
  return getPublishedAtTimestamp(article) === null;
}

function isArticleStale(
  article: Pick<ProcessedArticle, 'publishedAt'>,
  now: Date,
  freshnessWindowDays: number
): boolean {
  const publishedAt = getPublishedAtTimestamp(article);
  if (publishedAt === null) {
    return false;
  }

  const ageInDays = (now.getTime() - publishedAt) / 86_400_000;
  return ageInDays > freshnessWindowDays;
}

function buildHistoricalCandidates(
  article: ProcessedArticle,
  historicalArticles: HistoricalArticle[],
  limit: number = MAX_CANDIDATES_PER_ARTICLE
): HistoricalCandidateMatch[] {
  return historicalArticles
    .map((previous) => {
      const comparison = compareStories(
        { title: article.originalTitle, summary: article.summary },
        previous
      );
      return {
        article: previous,
        ...comparison,
      };
    })
    .filter(
      (match) =>
        match.combinedScore >= 0.2 ||
        match.titleSimilarity >= 0.55 ||
        match.titleTokenOverlap >= 0.25 ||
        match.summaryTokenOverlap >= 0.2
    )
    .sort((a, b) => {
      if (b.combinedScore !== a.combinedScore) {
        return b.combinedScore - a.combinedScore;
      }
      if (b.titleSimilarity !== a.titleSimilarity) {
        return b.titleSimilarity - a.titleSimilarity;
      }
      return b.titleTokenOverlap - a.titleTokenOverlap;
    })
    .slice(0, limit);
}

function findDraftIdMatch(
  article: ProcessedArticle,
  historicalArticles: HistoricalArticle[]
): HistoricalArticle | null {
  for (const previous of historicalArticles) {
    if (previous.source !== 'draft') {
      continue;
    }
    if (previous.id && previous.id === article.id) {
      return previous;
    }
  }
  return null;
}

function findExactUrlMatch(
  article: ProcessedArticle,
  historicalArticles: HistoricalArticle[]
): HistoricalArticle | null {
  const articleCanonicalUrl = canonicalizeStoryUrl(article.url);
  if (!articleCanonicalUrl) {
    return null;
  }

  for (const previous of historicalArticles) {
    const previousCanonicalUrl = canonicalizeStoryUrl(previous.url);
    if (previousCanonicalUrl && previousCanonicalUrl === articleCanonicalUrl) {
      return previous;
    }
  }

  return null;
}

function findExactTitleMatch(
  article: ProcessedArticle,
  historicalArticles: HistoricalArticle[]
): HistoricalArticle | null {
  const articleTitle = normalizeTitle(article.originalTitle);
  for (const previous of historicalArticles) {
    if (normalizeTitle(previous.title) === articleTitle) {
      return previous;
    }
  }
  return null;
}

function findHighConfidenceStoryMatch(candidates: HistoricalCandidateMatch[]): HistoricalCandidateMatch | null {
  for (const candidate of candidates) {
    if (isHighConfidenceStoryMatch(candidate)) {
      return candidate;
    }
  }
  return null;
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

function normalizeReviewResponse(
  response: ArchiveReviewResponse,
  items: ArchiveReviewInputItem[]
): ArchiveReviewDecision[] {
  const validArticleIds = new Set(items.map((item) => item.article.id));
  const uniqueById = new Map<string, ArchiveReviewDecision>();

  for (const review of response.reviews || []) {
    if (!validArticleIds.has(review.articleId)) {
      continue;
    }

    if (!uniqueById.has(review.articleId)) {
      uniqueById.set(review.articleId, {
        articleId: review.articleId,
        verdict: review.verdict,
        notes: review.notes?.trim() || 'No notes provided.',
        matchedOrigin: review.matchedOrigin?.trim() || undefined,
        matchedTitle: review.matchedTitle?.trim() || undefined,
      });
    }
  }

  const decisions = items.map((item) => uniqueById.get(item.article.id)).filter(Boolean);
  if (decisions.length !== items.length) {
    const missingIds = items
      .map((item) => item.article.id)
      .filter((id) => !uniqueById.has(id));
    throw new Error(`Archive review missing verdicts for article IDs: ${missingIds.join(', ')}`);
  }

  return decisions as ArchiveReviewDecision[];
}

function loadMockArchiveReview(items: ArchiveReviewInputItem[]): ArchiveReviewDecision[] | null {
  const mockPath = process.env.GOODBRIEF_ARCHIVE_REVIEW_PATH;
  if (!mockPath) {
    return null;
  }

  const response = JSON.parse(readFileSync(mockPath, 'utf-8')) as ArchiveReviewResponse;
  return normalizeReviewResponse(response, items);
}

function getArchiveReviewPrompt(weekId: string, items: ArchiveReviewInputItem[]): string {
  const body = items
    .map((item, index) => {
      const candidateText =
        item.candidates.length > 0
          ? item.candidates
              .map(
                (candidate, candidateIndex) =>
                  `${candidateIndex + 1}. [${candidate.article.source}] ${candidate.article.origin}
Title: ${candidate.article.title}
Summary: ${candidate.article.summary || '(no summary)'}
Published: ${candidate.article.publishedAt || 'unknown'}
Scores: titleSimilarity=${candidate.titleSimilarity.toFixed(2)}, titleOverlap=${candidate.titleTokenOverlap.toFixed(2)}, summaryOverlap=${candidate.summaryTokenOverlap.toFixed(2)}`
              )
              .join('\n\n')
          : 'No close historical matches found.';

      return `${index + 1}. CURRENT ARTICLE
ID: ${item.article.id}
Title: ${item.article.originalTitle}
Summary: ${item.article.summary}
Published: ${item.article.publishedAt || 'unknown'}
NeedsDateReview: ${item.requiresDateReview ? 'yes' : 'no'}

Possible archive matches:
${candidateText}`;
    })
    .join('\n\n====\n\n');

  return `You are the archive validation gate for Good Brief week ${weekId}.

For each current article, decide whether it is:
- "fresh": a genuinely new story that has not appeared before
- "duplicate": the same underlying story/event already covered before, even if rewritten by another outlet
- "follow_up": a materially new development on a previously covered topic; keep only if readers would clearly perceive it as a new milestone, not a rewrite

Strict rules:
- Be conservative. If it feels like a rewrite or recycled version of an older story, mark "duplicate".
- Different outlets covering the same underlying event are duplicates.
- A story is "follow_up" only when there is a concrete new development after the previous edition.
- If the current article has an unknown or unusable published date, be extra skeptical about evergreen or recycled coverage.

Return JSON only in this shape:
{
  "reviews": [
    {
      "articleId": "string",
      "verdict": "fresh | duplicate | follow_up",
      "notes": "short explanation",
      "matchedOrigin": "issue or draft filename if relevant",
      "matchedTitle": "matched historical title if relevant"
    }
  ]
}

Articles to review:
${body}`;
}

export async function reviewDraftPoolAgainstArchive(
  items: ArchiveReviewInputItem[],
  weekId: string,
  apiKey: string = process.env.GEMINI_API_KEY || ''
): Promise<ArchiveReviewDecision[]> {
  if (items.length === 0) {
    return [];
  }

  const mock = loadMockArchiveReview(items);
  if (mock) {
    return mock;
  }

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required for archive review');
  }

  const responseSchema = {
    type: 'object',
    properties: {
      reviews: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            articleId: { type: 'string' },
            verdict: {
              type: 'string',
              enum: ['fresh', 'duplicate', 'follow_up'],
            },
            notes: { type: 'string' },
            matchedOrigin: { type: 'string' },
            matchedTitle: { type: 'string' },
          },
          required: ['articleId', 'verdict', 'notes'],
        },
      },
    },
    required: ['reviews'],
  };

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    } as any,
  });

  const response = await callWithRetry(async () => {
    const prompt = getArchiveReviewPrompt(weekId, items);
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text()) as ArchiveReviewResponse;
  });

  return normalizeReviewResponse(response, items);
}

function sameIds(a: ProcessedArticle[], b: ProcessedArticle[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((article, index) => article.id === b[index]?.id);
}

function calculateReplacements(
  previousSelected: ProcessedArticle[],
  nextSelected: ProcessedArticle[]
): DraftValidationReplacement[] {
  const previousIds = previousSelected.map((article) => article.id);
  const nextIds = nextSelected.map((article) => article.id);
  const removedIds = previousIds.filter((id) => !nextIds.includes(id));
  const addedIds = nextIds.filter((id) => !previousIds.includes(id));

  return removedIds
    .map((removedArticleId, index) => {
      const replacementArticleId = addedIds[index];
      if (!replacementArticleId) {
        return null;
      }

      return {
        removedArticleId,
        replacementArticleId,
      };
    })
    .filter((replacement): replacement is DraftValidationReplacement => replacement !== null);
}

function buildValidationMetadata(options: {
  previousValidation?: DraftValidation;
  candidateCount: number;
  status: NonNullable<DraftValidation['status']>;
  checkedAt: string;
  freshnessWindowDays: number;
  publishedHistoryCount: number;
  recentDraftCount: number;
  blockedArticles: DraftValidationBlockedArticle[];
  replacements: DraftValidationReplacement[];
  agentReviewed: DraftValidationAgentReviewedArticle[];
}): DraftValidation {
  return {
    generatedAt:
      options.previousValidation?.generatedAt || options.checkedAt,
    candidateCount:
      options.previousValidation?.candidateCount ?? options.candidateCount,
    flagged: options.previousValidation?.flagged || [],
    status: options.status,
    checkedAt: options.checkedAt,
    freshnessWindowDays: options.freshnessWindowDays,
    publishedHistoryCount: options.publishedHistoryCount,
    recentDraftCount: options.recentDraftCount,
    blockedArticles: options.blockedArticles,
    replacements: options.replacements,
    agentReviewed: options.agentReviewed,
  };
}

export async function validateDraftFreshness(
  options: ValidateDraftFreshnessOptions
): Promise<ValidateDraftFreshnessResult> {
  const now = resolveValidationNow(options.now);
  const checkedAt = now.toISOString();
  const freshnessWindowDays = options.freshnessWindowDays ?? DEFAULT_FRESHNESS_WINDOW_DAYS;
  const reviewArchive = options.reviewArchive ?? reviewDraftPoolAgainstArchive;
  const generateWrapperCopy = options.generateWrapperCopy ?? defaultGenerateWrapperCopy;

  const pool = [...options.draft.selected, ...options.draft.reserves];
  const blockedArticles: DraftValidationBlockedArticle[] = [];
  const reviewItems: ArchiveReviewInputItem[] = [];

  for (const article of pool) {
    const candidates = buildHistoricalCandidates(article, options.historicalArticles);

    if (isArticleStale(article, now, freshnessWindowDays)) {
      blockedArticles.push(buildBlockedArticle(article.id, 'stale-published-at'));
      continue;
    }

    const draftIdMatch = findDraftIdMatch(article, options.historicalArticles);
    if (draftIdMatch) {
      blockedArticles.push(buildBlockedArticle(article.id, 'recent-draft-id', draftIdMatch));
      continue;
    }

    const urlMatch = findExactUrlMatch(article, options.historicalArticles);
    if (urlMatch) {
      blockedArticles.push(buildBlockedArticle(article.id, 'url-match', urlMatch));
      continue;
    }

    const titleMatch = findExactTitleMatch(article, options.historicalArticles);
    if (titleMatch) {
      blockedArticles.push(buildBlockedArticle(article.id, 'title-match', titleMatch));
      continue;
    }

    const storyMatch = findHighConfidenceStoryMatch(candidates);
    if (storyMatch) {
      blockedArticles.push(
        buildBlockedArticle(article.id, 'story-similarity', storyMatch.article)
      );
      continue;
    }

    reviewItems.push({
      article,
      candidates,
      requiresDateReview: needsDateReview(article),
    });
  }

  const reviewDecisions = await reviewArchive(reviewItems, options.draft.weekId);
  const reviewDecisionById = new Map(reviewDecisions.map((decision) => [decision.articleId, decision]));

  for (const decision of reviewDecisions) {
    if (decision.verdict === 'duplicate') {
      blockedArticles.push({
        articleId: decision.articleId,
        reason: 'agent-duplicate',
        matchedOrigin: decision.matchedOrigin,
        matchedTitle: decision.matchedTitle,
      });
    }
  }

  const blockedIds = new Set(blockedArticles.map((blocked) => blocked.articleId));
  const approvedPool = pool.filter((article) => !blockedIds.has(article.id));
  const newSelected = approvedPool.slice(0, 10);
  const newReserves = approvedPool.slice(10);
  const replacements = calculateReplacements(options.draft.selected, newSelected);

  const agentReviewed: DraftValidationAgentReviewedArticle[] = reviewItems.map((item) => {
    const decision = reviewDecisionById.get(item.article.id);
    if (!decision) {
      throw new Error(`Missing archive review decision for article ${item.article.id}`);
    }

    return {
      articleId: item.article.id,
      verdict: decision.verdict,
      notes: decision.notes,
      matchedOrigin: decision.matchedOrigin,
      matchedTitle: decision.matchedTitle,
    };
  });

  const nextDraft: NewsletterDraft = {
    ...options.draft,
    selected: newSelected,
    reserves: newReserves,
  };

  const status: NonNullable<DraftValidation['status']> =
    newSelected.length >= 10 ? 'passed' : 'failed';
  nextDraft.validation = buildValidationMetadata({
    previousValidation: options.draft.validation,
    candidateCount: pool.length,
    status,
    checkedAt,
    freshnessWindowDays,
    publishedHistoryCount: options.publishedHistoryCount,
    recentDraftCount: options.recentDraftCount,
    blockedArticles,
    replacements,
    agentReviewed,
  });

  if (status === 'passed' && (!sameIds(options.draft.selected, newSelected) || !nextDraft.wrapperCopy)) {
    nextDraft.wrapperCopy = await generateWrapperCopy(nextDraft.selected, nextDraft.weekId);
  }

  return {
    draft: nextDraft,
    changed:
      !sameIds(options.draft.selected, nextDraft.selected) ||
      !sameIds(options.draft.reserves, nextDraft.reserves) ||
      JSON.stringify(options.draft.validation) !== JSON.stringify(nextDraft.validation),
    approvedCount: approvedPool.length,
  };
}
