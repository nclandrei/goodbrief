import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { NewsletterDraft } from '../types.js';
import {
  type ValidateDraftFreshnessResult,
  validateDraftFreshness,
} from './draft-validation.js';
import { parseWeekId } from './newsletter-week.js';
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
  now?: Date;
  logger?: (message: string) => void;
}

function resolveDraftWeekId(rootDir: string, args: string[]): string {
  const draftsDir = join(rootDir, 'data', 'drafts');
  if (!existsSync(draftsDir)) {
    throw new Error('No draft files found to validate');
  }

  const weekIndex = args.indexOf('--week');
  if (weekIndex !== -1 && !args[weekIndex + 1]) {
    throw new Error('Missing value for --week');
  }
  const weekId = weekIndex !== -1
    ? args[weekIndex + 1]
    : readdirSync(draftsDir)
        .filter((file) => /^\d{4}-W\d{2}\.json$/.test(file))
        .sort()
        .at(-1)?.replace('.json', '');
  if (!weekId) {
    throw new Error('No draft files found to validate');
  }
  parseWeekId(weekId);
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

  log(`\n🛡️ Good Brief Deterministic Draft Freshness Check (read-only)`);
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
  });

  const draftPath = join(options.rootDir, 'data', 'drafts', `${weekId}.json`);

  return {
    weekId,
    draftPath,
    result,
  };
}
