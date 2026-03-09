export interface RssSource {
  id: string;
  name: string;
  url: string;
}

export interface RawArticle {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  fetchedAt: string;
}

export type ArticleCategory = "local-heroes" | "wins" | "green-stuff" | "quick-hits";

export interface WrapperCopy {
  greeting: string;
  intro: string;
  signOff: string;
  shortSummary: string;
}

export type CounterSignalVerdict = 'none' | 'borderline' | 'strong';

export type DraftPipelinePhase =
  | 'prepare'
  | 'score'
  | 'semantic-dedup'
  | 'counter-signal-validate'
  | 'select'
  | 'wrapper-copy'
  | 'refine';

export interface DraftPipelineArtifact<TData, TPhase extends DraftPipelinePhase = DraftPipelinePhase> {
  weekId: string;
  phase: TPhase;
  generatedAt: string;
  inputFile: string;
  data: TData;
}

export interface CounterSignalFlag {
  candidateId: string;
  verdict: Exclude<CounterSignalVerdict, 'none'>;
  penaltyApplied: number;
  reason: string;
  relatedArticleIds: string[];
  relatedArticleTitles: string[];
  generatedAt: string;
}

export type DraftValidationStatus = 'passed' | 'failed';
export type DraftValidationVerdict = 'fresh' | 'duplicate' | 'follow_up';
export type DraftValidationApprovalSource =
  | 'legacy-backfill'
  | 'validation-pipeline';

export interface DraftValidationBlockedArticle {
  articleId: string;
  reason: string;
  matchedOrigin?: string;
  matchedTitle?: string;
}

export interface DraftValidationReplacement {
  removedArticleId: string;
  replacementArticleId: string;
}

export interface DraftValidationAgentReviewedArticle {
  articleId: string;
  verdict: DraftValidationVerdict;
  notes: string;
  matchedOrigin?: string;
  matchedTitle?: string;
}

export interface DraftValidation {
  generatedAt: string;
  candidateCount: number;
  flagged: CounterSignalFlag[];
  status?: DraftValidationStatus;
  approvalSource?: DraftValidationApprovalSource;
  checkedAt?: string;
  freshnessWindowDays?: number;
  publishedHistoryCount?: number;
  recentDraftCount?: number;
  blockedArticles?: DraftValidationBlockedArticle[];
  replacements?: DraftValidationReplacement[];
  agentReviewed?: DraftValidationAgentReviewedArticle[];
}
export interface ProcessedArticle {
  id: string;
  sourceId: string;
  sourceName: string;
  originalTitle: string;
  url: string;
  summary: string;
  positivity: number;
  impact: number;
  category: ArticleCategory;
  clusterId?: string;
  publishedAt: string;
  processedAt: string;
}

export interface WeeklyBuffer {
  weekId: string;
  articles: RawArticle[];
  lastUpdated: string;
}

export interface NewsletterDraft {
  weekId: string;
  generatedAt: string;
  selected: ProcessedArticle[];
  reserves: ProcessedArticle[];
  discarded: number;
  totalProcessed: number;
  wrapperCopy?: WrapperCopy;
  validation?: DraftValidation;
}

export interface PipelineDeduplicationSummary {
  inputCount: number;
  outputCount: number;
  clusters: Array<{
    kept: string;
    merged: string[];
    similarity: number;
  }>;
}

export interface PipelineHistoricalFilterSummary {
  inputCount: number;
  outputCount: number;
  filteredOut: number;
  historicalCount: number;
}

export interface PreparedPipelineData {
  sameWeekRepresentatives: RawArticle[];
  preparedArticles: RawArticle[];
  deduplication: PipelineDeduplicationSummary;
  historicalFilter: PipelineHistoricalFilterSummary;
}

export interface ScoredPipelineData {
  articles: ProcessedArticle[];
  totalProcessed: number;
  discarded: number;
}

export interface SemanticDedupPipelineData {
  articles: ProcessedArticle[];
  totalProcessed: number;
  discarded: number;
  removed: ProcessedArticle[];
  clusters: Array<{
    keepId: string;
    dropIds: string[];
    reason: string;
  }>;
}

export interface CounterSignalPipelineData {
  validation: DraftValidation;
}

export interface ShortlistPipelineData {
  selected: ProcessedArticle[];
  reserves: ProcessedArticle[];
  totalProcessed: number;
  discarded: number;
  validation: DraftValidation;
}

export interface WrapperCopyPipelineData {
  wrapperCopy: WrapperCopy;
}

export interface RefinedDraftPipelineData {
  draft: NewsletterDraft;
  reasoning: string;
}
