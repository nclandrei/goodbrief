import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateWrapperCopy } from '../../emails/utils/generate-copy.js';
import type {
  ArticleScore,
} from './types.js';
import type {
  CounterSignalPipelineData,
  DraftPipelineArtifact,
  DraftValidation,
  NewsletterDraft,
  PreparedPipelineData,
  ProcessedArticle,
  RefinedDraftPipelineData,
  ScoredPipelineData,
  SemanticDedupPipelineData,
  ShortlistPipelineData,
  WeeklyBuffer,
  WrapperCopy,
  WrapperCopyPipelineData,
} from '../types.js';
import {
  deduplicateArticles,
  findCrossWeekDuplicate,
} from './deduplication.js';
import {
  COUNTER_SIGNAL_VALIDATION_POOL_SIZE,
  filterValidationForArticles,
  type CounterSignalClassifier,
  validateSameWeekCounterSignals,
} from './counter-signal-validation.js';
import {
  createGeminiModel,
  DEFAULT_GEMINI_MODEL,
  GeminiQuotaError,
  processArticleBatch,
} from './gemini.js';
import { loadHistoricalArticles, type HistoricalArticle } from './historical-articles.js';
import { getRankingScore } from './ranking.js';
import { deduplicateProcessedArticlesSemantically } from './semantic-dedup.js';
import {
  PIPELINE_ARTIFACT_FILENAMES,
  readPipelineArtifact,
  writePipelineArtifact,
} from './pipeline-artifacts.js';
import { sendAlert } from './alert.js';
import {
  isBureaucraticStory,
  isCommunityCentered,
  isGreenPreferred,
  rebalancePreferredSelection,
  selectBalancedShortlist,
} from './editorial-balance.js';

function parseLookbackEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SEMANTIC_DEDUP_POOL_SIZE = parseLookbackEnv(process.env.SEMANTIC_DEDUP_POOL_SIZE, 60);
const FINAL_SELECTED_COUNT = parseLookbackEnv(process.env.FINAL_SELECTED_COUNT, 10);
const FINAL_RESERVES_COUNT = parseLookbackEnv(process.env.FINAL_RESERVES_COUNT, 30);
const FINAL_SHORTLIST_COUNT = FINAL_SELECTED_COUNT + FINAL_RESERVES_COUNT;

interface RefinementResult {
  selectedIds: string[];
  intro: string;
  shortSummary: string;
  reasoning: string;
}

function loadWeeklyBuffer(rootDir: string, weekId: string): WeeklyBuffer {
  const rawPath = join(rootDir, 'data', 'raw', `${weekId}.json`);
  if (!existsSync(rawPath)) {
    throw new Error(`No raw data found for ${weekId} at ${rawPath}`);
  }

  const content = readFileSync(rawPath, 'utf-8');
  if (content.startsWith('version https://git-lfs.github.com/spec/v1')) {
    throw new Error(
      `Raw data file for ${weekId} is still a Git LFS pointer. Run \`npm run ingest-news\` locally or ensure Git LFS pulled the weekly buffer first.`
    );
  }

  return JSON.parse(content) as WeeklyBuffer;
}

function loadMockJson<T>(envVar: string): T | null {
  const mockPath = process.env[envVar];
  if (!mockPath) {
    return null;
  }

  return JSON.parse(readFileSync(mockPath, 'utf-8')) as T;
}

function getDraftPath(rootDir: string, weekId: string): string {
  return join(rootDir, 'data', 'drafts', `${weekId}.json`);
}

function saveDraft(rootDir: string, draft: NewsletterDraft): string {
  const draftPath = getDraftPath(rootDir, draft.weekId);
  mkdirSync(join(rootDir, 'data', 'drafts'), { recursive: true });
  writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf-8');
  return draftPath;
}

function sortArticlesByBaseScore(articles: ProcessedArticle[]): ProcessedArticle[] {
  return [...articles].sort((a, b) => getRankingScore(b) - getRankingScore(a));
}

