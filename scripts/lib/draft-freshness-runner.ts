import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { NewsletterDraft, ProcessedArticle, WrapperCopy } from '../types.js';
import {
  type ArchiveReviewDecision,
  type ArchiveReviewInputItem,
  type ValidateDraftFreshnessResult,
  validateDraftFreshness,
} from './draft-validation.js';
import type { LlmProvider } from './llm/provider.js';
import {
  getLatestDraftWeekId,
  parseWeekArg,
} from './pipeline-artifacts.js';
import { loadHistoricalArticles } from './story-history.js';

export const RECENT_DRAFT_LOOKBACK = 4;

export interface DraftFreshnessValidationRunResult {
  weekId: string;
  draftPath: string;
  result: ValidateDraftFreshnessResult;
}

export interface RunDraftFreshnessValidationOptions {
  rootDir: string;
  args: string[];
  llm?: Pick<LlmProvider, 'generateWrapperCopy'>;
  now?: Date;
  reviewArchive?: (
    items: ArchiveReviewInputItem[],
    weekId: string
  ) => Promise<ArchiveReviewDecision[]>;
  logger?: (message: string) => void;
}

export function createProviderWrapperCopyGenerator(
  llm: Pick<LlmProvider, 'generateWrapperCopy'>
): (articles: ProcessedArticle[], weekId: string) => Promise<WrapperCopy> {
  return (articles, weekId) => llm.generateWrapperCopy(weekId, articles);
}

function resolveDraftWeekId(rootDir: string, args: string[]): string {
  const draftsDir = join(rootDir, 'data', 'drafts');
  const weekId = parseWeekArg(args) || getLatestDraftWeekId(rootDir);

  if (!weekId || !existsSync(draftsDir)) {
    throw new Error('No draft files found to validate');
  }

  return weekId;
}

function loadDraft(rootDir: string, weekId: string): NewsletterDraft {
  const draftPath = join(rootDir, 'data', 'drafts', `${weekId}.json`);
  if (!existsSync(draftPath)) {
    throw new Error(`Draft not found at ${draftPath}`);
  }

  return JSON.parse(readFileSync(draftPath, 'utf-8')) as NewsletterDraft;
}

export async function runDraftFreshnessValidation(
  options: RunDraftFreshnessValidationOptions
): Promise<DraftFreshnessValidationRunResult> {
  const log = options.logger ?? console.log;
  const weekId = resolveDraftWeekId(options.rootDir, options.args);

  log(`\n🛡️ Good Brief Draft Archive Gate`);
  log(`Week: ${weekId}\n`);

  const draft = loadDraft(options.rootDir, weekId);
  log(`Loaded draft: ${draft.selected.length} selected, ${draft.reserves.length} reserves`);

  const history = loadHistoricalArticles({
    rootDir: options.rootDir,
    currentWeekId: weekId,
    draftLookback: RECENT_DRAFT_LOOKBACK,
  });

  log(
    `Loaded ${history.articles.length} historical stories (${history.issueArticleCount} published, ${history.draftArticleCount} recent draft)`
  );

  const result = await validateDraftFreshness({
    draft,
    historicalArticles: history.articles,
    recentDraftCount: history.draftArticleCount,
    publishedHistoryCount: history.issueArticleCount,
    now: options.now,
    reviewArchive: options.reviewArchive,
    generateWrapperCopy: options.llm
      ? createProviderWrapperCopyGenerator(options.llm)
      : undefined,
  });

  const draftPath = join(options.rootDir, 'data', 'drafts', `${weekId}.json`);
  writeFileSync(draftPath, JSON.stringify(result.draft, null, 2), 'utf-8');

  return {
    weekId,
    draftPath,
    result,
  };
}
