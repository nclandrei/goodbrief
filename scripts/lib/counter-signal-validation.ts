import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
  CounterSignalFlag,
  CounterSignalVerdict,
  DraftValidation,
  ProcessedArticle,
  RawArticle,
} from '../types.js';
import {
  canonicalizeStoryUrl,
  titleSimilarity,
  tokenOverlap,
} from './deduplication.js';
import { callWithRetry } from './gemini.js';

const SAME_WEEK_TITLE_SIMILARITY_THRESHOLD = 0.45;
const SAME_WEEK_TOKEN_OVERLAP_THRESHOLD = 0.25;
const SAME_WEEK_MIN_COMMON_TOKENS = 2;
const MAX_RELATED_ARTICLES = 5;

export const COUNTER_SIGNAL_VALIDATION_POOL_SIZE = 60;
export const COUNTER_SIGNAL_BORDERLINE_PENALTY = 10;
export const COUNTER_SIGNAL_STRONG_PENALTY = 30;

export interface RelatedArticleMatch {
  article: RawArticle;
  urlMatch: boolean;
  titleSimilarity: number;
  tokenOverlap: number;
  commonTokens: number;
  strength: number;
}

export interface CounterSignalClassifierInput {
  weekId: string;
  candidate: ProcessedArticle;
  relatedArticles: RawArticle[];
}

export interface CounterSignalClassifierResult {
  verdict: CounterSignalVerdict;
  reason: string;
  relatedArticleIds: string[];
}

export type CounterSignalClassifier = (
  input: CounterSignalClassifierInput
) => Promise<CounterSignalClassifierResult>;

export interface CounterSignalValidationResult extends DraftValidation {}

function normalizeVerdict(value: string | undefined): CounterSignalVerdict {
  if (value === 'strong' || value === 'borderline' || value === 'none') {
    return value;
  }
  return 'none';
}

export function getCounterSignalPenalty(verdict: CounterSignalVerdict): number {
  switch (verdict) {
    case 'strong':
      return COUNTER_SIGNAL_STRONG_PENALTY;
    case 'borderline':
      return COUNTER_SIGNAL_BORDERLINE_PENALTY;
    default:
      return 0;
  }
}

export function findRelatedRawArticles(
  candidate: Pick<ProcessedArticle, 'id' | 'originalTitle' | 'url'>,
  rawArticles: RawArticle[]
): RelatedArticleMatch[] {
  const candidateCanonicalUrl = canonicalizeStoryUrl(candidate.url);

  return rawArticles
    .filter((article) => article.id !== candidate.id)
    .map((article) => {
      const articleCanonicalUrl = canonicalizeStoryUrl(article.url);
      const similarity = titleSimilarity(candidate.originalTitle, article.title);
      const overlap = tokenOverlap(candidate.originalTitle, article.title);
      const urlMatch =
        Boolean(candidateCanonicalUrl) &&
        Boolean(articleCanonicalUrl) &&
        candidateCanonicalUrl === articleCanonicalUrl;
      const overlapMatch =
        overlap.score >= SAME_WEEK_TOKEN_OVERLAP_THRESHOLD &&
        overlap.commonTokens >= SAME_WEEK_MIN_COMMON_TOKENS;
      const titleMatch = similarity >= SAME_WEEK_TITLE_SIMILARITY_THRESHOLD;

      if (!urlMatch && !titleMatch && !overlapMatch) {
        return null;
      }

      return {
        article,
        urlMatch,
        titleSimilarity: similarity,
        tokenOverlap: overlap.score,
        commonTokens: overlap.commonTokens,
        strength: urlMatch ? 1 : Math.max(similarity, overlap.score),
      };
    })
    .filter((match): match is RelatedArticleMatch => match !== null)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_RELATED_ARTICLES);
}

function buildCounterSignalPrompt(
  weekId: string,
  candidate: ProcessedArticle,
  relatedArticles: RawArticle[]
): string {
  const relatedList = relatedArticles
    .map((article, index) => {
      const shortSummary = article.summary.replace(/\s+/g, ' ').slice(0, 240);
      return `${index + 1}. ID: ${article.id}
Titlu: ${article.title}
Rezumat: ${shortSummary}
Sursă: ${article.sourceName}
Publicat: ${article.publishedAt}`;
    })
    .join('\n\n');

  return `You are validating a Good Brief article candidate for week ${weekId}.

IMPORTANT:
- Good Brief is a Romanian positive-news newsletter.
- Return JSON only.
- "reason" MUST be in Romanian.

Candidate article:
ID: ${candidate.id}
Titlu: ${candidate.originalTitle}
Rezumat: ${candidate.summary}
Categorie: ${candidate.category}
Scoruri: positivity=${candidate.positivity}, impact=${candidate.impact}
Publicat: ${candidate.publishedAt}

Same-week related raw coverage:
${relatedList}

Task:
Decide whether the same-week related coverage materially weakens this candidate as a clean positive-news inclusion.

Verdicts:
- none: related stories do not weaken it, or they reinforce it.
- borderline: there is a meaningful caveat, mixed signal, or administrative weakness worth showing to the editor.
- strong: the same-week related coverage clearly undercuts the candidate, makes it look premature, disputed, overhyped, or no longer a clean positive pick.

Rules:
- Focus on whether the candidate still works for a curated "good news" newsletter.
- Do NOT flag broad thematic overlap alone.
- A complaint, criticism, implementation failure, or contradictory same-week update can justify borderline/strong.
- If the related stories are just context or additional positive developments, return none.
- Select only the specific related article IDs that actually support your verdict.

Return JSON:
{
  "verdict": "none" | "borderline" | "strong",
  "reason": "Romanian explanation for editors",
  "relatedArticleIds": ["id1", "id2"]
}`;
}

