#!/usr/bin/env npx tsx

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Resend } from 'resend';
import type { NewsletterDraft, ProcessedArticle, ArticleCategory, WrapperCopy } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

function getISOWeekId(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7 + 1
  );
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

function loadDraft(weekId: string): NewsletterDraft | null {
  const draftPath = join(ROOT_DIR, 'data', 'drafts', `${weekId}.json`);
  if (!existsSync(draftPath)) return null;
  return JSON.parse(readFileSync(draftPath, 'utf-8')) as NewsletterDraft;
}

function renderProofEmail(draft: NewsletterDraft): string {
  const brandGreen = '#3d5f46';
  const darkText = '#1f2937';
  const grayText = '#6b7280';
  const lightGray = '#e5e7eb';

  const sectionConfig: Record<ArticleCategory, { emoji: string; title: string }> = {
    'local-heroes': { emoji: '🌱', title: 'LOCAL HEROES' },
    'wins': { emoji: '🏆', title: 'WINS' },
    'green-stuff': { emoji: '💚', title: 'GREEN STUFF' },
    'quick-hits': { emoji: '✨', title: 'QUICK HITS' },
  };

  const renderArticle = (article: ProcessedArticle) => `
    <tr>
      <td style="padding: 16px 0;">
        <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: bold; color: ${darkText}; line-height: 1.4;">
          ${article.originalTitle}
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

  const grouped: Record<ArticleCategory, ProcessedArticle[]> = {
    'local-heroes': [],
    'wins': [],
    'green-stuff': [],
    'quick-hits': [],
  };
  for (const article of draft.selected) {
    if (grouped[article.category]) {
      grouped[article.category].push(article);
    }
  }

  const renderSection = (category: ArticleCategory) => {
    const articles = grouped[category];
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

  const copy: WrapperCopy = draft.wrapperCopy || {
    greeting: 'Bună dimineața! 👋',
    intro: 'Iată veștile bune din această săptămână.',
    signOff: 'Săptămână frumoasă!\nEchipa Good Brief',
    shortSummary: 'Vești bune din România.',
  };

  return `
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Good Brief ${draft.weekId}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f1eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f1eb;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px;">
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
                ${draft.selected.length} știri, sub 5 minute.
              </p>
            </td>
          </tr>

          <!-- Articles -->
          <tr>
            <td style="padding: 0 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${renderSection('local-heroes')}
                ${renderSection('wins')}
                ${renderSection('green-stuff')}
                ${renderSection('quick-hits')}
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

async function main(): Promise<void> {
  const weekId = process.argv[2] || getISOWeekId();
  
  console.log(`\n📬 Good Brief Proof Notification`);
  console.log(`Week: ${weekId}\n`);

  const apiKey = process.env.RESEND_API_KEY;
  const editorEmail = process.env.TEST_EMAIL;

  if (!apiKey) {
    console.error('Error: RESEND_API_KEY environment variable is required');
    process.exit(1);
  }

  if (!editorEmail) {
    console.error('Error: TEST_EMAIL environment variable is required');
    process.exit(1);
  }

  const draft = loadDraft(weekId);
  if (!draft) {
    console.error(`Error: No draft found for ${weekId}`);
    process.exit(1);
  }

  console.log(`✓ Loaded draft with ${draft.selected.length} articles`);

  const resend = new Resend(apiKey);

  // Send proof email
  console.log('Sending proof email...');
  const proofHtml = renderProofEmail(draft);
  const { error: proofError } = await resend.emails.send({
    from: 'Good Brief <buna@goodbrief.ro>',
    to: editorEmail,
    subject: `[PROOF] Good Brief ${weekId} – Vești bune din România`,
    html: proofHtml,
  });

  if (proofError) {
    console.error('Error sending proof:', proofError);
    process.exit(1);
  }
  console.log('✓ Proof email sent');

  console.log('\n✨ Done!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
