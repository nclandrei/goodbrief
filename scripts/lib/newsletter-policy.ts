import type { ArticleCategory } from '../types.js';

export function getNewsletterSectionOrder(firstSection?: ArticleCategory): ArticleCategory[] {
  const order: ArticleCategory[] = ['local-heroes', 'wins', 'green-stuff', 'quick-hits'];
  if (firstSection === undefined) return order;
  if (!order.includes(firstSection)) throw new Error(`Unsupported first newsletter section: ${firstSection}`);
  return [firstSection, ...order.filter(category => category !== firstSection)];
}

export const TARGET_SELECTED_ARTICLE_COUNT = 10;
export const MIN_SENDABLE_ARTICLE_COUNT = 7;
// Hard cap for the rendered email; editors may promote reserves past the pipeline target.
export const MAX_SENDABLE_ARTICLE_COUNT = 12;
