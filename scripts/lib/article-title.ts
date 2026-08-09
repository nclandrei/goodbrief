import type { ProcessedArticle } from '../types.js';

export function getArticleDisplayTitle(article: ProcessedArticle): string {
  return article.title?.trim() || article.originalTitle;
}