function sortArticlesByAdjustedScore(
  articles: ProcessedArticle[],
  validation: DraftValidation
): ProcessedArticle[] {
  const validationById = new Map(
    validation.flagged.map((flag) => [flag.candidateId, flag])
  );

  return [...articles].sort((a, b) => {
    const adjustedA = getRankingScore(a) - (validationById.get(a.id)?.penaltyApplied || 0);
    const adjustedB = getRankingScore(b) - (validationById.get(b.id)?.penaltyApplied || 0);
    if (adjustedB !== adjustedA) {
      return adjustedB - adjustedA;
    }
    return getRankingScore(b) - getRankingScore(a);
  });
}

function formatSignal(value: number | undefined): string {
  return typeof value === 'number' ? String(value) : 'n/a';
}

function getEditorialTags(article: ProcessedArticle): string[] {
  const tags: string[] = [];

  if (isCommunityCentered(article)) {
    tags.push('community');
  }
  if (isGreenPreferred(article)) {
    tags.push('green');
  }
  if (isBureaucraticStory(article)) {
    tags.push('bureaucratic-risk');
  }

  return tags;
}

async function refineShortlist(options: {
  apiKey: string;
  weekId: string;
  selected: ProcessedArticle[];
  reserves: ProcessedArticle[];
  wrapperCopy: WrapperCopy;
  validation: DraftValidation;
  previousArticles: HistoricalArticle[];
  lookbackLabel: string;
}): Promise<{
  selected: ProcessedArticle[];
  reserves: ProcessedArticle[];
  wrapperCopy: WrapperCopy;
  reasoning: string;
}> {
  const {
    apiKey,
    weekId,
    selected,
    reserves,
    wrapperCopy,
    validation,
    previousArticles,
    lookbackLabel,
  } = options;

  if (process.env.GOODBRIEF_DISABLE_DRAFT_REFINEMENT === '1') {
    return {
      selected,
      reserves,
      wrapperCopy,
      reasoning: 'Draft refinement disabled via GOODBRIEF_DISABLE_DRAFT_REFINEMENT.',
    };
  }

  const allArticles = [...selected, ...reserves];
  const articleById = new Map(allArticles.map((article) => [article.id, article]));
  const validationById = new Map(
    validation.flagged.map((flag) => [flag.candidateId, flag])
  );
  const applyRefinementResult = (
    refinement: RefinementResult
  ): {
    selected: ProcessedArticle[];
    reserves: ProcessedArticle[];
    wrapperCopy: WrapperCopy;
    reasoning: string;
  } => {
    if (refinement.selectedIds.length < 9 || refinement.selectedIds.length > 12) {
      console.log(
        `Warning: Expected 9-12 articles, got ${refinement.selectedIds.length}. Keeping original.`
      );
      return {
        selected,
        reserves,
        wrapperCopy,
        reasoning: `Invalid selection size: ${refinement.selectedIds.length}`,
      };
    }

    const refinedSelection: ProcessedArticle[] = [];
    const usedIds = new Set<string>();
    for (const id of refinement.selectedIds) {
      const article = articleById.get(id);
      if (article && !usedIds.has(id)) {
        refinedSelection.push(article);
        usedIds.add(id);
      }
    }

    if (refinedSelection.length < 9 || refinedSelection.length > 12) {
      console.log(
        `Warning: Could only find ${refinedSelection.length} valid articles. Keeping original.`
      );
      return {
        selected,
        reserves,
        wrapperCopy,
        reasoning: `Could only find ${refinedSelection.length} refined articles`,
      };
    }

    const balancedSelection = rebalancePreferredSelection({
      preferredArticles: refinedSelection,
      allArticles,
      validation,
    });
    const balanceAdjusted =
      balancedSelection.selected.map((article) => article.id).join('|') !==
      refinedSelection.map((article) => article.id).join('|');

    return {
      selected: balancedSelection.selected,
      reserves: balancedSelection.reserves,
      wrapperCopy: {
        ...wrapperCopy,
        intro: refinement.intro,
        shortSummary: refinement.shortSummary,
      },
      reasoning: balanceAdjusted
        ? `${refinement.reasoning} Echilibrul editorial a fost păstrat automat pentru a evita reintroducerea știrilor speculative sau birocratice.`
        : refinement.reasoning,
    };
  };

  const mockRefinement = loadMockJson<RefinementResult>('GOODBRIEF_REFINEMENT_MOCK_FILE');
  if (mockRefinement) {
    return applyRefinementResult(mockRefinement);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const refinementSchema = {
    type: 'object',
    properties: {
      selectedIds: {
        type: 'array',
        items: { type: 'string' },
      },
      intro: { type: 'string' },
      shortSummary: { type: 'string' },
      reasoning: { type: 'string' },
    },
    required: ['selectedIds', 'intro', 'shortSummary', 'reasoning'],
  };

  const model = genAI.getGenerativeModel({
    model: DEFAULT_GEMINI_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: refinementSchema,
    } as any,
  });

  const articleList = allArticles
    .map((article, index) => {
      const flag = validationById.get(article.id);
      const adjustedScore = Math.round(
        (getRankingScore(article) - (flag?.penaltyApplied || 0)) * 10
      ) / 10;
      const tags = getEditorialTags(article);
      const validationNote = flag
        ? `\n   Same-week validation: ${flag.verdict.toUpperCase()} — ${flag.reason}`
        : '';
      const signalLine =
        `pos:${article.positivity} structural:${article.impact} felt:${formatSignal(article.feltImpact)} ` +
        `certainty:${formatSignal(article.certainty)} human:${formatSignal(article.humanCloseness)} ` +
        `bureau:${formatSignal(article.bureaucraticDistance)} promo:${formatSignal(article.promoRisk)} ` +
        `adjusted:${adjustedScore}`;

      return `${index + 1}. [ID: ${article.id}] [${article.category}] [${tags.join(', ') || 'no-tags'}] (${signalLine}) "${article.originalTitle}"\n   Summary: ${article.summary}${validationNote}`;
    })
    .join('\n\n');

  const previousWeeksContext = previousArticles.length > 0
    ? `\n\nPREVIOUSLY PUBLISHED (${lookbackLabel} - DO NOT SELECT similar stories):
${previousArticles.slice(0, 20).map((article, index) => `${index + 1}. "${article.title}"`).join('\n')}
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
${selected.map((article, index) => `${index + 1}. [ID: ${article.id}] "${article.originalTitle}"`).join('\n')}

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
9. Source diversity: do not let one niche source family dominate the issue
10. Concrete over speculative: prefer stories that are already happening over promises, calls for applications, or funding announcements
11. Human closeness: prefer stories readers can feel in communities, schools, neighborhoods, hospitals, or daily life over ministry/process stories
12. Preserve the balanced shape: keep at least two clearly community-centered stories and at least one green story when strong options exist
13. Do not swap in a grant, funding call, pilot program, or ministerial announcement just because it sounds more substantial; only keep those if they are concrete and clearly stronger than tangible alternatives

TASK:
- Review the current selection critically
- If you find issues (duplicates, weak stories, imbalance, REPEATS from previous weeks), swap articles from reserves
- If the intro could be sharper or better reflect the final selection, improve it (KEEP IT IN ROMANIAN)
- Return 9-12 article IDs in your preferred order

Return JSON with:
- selectedIds: array of 9-12 article IDs in display order
- intro: the intro IN ROMANIAN
- shortSummary: the short summary IN ROMANIAN
- reasoning: brief explanation of what you changed and why (or "No changes needed")`;

  console.log('Reviewing draft for improvements...');
  const result = await model.generateContent(prompt);
  const content = result.response.text();

  if (!content) {
    console.log('No refinement response, keeping original draft');
    return { selected, reserves, wrapperCopy, reasoning: 'No refinement response' };
  }

  try {
    const refinement = JSON.parse(content) as RefinementResult;
    console.log(`✓ Review complete: ${refinement.reasoning}`);
    return applyRefinementResult(refinement);
  } catch (error) {
    console.log('Failed to parse refinement response, keeping original draft');
    return {
      selected,
      reserves,
      wrapperCopy,
      reasoning: error instanceof Error ? error.message : 'Refinement parse failed',
    };
  }
}

