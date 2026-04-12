import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type {
  ArticleScore,
} from './types.js';
import type { LlmProvider } from './llm/provider.js';
import { LlmQuotaError } from './llm/provider.js';
import { buildRefinePrompt } from './llm/refine-prompt.js';
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
import { GeminiQuotaError } from './gemini.js';
import { loadHistoricalArticles, type HistoricalArticle } from './historical-articles.js';
import { getRankingScore } from './ranking.js';
import {
  PIPELINE_ARTIFACT_FILENAMES,
  readPipelineArtifact,
  readPartialScores,
  removePartialScores,
  writePipelineArtifact,
  writePartialScores,
} from './pipeline-artifacts.js';
import { sendAlert } from './alert.js';
import {
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

function clustersFromDedupGroups(
  groups: Array<{ ids: string[]; reason: string }>,
  pool: ProcessedArticle[]
): {
  removed: ProcessedArticle[];
  clusters: Array<{ keepId: string; dropIds: string[]; reason: string }>;
} {
  const articleById = new Map(pool.map((article) => [article.id, article]));
  const scoreFor = (article: ProcessedArticle): number => {
    const publishedAt = new Date(article.publishedAt).getTime();
    const recencyBonus = Number.isFinite(publishedAt) ? publishedAt / 1e12 : 0;
    return getRankingScore(article) + recencyBonus;
  };

  const clusters: Array<{ keepId: string; dropIds: string[]; reason: string }> = [];
  const removedIds = new Set<string>();

  for (const group of groups) {
    const members = (group.ids || [])
      .map((id) => articleById.get(id))
      .filter((article): article is ProcessedArticle => Boolean(article));
    if (members.length < 2) continue;
    members.sort((a, b) => scoreFor(b) - scoreFor(a));
    const keep = members[0];
    const dropIds: string[] = [];
    for (const article of members.slice(1)) {
      if (!removedIds.has(article.id)) {
        removedIds.add(article.id);
        dropIds.push(article.id);
      }
    }
    if (dropIds.length > 0) {
      clusters.push({
        keepId: keep.id,
        dropIds,
        reason: group.reason?.trim() || 'Same underlying story',
      });
    }
  }

  const removed = pool.filter((article) => removedIds.has(article.id));
  return { removed, clusters };
}

async function refineShortlist(options: {
  llm: LlmProvider;
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
    llm,
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

  const prompt = buildRefinePrompt({
    weekId,
    selected,
    reserves,
    wrapperCopy,
    validation,
    previousArticles,
    lookbackLabel,
  });

  console.log('Reviewing draft for improvements...');
  try {
    const refinement = await llm.refineDraft({ weekId, prompt });
    console.log(`✓ Review complete: ${refinement.reasoning}`);
    return applyRefinementResult(refinement);
  } catch (error) {
    if (error instanceof LlmQuotaError || error instanceof GeminiQuotaError) {
      throw error;
    }
    console.log(
      `Failed to refine draft, keeping original: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
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
  llm: LlmProvider,
  options?: { batchSize?: number }
): Promise<string> {
  const prepared = readPipelineArtifact<PreparedPipelineData, 'prepare'>(
    rootDir,
    weekId,
    'prepare'
  );
  const mockScores = loadMockJson<ArticleScore[]>('GOODBRIEF_SCORE_MOCK_FILE');
  const BATCH_SIZE = options?.batchSize ?? Number.parseInt(
    process.env.SCORE_BATCH_SIZE || '200',
    10
  );
  const allScores: ArticleScore[] = [];

  if (mockScores) {
    allScores.push(...mockScores);
  } else {
    // Resume from partial scores if a previous run was interrupted
    const partialScores = readPartialScores(rootDir, weekId);
    const alreadyScoredIds = new Set<string>();
    if (partialScores && partialScores.length > 0) {
      allScores.push(...partialScores);
      for (const score of partialScores) {
        alreadyScoredIds.add(score.id);
      }
      console.log(`Resuming from ${partialScores.length} previously scored articles`);
    }

    const remainingArticles = prepared.data.preparedArticles.filter(
      (article) => !alreadyScoredIds.has(article.id)
    );

    try {
      const totalBatches = Math.ceil(
        (remainingArticles.length + allScores.length) / BATCH_SIZE
      );
      const completedBatches = Math.ceil(allScores.length / BATCH_SIZE);

      for (let i = 0; i < remainingArticles.length; i += BATCH_SIZE) {
        const batch = remainingArticles.slice(i, i + BATCH_SIZE);
        const batchNum = completedBatches + Math.floor(i / BATCH_SIZE) + 1;
        console.log(`Processing batch ${batchNum}/${totalBatches}...`);
        const scores = await llm.scoreArticles(batch, { includeReasoning: false });
        allScores.push(...scores);
        writePartialScores(rootDir, weekId, allScores);
      }
    } catch (error) {
      if (error instanceof GeminiQuotaError || error instanceof LlmQuotaError) {
        const providerLabel =
          llm.name === 'claude-cli'
            ? 'Claude Code'
            : llm.name === 'openrouter'
              ? 'OpenRouter'
              : 'Gemini';
        await sendAlert({
          title: `${providerLabel} quota exhausted`,
          weekId,
          reason: `The ${llm.name} provider is out of quota or rate-limited`,
          details: error.message,
          actionItems: [
            'Wait for the quota to reset',
            'Re-run the pipeline with a different provider (<code>--llm gemini</code>, <code>--llm claude-cli</code>, or <code>--llm openrouter</code>)',
            'Or set <code>LLM_FALLBACK=claude-cli</code> (or <code>openrouter</code>) to auto-fall-back on quota errors',
            'For full recovery, run <code>npm run pipeline:run-all -- --week ' + weekId + ' --llm claude-cli</code> locally',
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
  removePartialScores(rootDir, weekId);
  console.log(`Scored artifact saved to ${outputPath}`);
  return outputPath;
}

export async function runSemanticDedupPhase(
  rootDir: string,
  weekId: string,
  llm: LlmProvider
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
      const dedupResponse = await llm.semanticDedup(weekId, semanticPool);
      const clusterResult = clustersFromDedupGroups(dedupResponse.groups, semanticPool);

      if (clusterResult.removed.length > 0) {
        const removedIds = new Set(clusterResult.removed.map((article) => article.id));
        articles = articles.filter((article) => !removedIds.has(article.id));
        removed = clusterResult.removed;
        clusters = clusterResult.clusters;

        console.log(`Removed ${clusterResult.removed.length} semantically duplicate stories`);
        for (const cluster of clusters) {
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
      if (error instanceof GeminiQuotaError || error instanceof LlmQuotaError) {
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
  llm: LlmProvider;
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

  const classifier: CounterSignalClassifier =
    options.classifier ??
    ((input) => options.llm.classifyCounterSignal(input));

  const validation = await validateSameWeekCounterSignals({
    weekId: options.weekId,
    candidates,
    rawArticles: prepared.data.sameWeekRepresentatives,
    classifier,
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
  weekId: string,
  llm: LlmProvider
): Promise<string> {
  const shortlist = readPipelineArtifact<ShortlistPipelineData, 'select'>(
    rootDir,
    weekId,
    'select'
  );

  console.log('Generating wrapper copy...');
  const wrapperCopy =
    loadMockJson<WrapperCopy>('GOODBRIEF_WRAPPER_COPY_MOCK_FILE') ||
    (await llm.generateWrapperCopy(weekId, shortlist.data.selected));
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
  llm: LlmProvider
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
    llm,
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
  llm: LlmProvider;
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
    llm: options.llm,
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