export function createGeminiCounterSignalClassifier(
  apiKey: string
): CounterSignalClassifier {
  const genAI = new GoogleGenerativeAI(apiKey);
  const responseSchema = {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['none', 'borderline', 'strong'],
      },
      reason: {
        type: 'string',
        description: 'Romanian explanation for editors',
      },
      relatedArticleIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['verdict', 'reason', 'relatedArticleIds'],
  };

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    } as any,
  });

  return async ({ weekId, candidate, relatedArticles }) => {
    return callWithRetry(async () => {
      const prompt = buildCounterSignalPrompt(weekId, candidate, relatedArticles);
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text) as CounterSignalClassifierResult;
      return {
        verdict: normalizeVerdict(parsed.verdict),
        reason: parsed.reason?.trim() || 'Există semnale mixte în acoperirea din aceeași săptămână.',
        relatedArticleIds: Array.isArray(parsed.relatedArticleIds)
          ? parsed.relatedArticleIds.filter((id) => typeof id === 'string')
          : [],
      };
    });
  };
}

function buildFlag(
  candidate: ProcessedArticle,
  matches: RelatedArticleMatch[],
  classification: CounterSignalClassifierResult,
  generatedAt: string
): CounterSignalFlag | null {
  const verdict = normalizeVerdict(classification.verdict);
  if (verdict === 'none') {
    return null;
  }

  const matchById = new Map(matches.map((match) => [match.article.id, match]));
  const relatedArticleIds = [
    ...new Set(
      classification.relatedArticleIds.filter((id) => matchById.has(id))
    ),
  ];

  if (relatedArticleIds.length === 0 && matches.length > 0) {
    relatedArticleIds.push(matches[0].article.id);
  }

  const relatedArticleTitles = relatedArticleIds
    .map((id) => matchById.get(id)?.article.title)
    .filter((title): title is string => Boolean(title));

  return {
    candidateId: candidate.id,
    verdict,
    penaltyApplied: getCounterSignalPenalty(verdict),
    reason:
      classification.reason?.trim() ||
      'Există semnale din aceeași săptămână care slăbesc povestea.',
    relatedArticleIds,
    relatedArticleTitles,
    generatedAt,
  };
}

export async function validateSameWeekCounterSignals(options: {
  weekId: string;
  candidates: ProcessedArticle[];
  rawArticles: RawArticle[];
  apiKey?: string;
  classifier?: CounterSignalClassifier;
  generatedAt?: string;
}): Promise<CounterSignalValidationResult> {
  const {
    weekId,
    candidates,
    rawArticles,
    apiKey,
    classifier = apiKey ? createGeminiCounterSignalClassifier(apiKey) : undefined,
    generatedAt = new Date().toISOString(),
  } = options;

  if (!classifier) {
    throw new Error('Counter-signal validation requires either apiKey or classifier');
  }

  const flags: CounterSignalFlag[] = [];

  for (const candidate of candidates) {
    const matches = findRelatedRawArticles(candidate, rawArticles);
    if (matches.length === 0) {
      continue;
    }

    const classification = await classifier({
      weekId,
      candidate,
      relatedArticles: matches.map((match) => match.article),
    });

    const flag = buildFlag(candidate, matches, classification, generatedAt);
    if (flag) {
      flags.push(flag);
    }
  }

  return {
    generatedAt,
    candidateCount: candidates.length,
    flagged: flags,
  };
}

export function filterValidationForArticles(
  validation: CounterSignalValidationResult,
  articles: Array<Pick<ProcessedArticle, 'id'>>
): DraftValidation {
  const articleIds = new Set(articles.map((article) => article.id));

  return {
    generatedAt: validation.generatedAt,
    candidateCount: articles.length,
    flagged: validation.flagged.filter((flag) => articleIds.has(flag.candidateId)),
  };
}
