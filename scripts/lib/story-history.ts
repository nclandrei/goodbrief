import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { canonicalizeStoryUrl, normalizeTitle } from './deduplication.js';

export interface HistoricalArticle {
  id?: string;
  weekId?: string;
  title: string;
  summary: string;
  url: string;
  publishedAt?: string;
  source: 'draft' | 'issue';
  origin: string;
}

export interface HistoricalLoadResult {
  articles: HistoricalArticle[];
  draftFilesLoaded: number;
  issueFilesLoaded: number;
  draftArticleCount: number;
  issueArticleCount: number;
}

interface StoredDraftArticle {
  id?: string;
  title?: string;
  originalTitle?: string;
  summary?: string;
  url?: string;
  publishedAt?: string;
}

interface DraftFileShape {
  weekId?: string;
  selected?: StoredDraftArticle[];
  reserves?: StoredDraftArticle[];
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) {
    return markdown;
  }

  const end = markdown.indexOf('\n---\n', 4);
  if (end === -1) {
    return markdown;
  }

  return markdown.slice(end + 5);
}

export function parseIssueMarkdown(markdown: string): Array<{
  title: string;
  summary: string;
  url: string;
}> {
  const items: Array<{ title: string; summary: string; url: string }> = [];
  const lines = stripFrontmatter(markdown).split('\n');
  let pendingTitle: string | null = null;
  let summaryLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith('### ')) {
      if (pendingTitle) {
        summaryLines = [];
      }
      pendingTitle = line.replace(/^###\s+/, '').trim();
      continue;
    }

    if (!pendingTitle) {
      continue;
    }

    if (line.startsWith('→ [')) {
      const linkMatch = line.match(/\((https?:\/\/.+)\)\s*$/);
      if (linkMatch) {
        items.push({
          title: pendingTitle,
          summary: summaryLines.join(' ').replace(/\s+/g, ' ').trim(),
          url: linkMatch[1],
        });
      }
      pendingTitle = null;
      summaryLines = [];
      continue;
    }

    if (line.length > 0) {
      summaryLines.push(line);
    }
  }

  return items;
}

export function loadPublishedIssueArticles(
  rootDir: string,
  issuesToLoad?: number
): { articles: HistoricalArticle[]; filesLoaded: number } {
  const issuesDir = join(rootDir, 'content', 'issues');
  if (!existsSync(issuesDir)) {
    return { articles: [], filesLoaded: 0 };
  }

  let issueFiles = readdirSync(issuesDir)
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => b.localeCompare(a));

  if (typeof issuesToLoad === 'number') {
    issueFiles = issueFiles.slice(0, issuesToLoad);
  }

  const history: HistoricalArticle[] = [];
  let filesLoaded = 0;

  for (const file of issueFiles) {
    try {
      const markdown = readFileSync(join(issuesDir, file), 'utf-8');
      const issueItems = parseIssueMarkdown(markdown);
      for (const item of issueItems) {
        history.push({
          title: item.title,
          summary: item.summary,
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

export function loadPreviousDraftArticles(
  rootDir: string,
  currentWeekId: string | null,
  weeksToLoad: number,
  includeReserves: boolean = false
): { articles: HistoricalArticle[]; filesLoaded: number } {
  const draftsDir = join(rootDir, 'data', 'drafts');
  if (!existsSync(draftsDir)) {
    return { articles: [], filesLoaded: 0 };
  }

  const draftFiles = readdirSync(draftsDir)
    .filter((file) => file.endsWith('.json') && file !== `${currentWeekId}.json`)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, weeksToLoad);

  const previous: HistoricalArticle[] = [];
  let filesLoaded = 0;

  for (const file of draftFiles) {
    try {
      const draft = JSON.parse(readFileSync(join(draftsDir, file), 'utf-8')) as DraftFileShape;
      const draftArticles = [
        ...(Array.isArray(draft.selected) ? draft.selected : []),
        ...(includeReserves && Array.isArray(draft.reserves) ? draft.reserves : []),
      ];

      for (const article of draftArticles) {
        const title = article.originalTitle || article.title;
        if (!title || !article.url) {
          continue;
        }

        previous.push({
          id: article.id,
          weekId: draft.weekId || file.replace(/\.json$/, ''),
          title,
          summary: article.summary || '',
          url: article.url,
          publishedAt: article.publishedAt,
          source: 'draft',
          origin: file,
        });
      }

      filesLoaded += 1;
    } catch (error) {
      console.warn(`Failed to load draft ${file}:`, error);
    }
  }

  return { articles: previous, filesLoaded };
}

export function loadHistoricalArticles(options: {
  rootDir: string;
  currentWeekId?: string | null;
  issueLookback?: number;
  draftLookback?: number;
  includeDraftReserves?: boolean;
}): HistoricalLoadResult {
  const fromIssues = loadPublishedIssueArticles(options.rootDir, options.issueLookback);
  const fromDrafts = loadPreviousDraftArticles(
    options.rootDir,
    options.currentWeekId ?? null,
    options.draftLookback ?? 0,
    options.includeDraftReserves ?? false
  );

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

  const articles = [...deduped.values()];

  return {
    articles,
    draftFilesLoaded: fromDrafts.filesLoaded,
    issueFilesLoaded: fromIssues.filesLoaded,
    draftArticleCount: articles.filter((article) => article.source === 'draft').length,
    issueArticleCount: articles.filter((article) => article.source === 'issue').length,
  };
}
