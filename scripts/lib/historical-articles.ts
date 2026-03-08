import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  canonicalizeStoryUrl,
  normalizeTitle,
} from './deduplication.js';

function parseLookbackEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const PUBLISHED_ISSUE_LOOKBACK = parseLookbackEnv(
  process.env.PUBLISHED_ISSUE_LOOKBACK,
  8
);
export const DRAFT_LOOKBACK = parseLookbackEnv(process.env.DRAFT_LOOKBACK, 2);

export interface HistoricalArticle {
  id?: string;
  title: string;
  url: string;
  source: 'draft' | 'issue';
  origin: string;
}

interface DraftFileShape {
  selected?: Array<{
    id?: string;
    title?: string;
    originalTitle?: string;
    url?: string;
  }>;
}

export interface HistoricalLoadResult {
  articles: HistoricalArticle[];
  draftFilesLoaded: number;
  issueFilesLoaded: number;
}

function loadPreviousDraftArticles(
  rootDir: string,
  currentWeekId: string,
  weeksToLoad: number
): { articles: HistoricalArticle[]; filesLoaded: number } {
  const draftsDir = join(rootDir, 'data', 'drafts');
  if (!existsSync(draftsDir)) {
    return { articles: [], filesLoaded: 0 };
  }

  const history: HistoricalArticle[] = [];
  let filesLoaded = 0;

  const draftFiles = readdirSync(draftsDir)
    .filter((file) => file.endsWith('.json') && file !== `${currentWeekId}.json`)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, weeksToLoad);

  for (const file of draftFiles) {
    try {
      const draft = JSON.parse(readFileSync(join(draftsDir, file), 'utf-8')) as DraftFileShape;
      if (Array.isArray(draft.selected)) {
        for (const article of draft.selected) {
          const title = article.originalTitle || article.title;
          if (!title || !article.url) {
            continue;
          }

          history.push({
            id: article.id,
            title,
            url: article.url,
            source: 'draft',
            origin: file,
          });
        }
      }
      filesLoaded += 1;
    } catch (error) {
      console.warn(`Failed to load ${file}:`, error);
    }
  }

  return { articles: history, filesLoaded };
}

function parseIssueMarkdown(markdown: string): Array<{ title: string; url: string }> {
  const items: Array<{ title: string; url: string }> = [];
  const lines = markdown.split('\n');
  let pendingTitle: string | null = null;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      pendingTitle = line.replace(/^###\s+/, '').trim();
      continue;
    }

    if (!pendingTitle || !line.startsWith('→ [')) {
      continue;
    }

    const linkMatch = line.match(/\((https?:\/\/.+)\)\s*$/);
    if (!linkMatch) {
      continue;
    }

    items.push({ title: pendingTitle, url: linkMatch[1] });
    pendingTitle = null;
  }

  return items;
}

function loadPublishedIssueArticles(
  rootDir: string,
  issuesToLoad: number
): { articles: HistoricalArticle[]; filesLoaded: number } {
  const issuesDir = join(rootDir, 'content', 'issues');
  if (!existsSync(issuesDir)) {
    return { articles: [], filesLoaded: 0 };
  }

  const issueFiles = readdirSync(issuesDir)
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, issuesToLoad);

  const history: HistoricalArticle[] = [];
  let filesLoaded = 0;

  for (const file of issueFiles) {
    try {
      const markdown = readFileSync(join(issuesDir, file), 'utf-8');
      const issueItems = parseIssueMarkdown(markdown);
      for (const item of issueItems) {
        history.push({
          title: item.title,
          url: item.url,
          source: 'issue',
          origin: file,
        });
      }
      filesLoaded += 1;
    } catch (error) {
      console.warn(`Failed to load issue ${file}:`, error);
    }
  }

  return { articles: history, filesLoaded };
}

export function loadHistoricalArticles(
  rootDir: string,
  currentWeekId: string,
  issueLookback: number = PUBLISHED_ISSUE_LOOKBACK,
  draftLookback: number = DRAFT_LOOKBACK
): HistoricalLoadResult {
  const fromIssues = loadPublishedIssueArticles(rootDir, issueLookback);
  const fromDrafts = loadPreviousDraftArticles(rootDir, currentWeekId, draftLookback);

  const merged = [...fromIssues.articles, ...fromDrafts.articles];
  const deduped = new Map<string, HistoricalArticle>();

  for (const article of merged) {
    const canonicalUrl = canonicalizeStoryUrl(article.url);
    const normalizedTitle = normalizeTitle(article.title);
    const key = `${canonicalUrl || article.url}::${normalizedTitle}`;
    if (!deduped.has(key)) {
      deduped.set(key, article);
    }
  }

  return {
    articles: [...deduped.values()],
    draftFilesLoaded: fromDrafts.filesLoaded,
    issueFilesLoaded: fromIssues.filesLoaded,
  };
}

