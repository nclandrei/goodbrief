import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  DraftValidation,
  ProcessedArticle,
  WeeklyBuffer,
  NewsletterDraft,
  WrapperCopy,
} from './types.js';
import {
  deduplicateArticles,
  findCrossWeekDuplicate,
} from './lib/deduplication.js';
import { processArticleBatch, createGeminiModel, GeminiQuotaError } from './lib/gemini.js';
import { deduplicateProcessedArticlesSemantically } from './lib/semantic-dedup.js';
import type { ArticleScore } from './lib/types.js';
import {
  COUNTER_SIGNAL_VALIDATION_POOL_SIZE,
  filterValidationForArticles,
  validateSameWeekCounterSignals,
} from './lib/counter-signal-validation.js';
import { getRankingScore } from './lib/ranking.js';
import { generateWrapperCopy } from '../emails/utils/generate-copy.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sendAlert } from './lib/alert.js';
import { resolveProjectRoot } from './lib/project-root.js';
import {
  loadHistoricalArticles,
  type HistoricalArticle,
} from './lib/story-history.js';

const ROOT_DIR = resolveProjectRoot(import.meta.url);

function parseLookbackEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PUBLISHED_ISSUE_LOOKBACK = parseLookbackEnv(process.env.PUBLISHED_ISSUE_LOOKBACK, 8);
const DRAFT_LOOKBACK = parseLookbackEnv(process.env.DRAFT_LOOKBACK, 2);
const SEMANTIC_DEDUP_POOL_SIZE = parseLookbackEnv(process.env.SEMANTIC_DEDUP_POOL_SIZE, 60);
const FINAL_SELECTED_COUNT = parseLookbackEnv(process.env.FINAL_SELECTED_COUNT, 10);
const FINAL_RESERVES_COUNT = parseLookbackEnv(process.env.FINAL_RESERVES_COUNT, 30);
const FINAL_SHORTLIST_COUNT = FINAL_SELECTED_COUNT + FINAL_RESERVES_COUNT;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const model = createGeminiModel(GEMINI_API_KEY, false);

function getISOWeekId(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 -
      3 +
      ((week1.getDay() + 6) % 7)) /
      7 +
      1
  );
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

interface RefinementResult {
  selectedIds: string[];
  intro: string;
  shortSummary: string;
  reasoning: string;
}

