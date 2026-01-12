#!/usr/bin/env npx tsx

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir, platform } from 'os';
import { exec } from 'child_process';
import { Resend } from 'resend';
import type {
  NewsletterDraft,
  ProcessedArticle,
  ArticleCategory,
  WrapperCopy,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// CLI argument parsing
interface CliArgs {
  mode: 'preview' | 'test' | 'send';
  week: string;
  confirm: boolean;
  automated: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  let mode: 'preview' | 'test' | 'send' = 'preview';
  let week = '';
  let confirm = false;
  let automated = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--preview') {
      mode = 'preview';
    } else if (arg === '--test') {
      mode = 'test';
    } else if (arg === '--send') {
      mode = 'send';
    } else if (arg === '--week' && args[i + 1]) {
      week = args[i + 1];
      i++;
    } else if (arg === '--confirm') {
      confirm = true;
    } else if (arg === '--automated') {
      automated = true;
      confirm = true;
    }
  }

  if (!week) {
    console.error('Error: --week argument is required (e.g., --week 2026-W01)');
    process.exit(1);
  }

  if (!/^\d{4}-W\d{2}$/.test(week)) {
    console.error('Error: Invalid week format. Use YYYY-WXX (e.g., 2026-W01)');
    process.exit(1);
  }

  return { mode, week, confirm, automated };
}

// Load draft from data/drafts/
function loadDraft(weekId: string): NewsletterDraft {
  const draftPath = join(ROOT_DIR, 'data', 'drafts', `${weekId}.json`);

  if (!existsSync(draftPath)) {
    console.error(`Error: Draft not found at ${draftPath}`);
    process.exit(1);
  }

  const content = readFileSync(draftPath, 'utf-8');
  return JSON.parse(content) as NewsletterDraft;
}

// Group articles by category
interface GroupedArticles {
  'local-heroes': ProcessedArticle[];
  wins: ProcessedArticle[];
  'green-stuff': ProcessedArticle[];
  'quick-hits': ProcessedArticle[];
}

function groupByCategory(articles: ProcessedArticle[]): GroupedArticles {
  const groups: GroupedArticles = {
    'local-heroes': [],
    wins: [],
    'green-stuff': [],
    'quick-hits': [],
  };

  for (const article of articles) {
    const category = article.category as ArticleCategory;
    if (groups[category]) {
      groups[category].push(article);
    }
  }

  return groups;
}

