import { createHash } from 'node:crypto';
import type {
  ArticleCategory,
  NewsletterDraft,
  ProcessedArticle,
  WrapperCopy,
} from '../types.js';
import { getArticleDisplayTitle } from './article-title.js';
import { TARGET_SELECTED_ARTICLE_COUNT } from './newsletter-policy.js';

export const NEWSLETTER_SUBJECT = 'Good Brief – Your weekly dose de vești bune';
export const NEWSLETTER_DELIVERY_HASH_VERSION = 'goodbrief-delivery-v1';

export interface GroupedArticles {
  'local-heroes': ProcessedArticle[];
  wins: ProcessedArticle[];
  'green-stuff': ProcessedArticle[];
  'quick-hits': ProcessedArticle[];
}

export interface NewsletterEmail {
  subject: string;
  html: string;
  deliverySha256: string;
  articles: ProcessedArticle[];
  grouped: GroupedArticles;
}

export function groupArticlesByCategory(
  articles: ProcessedArticle[]
): GroupedArticles {
  const groups: GroupedArticles = {
    'local-heroes': [],
    wins: [],
    'green-stuff': [],
    'quick-hits': [],
  };

  for (const article of articles) {
    const category = article.category as ArticleCategory;
    if (!groups[category]) {
      throw new Error(
        `Article ${article.id} has unsupported newsletter category: ${article.category}`
      );
    }
    groups[category].push(article);
  }

  return groups;
}

export function renderNewsletterHtml(
  grouped: GroupedArticles,
  copy: WrapperCopy,
  weekId: string
): string {
  const brandGreen = '#3d5f46';
  const darkText = '#1f2937';
  const grayText = '#6b7280';
  const lightGray = '#e5e7eb';
  const bgColor = '#ffffff';

  const sectionConfig: Record<
    ArticleCategory,
    { emoji: string; title: string }
  > = {
    'local-heroes': { emoji: '🌱', title: 'LOCAL HEROES' },
    wins: { emoji: '🏆', title: 'WINS' },
    'green-stuff': { emoji: '💚', title: 'GREEN STUFF' },
    'quick-hits': { emoji: '✨', title: 'QUICK HITS' },
  };

  const renderArticle = (article: ProcessedArticle) => `
    <tr>
      <td style="padding: 16px 0;">
        <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: bold; color: ${darkText}; line-height: 1.4;">
          ${getArticleDisplayTitle(article)}
        </h3>
        <p style="margin: 0 0 12px 0; font-size: 16px; color: ${darkText}; line-height: 1.6;">
          ${article.summary}
        </p>
        <a href="${article.url}" style="color: ${brandGreen}; font-size: 14px; text-decoration: none;">
          → Citește pe ${article.sourceName}
        </a>
      </td>
    </tr>
  `;

  const renderSection = (
    category: ArticleCategory,
    articles: ProcessedArticle[]
  ) => {
    if (articles.length === 0) return '';
    const config = sectionConfig[category];
    return `
      <tr>
        <td style="padding: 24px 0 8px 0;">
          <h2 style="margin: 0; font-size: 14px; font-weight: 600; color: ${brandGreen}; letter-spacing: 1px; text-transform: uppercase;">
            ${config.emoji} ${config.title}
          </h2>
          <hr style="border: none; border-top: 1px solid ${lightGray}; margin: 8px 0 0 0;">
        </td>
      </tr>
      ${articles.map(renderArticle).join('')}
    `;
  };

  const articleCount =
    grouped['local-heroes'].length +
    grouped.wins.length +
    grouped['green-stuff'].length +
    grouped['quick-hits'].length;

  return `
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Good Brief ${weekId}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f1eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f1eb;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: ${bgColor}; border-radius: 8px;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding: 32px 24px 16px 24px;">
              <img src="https://goodbrief.ro/logo.png" alt="Good Brief" width="120" style="display: block; margin-bottom: 8px;">
              <p style="margin: 0; font-size: 16px; color: ${grayText};">Vești bune din România</p>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding: 16px 24px 24px 24px;">
              <p style="margin: 0 0 12px 0; font-size: 18px; color: ${darkText}; line-height: 1.6;">
                ${copy.greeting}
              </p>
              <p style="margin: 0; font-size: 16px; color: ${darkText}; line-height: 1.6;">
                ${copy.intro}
              </p>
              <p style="margin: 12px 0 0 0; font-size: 14px; color: ${grayText};">
                ${articleCount} știri, sub 5 minute.
              </p>
            </td>
          </tr>

          <!-- Articles -->
          <tr>
            <td style="padding: 0 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${renderSection('local-heroes', grouped['local-heroes'])}
                ${renderSection('wins', grouped.wins)}
                ${renderSection('green-stuff', grouped['green-stuff'])}
                ${renderSection('quick-hits', grouped['quick-hits'])}
              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding: 24px;">
              <hr style="border: none; border-top: 1px solid ${lightGray}; margin: 0 0 24px 0;">
              <p style="margin: 0 0 16px 0; font-size: 16px; color: ${darkText}; line-height: 1.6;">
                ${copy.signOff}
              </p>
              <p style="margin: 0; font-size: 14px; color: ${grayText}; line-height: 1.6;">
                Ai o poveste bună? Reply la acest email sau scrie-ne la <a href="mailto:hello@goodbrief.ro" style="color: ${brandGreen};">hello@goodbrief.ro</a>.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px; background-color: #f9fafb; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 8px 0; font-size: 14px; color: ${grayText};">
                Good Brief · <a href="https://goodbrief.ro" style="color: ${brandGreen};">goodbrief.ro</a>
              </p>
              <p style="margin: 0; font-size: 12px; color: ${grayText};">
                <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color: ${grayText};">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function getNewsletterDeliverySha256(
  subject: string,
  html: string
): string {
  return createHash('sha256')
    .update(`${NEWSLETTER_DELIVERY_HASH_VERSION}\0${subject}\0${html}`)
    .digest('hex');
}

export function buildNewsletterEmail(draft: NewsletterDraft): NewsletterEmail {
  if (!draft.wrapperCopy) {
    throw new Error(
      `Draft ${draft.weekId} is missing stored wrapper copy; refusing nondeterministic newsletter delivery.`
    );
  }

  const articles = draft.selected.slice(0, TARGET_SELECTED_ARTICLE_COUNT);
  const grouped = groupArticlesByCategory(articles);
  const html = renderNewsletterHtml(grouped, draft.wrapperCopy, draft.weekId);

  return {
    subject: NEWSLETTER_SUBJECT,
    html,
    deliverySha256: getNewsletterDeliverySha256(NEWSLETTER_SUBJECT, html),
    articles,
    grouped,
  };
}
