import { readFileSync } from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ProcessedArticle } from '../types.js';
import { callWithRetry, DEFAULT_GEMINI_MODEL } from './gemini.js';
import { getRankingScore } from './ranking.js';

interface SemanticDedupGroupResponse {
  ids: string[];
  reason: string;
}

interface SemanticDedupResponse {
  groups: SemanticDedupGroupResponse[];
}

export { normalizeGroups, mergeOverlappingGroups };

export interface SemanticDuplicateCluster {
  keepId: string;
  dropIds: string[];
  reason: string;
}

export interface SemanticDeduplicationResult {
  kept: ProcessedArticle[];
  removed: ProcessedArticle[];
  clusters: SemanticDuplicateCluster[];
}

interface ValidDuplicateGroup {
  ids: string[];
  reason: string;
}

function scoreArticleForDedup(article: ProcessedArticle): number {
  const rankingScore = getRankingScore(article);
  const publishedAt = new Date(article.publishedAt).getTime();
  const recencyBonus = Number.isFinite(publishedAt) ? publishedAt / 1e12 : 0;
  return rankingScore + recencyBonus;
}

function normalizeGroups(
  groups: SemanticDedupGroupResponse[],
  validIds: Set<string>
): ValidDuplicateGroup[] {
  return groups
    .map((group) => {
      const ids = [...new Set(group.ids.filter((id) => validIds.has(id)))];
      return {
        ids,
        reason: group.reason?.trim() || 'Same underlying story',
      };
    })
    .filter((group) => group.ids.length >= 2);
}

function mergeOverlappingGroups(groups: ValidDuplicateGroup[]): ValidDuplicateGroup[] {
  if (groups.length === 0) {
    return [];
  }

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id);
    if (!current || current === id) {
      return id;
    }
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  for (const group of groups) {
    for (const id of group.ids) {
      if (!parent.has(id)) {
        parent.set(id, id);
      }
    }
    const [first, ...rest] = group.ids;
    for (const id of rest) {
      union(first, id);
    }
  }

  const membersByRoot = new Map<string, Set<string>>();
  const reasonsByRoot = new Map<string, Set<string>>();

  for (const group of groups) {
    const root = find(group.ids[0]);
    if (!membersByRoot.has(root)) {
      membersByRoot.set(root, new Set<string>());
    }
    if (!reasonsByRoot.has(root)) {
      reasonsByRoot.set(root, new Set<string>());
    }

    const members = membersByRoot.get(root)!;
    const reasons = reasonsByRoot.get(root)!;
    for (const id of group.ids) {
      members.add(id);
    }
    reasons.add(group.reason);
  }

  const merged: ValidDuplicateGroup[] = [];
  for (const [root, members] of membersByRoot.entries()) {
    const ids = [...members];
    if (ids.length < 2) {
      continue;
    }
    merged.push({
      ids,
      reason: [...(reasonsByRoot.get(root) || new Set(['Same underlying story']))].join('; '),
    });
  }

  return merged;
}

export function getSemanticDedupPrompt(weekId: string, articles: ProcessedArticle[]): string {
  const articleList = articles
    .map((article, index) => {
      const shortSummary = article.summary.replace(/\s+/g, ' ').slice(0, 220);
      return `${index + 1}. ID: ${article.id}
Title: ${article.originalTitle}
Summary: ${shortSummary}
Category: ${article.category}
Scores: positivity=${article.positivity}, impact=${article.impact}
Published: ${article.publishedAt}`;
    })
    .join('\n\n');

  return `You are deduplicating story candidates for Good Brief week ${weekId}.

Identify groups of article IDs that are clearly the same underlying news story/event, even if titles are phrased differently.

Strict rules:
- Group only when confidence is high that readers would perceive them as the same story.
- Do NOT group stories just because they share a broad theme (sports, healthcare, economy, education).
- Do NOT group two different announcements from the same institution unless they refer to the same concrete event.
- If unsure, leave them ungrouped.
- Each group must contain at least 2 IDs.

Return JSON only with:
- groups: array of objects { ids: string[], reason: string }

Articles:
${articleList}`;
}

export async function deduplicateProcessedArticlesSemantically(
  articles: ProcessedArticle[],
  apiKey: string,
  weekId: string
): Promise<SemanticDeduplicationResult> {
  if (process.env.GOODBRIEF_DISABLE_SEMANTIC_DEDUP === '1') {
    return {
      kept: articles,
      removed: [],
      clusters: [],
    };
  }

  const mockPath = process.env.GOODBRIEF_SEMANTIC_DEDUP_PATH;
  if (mockPath) {
    const mock = JSON.parse(readFileSync(mockPath, 'utf-8')) as SemanticDeduplicationResult;
    return mock;
  }

  if (articles.length < 2) {
    return {
      kept: articles,
      removed: [],
      clusters: [],
    };
  }

  const responseSchema = {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of articles that are the same story',
            },
            reason: {
              type: 'string',
              description: 'Short explanation for why they are duplicates',
            },
          },
          required: ['ids', 'reason'],
        },
      },
    },
    required: ['groups'],
  };

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: DEFAULT_GEMINI_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    } as any,
  });

  const response = await callWithRetry(async () => {
    const prompt = getSemanticDedupPrompt(weekId, articles);
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(text) as SemanticDedupResponse;
  });

  const articleById = new Map(articles.map((article) => [article.id, article]));
  const validIds = new Set(articleById.keys());

  const normalized = normalizeGroups(response.groups || [], validIds);
  const mergedGroups = mergeOverlappingGroups(normalized);

  if (mergedGroups.length === 0) {
    return {
      kept: articles,
      removed: [],
      clusters: [],
    };
  }

  const removedIds = new Set<string>();
  const clusters: SemanticDuplicateCluster[] = [];

  for (const group of mergedGroups) {
    const groupArticles = group.ids
      .map((id) => articleById.get(id))
      .filter((article): article is ProcessedArticle => article !== undefined)
      .sort((a, b) => scoreArticleForDedup(b) - scoreArticleForDedup(a));

    if (groupArticles.length < 2) {
      continue;
    }

    const keep = groupArticles[0];
    const dropIds = groupArticles.slice(1).map((article) => article.id);

    for (const id of dropIds) {
      removedIds.add(id);
    }

    clusters.push({
      keepId: keep.id,
      dropIds,
      reason: group.reason,
    });
  }

  const kept = articles.filter((article) => !removedIds.has(article.id));
  const removed = articles.filter((article) => removedIds.has(article.id));

  return {
    kept,
    removed,
    clusters,
  };
}