// Generate HTML email (inline template until React Email is set up)
function renderEmailHtml(
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
                Ai o poveste bună? Reply la acest email sau scrie-ne la <a href="mailto:contact@goodbrief.ro" style="color: ${brandGreen};">contact@goodbrief.ro</a>.
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

// Open file in browser
function openInBrowser(filePath: string): void {
  const os = platform();
  let command: string;

  if (os === 'darwin') {
    command = `open "${filePath}"`;
  } else if (os === 'win32') {
    command = `start "" "${filePath}"`;
  } else {
    command = `xdg-open "${filePath}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.error(`Warning: Could not open browser: ${error.message}`);
      console.log(`Open manually: ${filePath}`);
    }
  });
}

// Preview mode: write HTML and open in browser
async function handlePreview(html: string, weekId: string): Promise<void> {
  const tmp = tmpdir();
  const filePath = join(tmp, `goodbrief-${weekId}-preview.html`);

  writeFileSync(filePath, html);
  console.log(`✓ Preview saved to: ${filePath}`);

  openInBrowser(filePath);
  console.log('✓ Opened preview in browser');
}

// Test mode: send to test email
async function handleTest(html: string, weekId: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('Error: RESEND_API_KEY environment variable is required');
    process.exit(1);
  }

  const testEmail = process.env.TEST_EMAIL;
  if (!testEmail) {
    console.error(
      'Error: TEST_EMAIL environment variable is required for test mode'
    );
    console.error('Set it with: export TEST_EMAIL=your@email.com');
    process.exit(1);
  }

  const resend = new Resend(apiKey);

  console.log(`Sending test email to ${testEmail}...`);

  const { data, error } = await resend.emails.send({
    from: 'Good Brief <buna@goodbrief.ro>',
    replyTo: 'contact@goodbrief.ro',
    to: testEmail,
    subject: `[TEST] Good Brief ${weekId} – Vești bune din România`,
    html,
  });

  if (error) {
    console.error('Error sending test email:', error);
    process.exit(1);
  }

  console.log(`✓ Test email sent! ID: ${data?.id}`);
}

// Send mode: broadcast to audience
async function handleSend(
  html: string,
  weekId: string,
  confirm: boolean
): Promise<void> {
  if (!confirm) {
    console.error(
      'Error: --confirm flag is required to send to all subscribers'
    );
    console.error('Run: npm run email:send -- --week ' + weekId + ' --confirm');
    process.exit(1);
  }

  const apiKey = process.env.RESEND_API_KEY;
  const segmentId =
    process.env.RESEND_SEGMENT_ID || process.env.RESEND_AUDIENCE_ID;

  if (!apiKey) {
    console.error('Error: RESEND_API_KEY environment variable is required');
    process.exit(1);
  }

  if (!segmentId) {
    console.error('Error: RESEND_SEGMENT_ID environment variable is required');
    process.exit(1);
  }

  const resend = new Resend(apiKey);

  const { data: broadcast, error: broadcastError } =
    await resend.broadcasts.create({
      segmentId,
      from: 'Good Brief <buna@goodbrief.ro>',
      replyTo: 'contact@goodbrief.ro',
      subject: `Good Brief ${weekId} – Vești bune din România`,
      html,
    });

  if (broadcastError || !broadcast) {
    console.error('Error creating broadcast:', broadcastError);
    process.exit(1);
  }

  console.log(`✓ Broadcast created: ${broadcast.id}`);
  console.log('Sending to all subscribers...');

  const { error: sendError } = await resend.broadcasts.send(broadcast.id);

  if (sendError) {
    console.error('Error sending broadcast:', sendError);
    process.exit(1);
  }

  console.log(`✓ Newsletter sent to all subscribers!`);
}

// Main entry point
async function main(): Promise<void> {
  const args = parseArgs();

  console.log(`\n📬 Good Brief Newsletter - ${args.mode.toUpperCase()} mode`);
  console.log(`Week: ${args.week}\n`);

  // Load draft
  console.log('Loading draft...');
  const draft = loadDraft(args.week);
  console.log(`✓ Loaded ${draft.selected.length} articles`);

  // Get first 10 selected articles
  const articles = draft.selected.slice(0, 10);

  // Group by category
  const grouped = groupByCategory(articles);
  console.log(
    `✓ Grouped: ${grouped['local-heroes'].length} local-heroes, ${grouped.wins.length} wins, ${grouped['green-stuff'].length} green-stuff, ${grouped['quick-hits'].length} quick-hits`
  );

  // Get wrapper copy from draft or generate if missing
  let copy: WrapperCopy;
  if (draft.wrapperCopy) {
    console.log('Using wrapper copy from draft');
    copy = draft.wrapperCopy;
  } else {
    console.log('Generating AI wrapper copy (draft missing copy)...');
    const { generateWrapperCopy } = await import('../emails/utils/generate-copy.js');
    copy = await generateWrapperCopy(articles, args.week);
    console.log('✓ Generated greeting, intro, and sign-off');
  }

  // Render HTML
  console.log('Rendering email HTML...');
  const html = renderEmailHtml(grouped, copy, args.week);
  console.log('✓ Email rendered\n');

  // Handle mode
  switch (args.mode) {
    case 'preview':
      await handlePreview(html, args.week);
      break;
    case 'test':
      await handleTest(html, args.week);
      break;
    case 'send':
      await handleSend(html, args.week, args.confirm);
      break;
  }

  console.log('\n✨ Done!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
