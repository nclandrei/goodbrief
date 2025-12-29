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

export interface ProcessedArticle {
  id: string;
  sourceId: string;
  sourceName: string;
  originalTitle: string;
  url: string;
  summary: string;
  positivity: number;
  popularity: number;
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
}