async function refineDraft(
  selected: ProcessedArticle[],
  reserves: ProcessedArticle[],
  wrapperCopy: WrapperCopy,
  weekId: string,
  validation: DraftValidation,
  previousArticles: HistoricalArticle[] = [],
  lookbackLabel: string = 'last editions'
): Promise<{ selected: ProcessedArticle[]; reserves: ProcessedArticle[]; wrapperCopy: WrapperCopy }> {
  if (process.env.GOODBRIEF_DISABLE_DRAFT_REFINEMENT === '1') {
    return { selected, reserves, wrapperCopy };
  }

  const mockPath = process.env.GOODBRIEF_DRAFT_REFINEMENT_PATH;
  if (mockPath) {
    const refinement = JSON.parse(readFileSync(mockPath, 'utf-8')) as RefinementResult;
    const allArticles = [...selected, ...reserves];
    const articleMap = new Map(allArticles.map((article) => [article.id, article]));
    const usedIds = new Set<string>();
    const newSelected: ProcessedArticle[] = [];

    for (const id of refinement.selectedIds) {
      const article = articleMap.get(id);
      if (article && !usedIds.has(id)) {
        newSelected.push(article);
        usedIds.add(id);
      }
    }

    if (newSelected.length >= 9 && newSelected.length <= 12) {
      return {
        selected: newSelected,
        reserves: allArticles.filter((article) => !usedIds.has(article.id)),
        wrapperCopy: {
          ...wrapperCopy,
          intro: refinement.intro,
          shortSummary: refinement.shortSummary,
        },
      };
    }
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!);

  const refinementSchema = {
    type: 'object',
    properties: {
      selectedIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered list of 10 article IDs for the final selection',
      },
      intro: { type: 'string', description: 'Refined intro paragraph (2-3 sentences)' },
      shortSummary: { type: 'string', description: 'Refined short summary (60-80 chars)' },
      reasoning: { type: 'string', description: 'Brief explanation of changes made' },
    },
    required: ['selectedIds', 'intro', 'shortSummary', 'reasoning'],
  };

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: refinementSchema,
    } as any,
  });

  const allArticles = [...selected, ...reserves];
  const articleById = new Map(allArticles.map((article) => [article.id, article]));
  const validationById = new Map(
    (validation.flagged || []).map((flag) => [flag.candidateId, flag])
  );
  const articleList = allArticles
    .map((a, i) => {
      const flag = validationById.get(a.id);
      const validationNote = flag
        ? `\n   Same-week validation: ${flag.verdict.toUpperCase()} — ${flag.reason}`
        : '';
      return `${i + 1}. [ID: ${a.id}] [${a.category}] (pos:${a.positivity}, impact:${a.impact}) "${a.originalTitle}"\n   Summary: ${a.summary}${validationNote}`;
    })
    .join('\n\n');

  const previousWeeksContext = previousArticles.length > 0
    ? `\n\nPREVIOUSLY PUBLISHED (${lookbackLabel} - DO NOT SELECT similar stories):
${previousArticles.slice(0, 20).map((a, i) => `${i + 1}. "${a.title}"`).join('\n')}
${previousArticles.length > 20 ? `... and ${previousArticles.length - 20} more` : ''}`
    : '';

  const validationContext = validation.flagged.length > 0
    ? `\n\nSAME-WEEK VALIDATION FLAGS:
${validation.flagged
  .map((flag, index) => {
    const articleTitle = articleById.get(flag.candidateId)?.originalTitle || flag.candidateId;
    return `${index + 1}. [${flag.verdict.toUpperCase()}] [ID: ${flag.candidateId}] "${articleTitle}"
   Reason: ${flag.reason}`;
  })
  .join('\n')}

IMPORTANT VALIDATION RULES:
- STRONG flags should stay out of selected by default.
- BORDERLINE flags may stay only if alternatives are clearly weaker.
- If a flagged story survives, make sure the rest of the selection is still strong enough to justify it.`
    : '';

  const prompt = `You are reviewing a Good Brief newsletter draft for week ${weekId}.

IMPORTANT: All text output (intro, shortSummary, reasoning) MUST be in Romanian. This is a Romanian newsletter.
${previousWeeksContext}
${validationContext}

CURRENT SELECTION (top 10):
${selected.map((a, i) => `${i + 1}. [ID: ${a.id}] "${a.originalTitle}"`).join('\n')}

CURRENT INTRO (in Romanian):
"${wrapperCopy.intro}"

CURRENT SHORT SUMMARY (in Romanian):
"${wrapperCopy.shortSummary}"

ALL AVAILABLE ARTICLES (selected + reserves):
${articleList}

REVIEW CRITERIA:
1. Story variety: Avoid duplicate stories or very similar topics. Look for redundant coverage.
2. NO REPEATS: Do NOT select articles similar to previously published stories (see list above)
3. Category balance: Aim for mix of wins, local-heroes, green-stuff, quick-hits
4. Impact vs fluff: Prefer substantive stories over feel-good fluff
5. Recency: Prefer more recent stories when quality is similar
6. Intro quality: Should be warm, engaging, capture the week's essence (IN ROMANIAN)
7. Avoid promotional content or sponsored articles (marked with "(P)")
8. Respect same-week validation flags: strong flags should normally be excluded; borderline flags need a clear editorial reason to stay

TASK:
- Review the current selection critically
- If you find issues (duplicates, weak stories, imbalance, REPEATS from previous weeks), swap articles from reserves
- If the intro could be sharper or better reflect the final selection, improve it (KEEP IT IN ROMANIAN)
- Return 9-12 article IDs in your preferred order

Return JSON with:
- selectedIds: array of 9-12 article IDs in display order
- intro: the intro IN ROMANIAN (improved if needed, keep original if good)
- shortSummary: the short summary IN ROMANIAN (improved if needed)
- reasoning: brief explanation of what you changed and why (or "No changes needed")`;

  console.log('Reviewing draft for improvements...');
  const result = await model.generateContent(prompt);
  const content = result.response.text();

  if (!content) {
    console.log('No refinement response, keeping original draft');
    return { selected, reserves, wrapperCopy };
  }

  try {
    const refinement = JSON.parse(content) as RefinementResult;
    console.log(`✓ Review complete: ${refinement.reasoning}`);

    if (refinement.selectedIds.length < 9 || refinement.selectedIds.length > 12) {
      console.log(`Warning: Expected 9-12 articles, got ${refinement.selectedIds.length}. Keeping original.`);
      return { selected, reserves, wrapperCopy };
    }

    const articleMap = new Map(allArticles.map((a) => [a.id, a]));
    const newSelected: ProcessedArticle[] = [];
    const usedIds = new Set<string>();

    for (const id of refinement.selectedIds) {
      const article = articleMap.get(id);
      if (article && !usedIds.has(id)) {
        newSelected.push(article);
        usedIds.add(id);
      }
    }

    if (newSelected.length < 9 || newSelected.length > 12) {
      console.log(`Warning: Could only find ${newSelected.length} valid articles. Keeping original.`);
      return { selected, reserves, wrapperCopy };
    }

    const newReserves = allArticles.filter((a) => !usedIds.has(a.id));

    const newWrapperCopy: WrapperCopy = {
      ...wrapperCopy,
      intro: refinement.intro,
      shortSummary: refinement.shortSummary,
    };

    return { selected: newSelected, reserves: newReserves, wrapperCopy: newWrapperCopy };
  } catch (error) {
    console.log('Failed to parse refinement response, keeping original draft');
    return { selected, reserves, wrapperCopy };
  }
}

