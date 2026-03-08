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

export interface CounterSignalFlag {
  candidateId: string;
  verdict: Exclude<CounterSignalVerdict, 'none'>;
  penaltyApplied: number;
  reason: string;
  relatedArticleIds: string[];
  relatedArticleTitles: string[];
  generatedAt: string;
}

export interface DraftValidation {
  generatedAt: string;
  candidateCount: number;
  flagged: CounterSignalFlag[];
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