export async function runPreparePhase(rootDir: string, weekId: string): Promise<string> {
  const rawPath = join(rootDir, 'data', 'raw', `${weekId}.json`);

  try {
    const buffer = loadWeeklyBuffer(rootDir, weekId);
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
      throw new Error('No articles to process');
    }

    console.log(`Processing ${buffer.articles.length} articles for ${weekId}`);
    console.log('Deduplicating articles...');
    const dedupResult = deduplicateArticles(buffer.articles);
    console.log(
      `Deduplicated ${buffer.articles.length} articles to ${dedupResult.outputCount} unique stories`
    );

    console.log('Loading historical stories from previous editions...');
    const historical = loadHistoricalArticles(rootDir, weekId);
    console.log(
      `Loaded ${historical.articles.length} historical stories (${historical.issueFilesLoaded} issue files, ${historical.draftFilesLoaded} draft files)`
    );

    console.log('Filtering out articles already covered in recent editions...');
    const preparedArticles = dedupResult.outputArticles.filter((article) => {
      const duplicate = findCrossWeekDuplicate(article, historical.articles);
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

    const artifact: DraftPipelineArtifact<PreparedPipelineData, 'prepare'> = {
      weekId,
      phase: 'prepare',
      generatedAt: new Date().toISOString(),
      inputFile: rawPath,
      data: {
        sameWeekRepresentatives: dedupResult.outputArticles,
        preparedArticles,
        deduplication: {
          inputCount: dedupResult.inputCount,
          outputCount: dedupResult.outputCount,
          clusters: dedupResult.clusters,
        },
        historicalFilter: {
          inputCount: dedupResult.outputCount,
          outputCount: preparedArticles.length,
          filteredOut: dedupResult.outputCount - preparedArticles.length,
          historicalCount: historical.articles.length,
        },
      },
    };

    const outputPath = writePipelineArtifact(rootDir, artifact);
    console.log(`Prepared artifact saved to ${outputPath}`);
    return outputPath;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No raw data found')) {
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
    }
    throw error;
  }
}