async function main() {
  const weekId = getISOWeekId();
  const rawPath = join(ROOT_DIR, 'data', 'raw', `${weekId}.json`);

  if (!existsSync(rawPath)) {
    await sendAlert({
      title: 'Draft generation failed',
      weekId,
      reason: 'No raw data found for this week',
      actionItems: [
        'Check if the ingest-news workflow ran successfully',
        `Verify the file exists at <code>data/raw/${weekId}.json</code>`,
        'Run <code>npm run ingest-news</code> manually if needed',
      ],
    });
    console.error(`No raw data found for ${weekId}`);
    process.exit(1);
  }

  const buffer: WeeklyBuffer = JSON.parse(readFileSync(rawPath, 'utf-8'));
  console.log(`Processing ${buffer.articles.length} articles for ${weekId}`);

  if (buffer.articles.length === 0) {
    await sendAlert({
      title: 'Draft generation failed',
      weekId,
      reason: 'Raw data file is empty (no articles ingested this week)',
      actionItems: [
        'Check if RSS feeds are working correctly',
        'Run <code>npm run ingest-news</code> manually to debug',
        'Consider if this is a holiday week with less news coverage',
      ],
    });
    console.error('No articles to process');
    process.exit(1);
  }

  console.log('Deduplicating articles...');
  const dedupResult = deduplicateArticles(buffer.articles);
  const sameWeekRepresentatives = dedupResult.outputArticles;
  let representatives = [...sameWeekRepresentatives];
  console.log(
    `Deduplicated ${buffer.articles.length} articles to ${representatives.length} unique stories`
  );

  // Pre-filter against historical issues + drafts
  console.log('Loading historical stories from previous editions...');
  const historical = loadHistoricalArticles({
    rootDir: ROOT_DIR,
    currentWeekId: weekId,
    issueLookback: PUBLISHED_ISSUE_LOOKBACK,
    draftLookback: DRAFT_LOOKBACK,
  });
  const previousArticles = historical.articles;
  console.log(
    `Loaded ${previousArticles.length} historical stories (${historical.issueFilesLoaded} issue files, ${historical.draftFilesLoaded} draft files)`
  );

  console.log('Filtering out articles already covered in recent editions...');

  const beforeFilter = representatives.length;
  representatives = representatives.filter((article) => {
    const duplicate = findCrossWeekDuplicate(article, previousArticles);
    if (!duplicate) {
      return true;
    }

    const similarityPct = Math.round(duplicate.titleSimilarity * 100);
    const tokenOverlapPct = Math.round(duplicate.tokenOverlap * 100);
    console.log(
      `  Filtered (${duplicate.reason}): "${article.title}" ↔ "${duplicate.previousTitle}" [title:${similarityPct}% tokens:${tokenOverlapPct}%]`
    );
    return false;
  });

  const filtered = beforeFilter - representatives.length;
  console.log(`Filtered out ${filtered} articles that were likely covered before`);
  console.log(`Remaining: ${representatives.length} articles to process`);

  const BATCH_SIZE = 200;
  const allScores: ArticleScore[] = [];

  try {
    for (let i = 0; i < representatives.length; i += BATCH_SIZE) {
      const batch = representatives.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(representatives.length / BATCH_SIZE)}...`
      );
      const scores = await processArticleBatch(batch, model, false);
      allScores.push(...scores);

      if (i + BATCH_SIZE < representatives.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } catch (error) {
    if (error instanceof GeminiQuotaError) {
      await sendAlert({
        title: 'Gemini API quota exhausted',
        weekId,
        reason: 'The Gemini API free tier quota has been exceeded',
        details: error.message,
        actionItems: [
          'Wait for the quota to reset (usually resets daily)',
          'Check usage at <a href="https://aistudio.google.com/">Google AI Studio</a>',
          'Consider upgrading to a paid plan if this happens frequently',
          'Run <code>npm run generate-draft</code> manually after quota resets',
        ],
      });
      console.error('Gemini quota exhausted:', error.message);
      process.exit(1);
    }
    throw error;
  }

  const scoreMap = new Map(allScores.map((s) => [s.id, s]));
  const now = new Date().toISOString();
  const seenIds = new Set<string>();

  const processed: ProcessedArticle[] = representatives
    .map((raw) => {
      if (seenIds.has(raw.id)) return null;
      seenIds.add(raw.id);

      const score = scoreMap.get(raw.id);
      if (!score) return null;
      if (!score.romaniaRelevant) return null;
      return {
        id: raw.id,
        sourceId: raw.sourceId,
        sourceName: raw.sourceName,
        originalTitle: raw.title,
        url: raw.url,
        summary: score.summary,
        positivity: score.positivity,
        impact: score.impact,
        category: score.category,
        publishedAt: raw.publishedAt,
        processedAt: now,
      };
    })
    .filter((p): p is ProcessedArticle => p !== null);

  let positive = processed.filter((p) => p.positivity >= 40);
  const discarded = processed.length - positive.length;

  // Alert if we don't have enough positive articles for a newsletter
  if (positive.length < 5) {
    await sendAlert({
      title: 'Not enough positive articles',
      weekId,
      reason: `Only ${positive.length} positive articles found (need at least 5)`,
      details: `Total processed: ${processed.length}, Discarded (low positivity): ${discarded}`,
      actionItems: [
        'Review the raw articles manually to see if scores are too strict',
        'Consider lowering the positivity threshold temporarily',
        'Check if news sources are providing enough positive content',
        'The newsletter may need to be skipped this week',
      ],
    });
    console.error(`Not enough positive articles: ${positive.length}`);
    process.exit(1);
  }

  positive.sort((a, b) => {
    const scoreA = getRankingScore(a);
    const scoreB = getRankingScore(b);
    return scoreB - scoreA;
  });

  if (positive.length > 1) {
    // Always deduplicate at least the full final shortlist (selected + reserves).
    const semanticPoolTarget = Math.max(SEMANTIC_DEDUP_POOL_SIZE, FINAL_SHORTLIST_COUNT);
    const semanticPoolSize = Math.min(semanticPoolTarget, positive.length);
    const semanticPool = positive.slice(0, semanticPoolSize);
    const semanticPoolById = new Map(semanticPool.map((article) => [article.id, article]));

    console.log(`Running semantic deduplication on top ${semanticPoolSize} candidates...`);

    try {
      const semanticDedup = await deduplicateProcessedArticlesSemantically(
        semanticPool,
        GEMINI_API_KEY!,
        weekId
      );

      if (semanticDedup.removed.length > 0) {
        const removedIds = new Set(semanticDedup.removed.map((article) => article.id));
        positive = positive.filter((article) => !removedIds.has(article.id));

        console.log(
          `Removed ${semanticDedup.removed.length} semantically duplicate stories`
        );
        for (const cluster of semanticDedup.clusters) {
          const keepTitle =
            semanticPoolById.get(cluster.keepId)?.originalTitle || cluster.keepId;
          const dropTitles = cluster.dropIds
            .map((id) => semanticPoolById.get(id)?.originalTitle || id)
            .join(' | ');

          console.log(`  Keep: "${keepTitle}"`);
          console.log(`  Drop: ${dropTitles}`);
        }
      } else {
        console.log('No semantic duplicates found in top candidates');
      }
    } catch (error) {
      if (error instanceof GeminiQuotaError) {
        console.log(`Semantic deduplication skipped (quota): ${error.message}`);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`Semantic deduplication skipped (error): ${message}`);
      }
    }
  }

  let fullValidation: DraftValidation = {
    generatedAt: now,
    candidateCount: 0,
    flagged: [],
  };

  const validationPoolSize = Math.min(
    COUNTER_SIGNAL_VALIDATION_POOL_SIZE,
    positive.length
  );
  if (validationPoolSize > 0) {
    console.log(
      `Running same-week counter-signal validation on top ${validationPoolSize} candidates...`
    );

    try {
      fullValidation = await validateSameWeekCounterSignals({
        weekId,
        candidates: positive.slice(0, validationPoolSize),
        rawArticles: sameWeekRepresentatives,
        apiKey: GEMINI_API_KEY!,
        generatedAt: now,
      });

      const validationById = new Map(
        fullValidation.flagged.map((flag) => [flag.candidateId, flag])
      );

      positive.sort((a, b) => {
        const adjustedA =
          getRankingScore(a) - (validationById.get(a.id)?.penaltyApplied || 0);
        const adjustedB =
          getRankingScore(b) - (validationById.get(b.id)?.penaltyApplied || 0);

        if (adjustedB !== adjustedA) {
          return adjustedB - adjustedA;
        }

        return getRankingScore(b) - getRankingScore(a);
      });

      const strongFlags = fullValidation.flagged.filter(
        (flag) => flag.verdict === 'strong'
      ).length;
      const borderlineFlags = fullValidation.flagged.filter(
        (flag) => flag.verdict === 'borderline'
      ).length;

      console.log(
        `Counter-signal validation flagged ${fullValidation.flagged.length} candidates (${strongFlags} strong, ${borderlineFlags} borderline)`
      );

      const shortlistIds = new Set(
        positive.slice(0, FINAL_SHORTLIST_COUNT).map((article) => article.id)
      );
      const penalizedShortlist = fullValidation.flagged.filter((flag) =>
        shortlistIds.has(flag.candidateId)
      );

      if (penalizedShortlist.length > 0) {
        for (const flag of penalizedShortlist) {
          const title =
            positive.find((article) => article.id === flag.candidateId)?.originalTitle ||
            flag.candidateId;
          console.log(
            `  ${flag.verdict.toUpperCase()}: "${title}" (-${flag.penaltyApplied})`
          );
        }
      }
    } catch (error) {
      if (error instanceof GeminiQuotaError) {
        console.log(`Counter-signal validation skipped (quota): ${error.message}`);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`Counter-signal validation skipped (error): ${message}`);
      }
    }
  }

  const initialSelected = positive.slice(0, FINAL_SELECTED_COUNT);
  const initialReserves = positive.slice(FINAL_SELECTED_COUNT, FINAL_SHORTLIST_COUNT);
  const shortlistValidation = filterValidationForArticles(fullValidation, [
    ...initialSelected,
    ...initialReserves,
  ]);

  console.log(
    `Final shortlist for review: ${initialSelected.length} selected + ${initialReserves.length} reserves`
  );

  console.log('Generating wrapper copy...');
  const initialWrapperCopy = await generateWrapperCopy(initialSelected, weekId);
  console.log('✓ Generated wrapper copy');

  console.log('\n--- Pass 2: Self-review ---');
  const refined = await refineDraft(
    initialSelected,
    initialReserves,
    initialWrapperCopy,
    weekId,
    shortlistValidation,
    previousArticles,
    `last ${PUBLISHED_ISSUE_LOOKBACK} published issues + ${DRAFT_LOOKBACK} draft weeks`
  );

  const draftValidation = filterValidationForArticles(fullValidation, [
    ...refined.selected,
    ...refined.reserves,
  ]);

  const draft: NewsletterDraft = {
    weekId,
    generatedAt: now,
    selected: refined.selected,
    reserves: refined.reserves,
    discarded,
    totalProcessed: processed.length,
    wrapperCopy: refined.wrapperCopy,
    validation: draftValidation,
  };

  const draftPath = join(ROOT_DIR, 'data', 'drafts', `${weekId}.json`);
  writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf-8');

  console.log(`\nDraft saved to ${draftPath}`);
  console.log(
    `Selected: ${draft.selected.length}, Reserves: ${draft.reserves.length}, Discarded: ${discarded}`
  );
}

main().catch(async (error) => {
  // Send alert for unexpected errors
  await sendAlert({
    title: 'Draft generation crashed',
    reason: 'An unexpected error occurred during draft generation',
    details: error instanceof Error ? error.stack || error.message : String(error),
    actionItems: [
      'Check the GitHub Actions logs for more details',
      'Run <code>npm run generate-draft</code> locally to debug',
      'If the error persists, check for code issues in <code>scripts/generate-draft.ts</code>',
    ],
  });
  console.error('Fatal error:', error);
  process.exit(1);
});