export async function runScorePhase(
  rootDir: string,
  weekId: string,
  apiKey: string
): Promise<string> {
  const prepared = readPipelineArtifact<PreparedPipelineData, 'prepare'>(
    rootDir,
    weekId,
    'prepare'
  );
  const mockScores = loadMockJson<ArticleScore[]>('GOODBRIEF_SCORE_MOCK_FILE');
  const model = mockScores ? null : createGeminiModel(apiKey, false);
  const BATCH_SIZE = 200;
  const allScores: ArticleScore[] = [];

  if (mockScores) {
    allScores.push(...mockScores);
  } else {
    try {
      for (let i = 0; i < prepared.data.preparedArticles.length; i += BATCH_SIZE) {
        const batch = prepared.data.preparedArticles.slice(i, i + BATCH_SIZE);
        console.log(
          `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(prepared.data.preparedArticles.length / BATCH_SIZE)}...`
        );
        const scores = await processArticleBatch(batch, model, false);
        allScores.push(...scores);

        if (i + BATCH_SIZE < prepared.data.preparedArticles.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
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
      }
      throw error;
    }
  }

  const scoreMap = new Map(allScores.map((score) => [score.id, score]));
  const processedAt = new Date().toISOString();
  const seenIds = new Set<string>();
  const processed = prepared.data.preparedArticles
    .map((raw) => {
      if (seenIds.has(raw.id)) {
        return null;
      }
      seenIds.add(raw.id);

      const score = scoreMap.get(raw.id);
      if (!score || !score.romaniaRelevant) {
        return null;
      }

      const processedArticle: ProcessedArticle = {
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
        processedAt,
      };

      if (score.feltImpact !== undefined) {
        processedArticle.feltImpact = score.feltImpact;
      }
      if (score.certainty !== undefined) {
        processedArticle.certainty = score.certainty;
      }
      if (score.humanCloseness !== undefined) {
        processedArticle.humanCloseness = score.humanCloseness;
      }
      if (score.bureaucraticDistance !== undefined) {
        processedArticle.bureaucraticDistance = score.bureaucraticDistance;
      }
      if (score.promoRisk !== undefined) {
        processedArticle.promoRisk = score.promoRisk;
      }

      return processedArticle;
    })
    .filter((article): article is ProcessedArticle => article !== null);

  const positiveArticles = sortArticlesByBaseScore(
    processed.filter((article) => article.positivity >= 40)
  );
  const discarded = processed.length - positiveArticles.length;

  if (positiveArticles.length < 5) {
    await sendAlert({
      title: 'Not enough positive articles',
      weekId,
      reason: `Only ${positiveArticles.length} positive articles found (need at least 5)`,
      details: `Total processed: ${processed.length}, Discarded (low positivity): ${discarded}`,
      actionItems: [
        'Review the raw articles manually to see if scores are too strict',
        'Consider lowering the positivity threshold temporarily',
        'Check if news sources are providing enough positive content',
        'The newsletter may need to be skipped this week',
      ],
    });
    throw new Error(`Not enough positive articles: ${positiveArticles.length}`);
  }

  const artifact: DraftPipelineArtifact<ScoredPipelineData, 'score'> = {
    weekId,
    phase: 'score',
    generatedAt: new Date().toISOString(),
    inputFile: PIPELINE_ARTIFACT_FILENAMES.prepare,
    data: {
      articles: positiveArticles,
      totalProcessed: processed.length,
      discarded,
    },
  };

  const outputPath = writePipelineArtifact(rootDir, artifact);
  console.log(`Scored artifact saved to ${outputPath}`);
  return outputPath;
}

export async function runSemanticDedupPhase(
  rootDir: string,
  weekId: string,
  apiKey: string
): Promise<string> {
  const scored = readPipelineArtifact<ScoredPipelineData, 'score'>(rootDir, weekId, 'score');
  let articles = [...scored.data.articles];
  let removed: ProcessedArticle[] = [];
  let clusters: SemanticDedupPipelineData['clusters'] = [];
  const mockDedup = loadMockJson<{
    removedIds: string[];
    clusters: SemanticDedupPipelineData['clusters'];
  }>('GOODBRIEF_SEMANTIC_DEDUP_MOCK_FILE');

  if (mockDedup) {
    const removedIds = new Set(mockDedup.removedIds);
    removed = articles.filter((article) => removedIds.has(article.id));
    articles = articles.filter((article) => !removedIds.has(article.id));
    clusters = mockDedup.clusters;
  } else if (articles.length > 1) {
    const semanticPoolTarget = Math.max(SEMANTIC_DEDUP_POOL_SIZE, FINAL_SHORTLIST_COUNT);
    const semanticPoolSize = Math.min(semanticPoolTarget, articles.length);
    const semanticPool = articles.slice(0, semanticPoolSize);
    const semanticPoolById = new Map(semanticPool.map((article) => [article.id, article]));

    console.log(`Running semantic deduplication on top ${semanticPoolSize} candidates...`);
    try {
      const semanticDedup = await deduplicateProcessedArticlesSemantically(
        semanticPool,
        apiKey,
        weekId
      );

      if (semanticDedup.removed.length > 0) {
        const removedIds = new Set(semanticDedup.removed.map((article) => article.id));
        articles = articles.filter((article) => !removedIds.has(article.id));
        removed = semanticDedup.removed;
        clusters = semanticDedup.clusters.map((cluster) => ({
          keepId: cluster.keepId,
          dropIds: cluster.dropIds,
          reason: cluster.reason,
        }));

        console.log(`Removed ${semanticDedup.removed.length} semantically duplicate stories`);
        for (const cluster of semanticDedup.clusters) {
          const keepTitle = semanticPoolById.get(cluster.keepId)?.originalTitle || cluster.keepId;
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

  const artifact: DraftPipelineArtifact<SemanticDedupPipelineData, 'semantic-dedup'> = {
    weekId,
    phase: 'semantic-dedup',
    generatedAt: new Date().toISOString(),
    inputFile: PIPELINE_ARTIFACT_FILENAMES.score,
    data: {
      articles,
      totalProcessed: scored.data.totalProcessed,
      discarded: scored.data.discarded,
      removed,
      clusters,
    },
  };

  const outputPath = writePipelineArtifact(rootDir, artifact);
  console.log(`Semantic dedup artifact saved to ${outputPath}`);
  return outputPath;
}

export async function runCounterSignalValidatePhase(options: {
  rootDir: string;
  weekId: string;
  apiKey: string;
  classifier?: CounterSignalClassifier;
  candidates?: ProcessedArticle[];
  artifactInputFile?: string;
}): Promise<string> {
  const prepared = readPipelineArtifact<PreparedPipelineData, 'prepare'>(
    options.rootDir,
    options.weekId,
    'prepare'
  );

  const semantic = options.candidates
    ? null
    : readPipelineArtifact<SemanticDedupPipelineData, 'semantic-dedup'>(
        options.rootDir,
        options.weekId,
        'semantic-dedup'
      );

  const candidates = options.candidates
    ? options.candidates
    : semantic!.data.articles.slice(
        0,
        Math.min(COUNTER_SIGNAL_VALIDATION_POOL_SIZE, semantic!.data.articles.length)
      );

  console.log(
    `Running same-week counter-signal validation on top ${candidates.length} candidates...`
  );

  const validation = await validateSameWeekCounterSignals({
    weekId: options.weekId,
    candidates,
    rawArticles: prepared.data.sameWeekRepresentatives,
    apiKey: options.apiKey,
    classifier: options.classifier,
    generatedAt: new Date().toISOString(),
  });

  const strongFlags = validation.flagged.filter((flag) => flag.verdict === 'strong').length;
  const borderlineFlags = validation.flagged.filter(
    (flag) => flag.verdict === 'borderline'
  ).length;
  console.log(
    `Counter-signal validation flagged ${validation.flagged.length} candidates (${strongFlags} strong, ${borderlineFlags} borderline)`
  );

  const artifact: DraftPipelineArtifact<
    CounterSignalPipelineData,
    'counter-signal-validate'
  > = {
    weekId: options.weekId,
    phase: 'counter-signal-validate',
    generatedAt: new Date().toISOString(),
    inputFile:
      options.artifactInputFile ||
      `${PIPELINE_ARTIFACT_FILENAMES['semantic-dedup']} + ${PIPELINE_ARTIFACT_FILENAMES.prepare}`,
    data: {
      validation,
    },
  };

  const outputPath = writePipelineArtifact(options.rootDir, artifact);
  console.log(`Counter-signal artifact saved to ${outputPath}`);
  return outputPath;
}

export async function runSelectPhase(rootDir: string, weekId: string): Promise<string> {
  const semantic = readPipelineArtifact<SemanticDedupPipelineData, 'semantic-dedup'>(
    rootDir,
    weekId,
    'semantic-dedup'
  );
  const counterSignals = readPipelineArtifact<
    CounterSignalPipelineData,
    'counter-signal-validate'
  >(rootDir, weekId, 'counter-signal-validate');

  const rankedArticles = sortArticlesByAdjustedScore(
    semantic.data.articles,
    counterSignals.data.validation
  );
  const { selected, reserves } = selectBalancedShortlist({
    rankedArticles,
    validation: counterSignals.data.validation,
    selectedCount: FINAL_SELECTED_COUNT,
    reserveCount: FINAL_RESERVES_COUNT,
  });
  const shortlistValidation = filterValidationForArticles(
    counterSignals.data.validation,
    [...selected, ...reserves]
  );

  const artifact: DraftPipelineArtifact<ShortlistPipelineData, 'select'> = {
    weekId,
    phase: 'select',
    generatedAt: new Date().toISOString(),
    inputFile: `${PIPELINE_ARTIFACT_FILENAMES['semantic-dedup']} + ${PIPELINE_ARTIFACT_FILENAMES['counter-signal-validate']}`,
    data: {
      selected,
      reserves,
      totalProcessed: semantic.data.totalProcessed,
      discarded: semantic.data.discarded,
      validation: shortlistValidation,
    },
  };

  const outputPath = writePipelineArtifact(rootDir, artifact);
  console.log(
    `Final shortlist for review: ${selected.length} selected + ${reserves.length} reserves`
  );
  console.log(`Shortlist artifact saved to ${outputPath}`);
  return outputPath;
}

export async function runWrapperCopyPhase(
  rootDir: string,
  weekId: string
): Promise<string> {
  const shortlist = readPipelineArtifact<ShortlistPipelineData, 'select'>(
    rootDir,
    weekId,
    'select'
  );

  console.log('Generating wrapper copy...');
  const wrapperCopy =
    loadMockJson<WrapperCopy>('GOODBRIEF_WRAPPER_COPY_MOCK_FILE') ||
    (await generateWrapperCopy(shortlist.data.selected, weekId));
  console.log('✓ Generated wrapper copy');

  const artifact: DraftPipelineArtifact<WrapperCopyPipelineData, 'wrapper-copy'> = {
    weekId,
    phase: 'wrapper-copy',
    generatedAt: new Date().toISOString(),
    inputFile: PIPELINE_ARTIFACT_FILENAMES.select,
    data: {
      wrapperCopy,
    },
  };

  const outputPath = writePipelineArtifact(rootDir, artifact);
  console.log(`Wrapper copy artifact saved to ${outputPath}`);
  return outputPath;
}

export async function runRefinePhase(
  rootDir: string,
  weekId: string,
  apiKey: string
): Promise<string> {
  const shortlist = readPipelineArtifact<ShortlistPipelineData, 'select'>(
    rootDir,
    weekId,
    'select'
  );
  const wrapperCopyArtifact = readPipelineArtifact<
    WrapperCopyPipelineData,
    'wrapper-copy'
  >(rootDir, weekId, 'wrapper-copy');

  console.log('\n--- Pass 2: Self-review ---');
  const historical = loadHistoricalArticles(rootDir, weekId);
  const refined = await refineShortlist({
    apiKey,
    weekId,
    selected: shortlist.data.selected,
    reserves: shortlist.data.reserves,
    wrapperCopy: wrapperCopyArtifact.data.wrapperCopy,
    validation: shortlist.data.validation,
    previousArticles: historical.articles,
    lookbackLabel: `last ${historical.issueFilesLoaded} published issues + ${historical.draftFilesLoaded} draft weeks`,
  });

  const draftValidation = filterValidationForArticles(
    shortlist.data.validation,
    [...refined.selected, ...refined.reserves]
  );
  const draft: NewsletterDraft = {
    weekId,
    generatedAt: new Date().toISOString(),
    selected: refined.selected,
    reserves: refined.reserves,
    discarded: shortlist.data.discarded,
    totalProcessed: shortlist.data.totalProcessed,
    wrapperCopy: refined.wrapperCopy,
    validation: draftValidation,
  };

  const artifact: DraftPipelineArtifact<RefinedDraftPipelineData, 'refine'> = {
    weekId,
    phase: 'refine',
    generatedAt: new Date().toISOString(),
    inputFile: `${PIPELINE_ARTIFACT_FILENAMES.select} + ${PIPELINE_ARTIFACT_FILENAMES['wrapper-copy']}`,
    data: {
      draft,
      reasoning: refined.reasoning,
    },
  };

  const outputPath = writePipelineArtifact(rootDir, artifact);
  const draftPath = saveDraft(rootDir, draft);
  console.log(`Refined artifact saved to ${outputPath}`);
  console.log(`Draft saved to ${draftPath}`);
  console.log(
    `Selected: ${draft.selected.length}, Reserves: ${draft.reserves.length}, Discarded: ${draft.discarded}`
  );
  return outputPath;
}

export function materializeDraftFromRefinedArtifact(
  rootDir: string,
  weekId: string
): string {
  const refined = readPipelineArtifact<RefinedDraftPipelineData, 'refine'>(
    rootDir,
    weekId,
    'refine'
  );
  return saveDraft(rootDir, refined.data.draft);
}

export async function refreshDraftValidation(options: {
  rootDir: string;
  weekId: string;
  apiKey: string;
  classifier?: CounterSignalClassifier;
}): Promise<DraftValidation> {
  const draftPath = getDraftPath(options.rootDir, options.weekId);
  if (!existsSync(draftPath)) {
    throw new Error(`Draft not found at ${draftPath}`);
  }

  const draft = JSON.parse(readFileSync(draftPath, 'utf-8')) as NewsletterDraft;
  const shortlist = [...draft.selected, ...draft.reserves];

  await runCounterSignalValidatePhase({
    rootDir: options.rootDir,
    weekId: options.weekId,
    apiKey: options.apiKey,
    classifier: options.classifier,
    candidates: shortlist,
    artifactInputFile: `draft:${options.weekId}`,
  });

  const counterSignals = readPipelineArtifact<
    CounterSignalPipelineData,
    'counter-signal-validate'
  >(options.rootDir, options.weekId, 'counter-signal-validate');
  const draftValidation = filterValidationForArticles(
    counterSignals.data.validation,
    shortlist
  );

  const updatedDraft: NewsletterDraft = {
    ...draft,
    validation: draftValidation,
  };
  saveDraft(options.rootDir, updatedDraft);
  return draftValidation;
}
