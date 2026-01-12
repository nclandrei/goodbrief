# Automated Newsletter Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automate the full newsletter pipeline from draft generation through Monday sending, with editor notification on Saturday.

**Architecture:** Extend draft schema to include wrapper copy, add notification script for Saturday, add send workflow for Monday with missing-draft alerting.

**Tech Stack:** TypeScript, Resend API, GitHub Actions cron schedules

---

## Task 1: Extend Draft Schema with Wrapper Copy Type

**Files:**
- Modify: `scripts/types.ts`

**Step 1: Add WrapperCopy to types**

Add the `WrapperCopy` interface and extend `NewsletterDraft`:

```typescript
// Add after ArticleCategory type (line 18)
export interface WrapperCopy {
  greeting: string;
  intro: string;
  signOff: string;
}

// Modify NewsletterDraft to include wrapperCopy
export interface NewsletterDraft {
  weekId: string;
  generatedAt: string;
  selected: ProcessedArticle[];
  reserves: ProcessedArticle[];
  discarded: number;
  totalProcessed: number;
  wrapperCopy?: WrapperCopy;  // Optional for backwards compatibility
}
```

**Step 2: Run typecheck**

Run: `npm run check`
Expected: PASS (no type errors)

**Step 3: Commit**

```bash
git add scripts/types.ts
git commit -m "feat: add WrapperCopy type to draft schema"
```

---

## Task 2: Generate Wrapper Copy at Draft Time

**Files:**
- Modify: `scripts/generate-draft.ts`

**Step 1: Import generateWrapperCopy**

Add import at top of file after existing imports:

```typescript
import { generateWrapperCopy } from '../emails/utils/generate-copy.js';
```

**Step 2: Call generateWrapperCopy before saving draft**

After the `positive.sort(...)` block (around line 111) and before creating the `draft` object, add:

```typescript
console.log('Generating wrapper copy...');
const wrapperCopy = await generateWrapperCopy(positive.slice(0, 10), weekId);
console.log('✓ Generated wrapper copy');
```

**Step 3: Add wrapperCopy to draft object**

Modify the draft object creation (around line 113):

```typescript
const draft: NewsletterDraft = {
  weekId,
  generatedAt: now,
  selected: positive.slice(0, 10),
  reserves: positive.slice(10, 30),
  discarded,
  totalProcessed: processed.length,
  wrapperCopy,  // Add this line
};
```

**Step 4: Run typecheck**

Run: `npm run check`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/generate-draft.ts
git commit -m "feat: generate wrapper copy during draft creation"
```

---

## Task 3: Update send-newsletter.ts to Use Draft Copy

**Files:**
- Modify: `scripts/send-newsletter.ts`

**Step 1: Import WrapperCopy type**

Update the imports from types.ts:

```typescript
import type {
  NewsletterDraft,
  ProcessedArticle,
  ArticleCategory,
  WrapperCopy,
} from './types.js';
```

**Step 2: Remove generateWrapperCopy import**

Delete this line:
```typescript
import {
  generateWrapperCopy,
  type WrapperCopy,
} from '../emails/utils/generate-copy.js';
```

**Step 3: Add --automated flag to CLI args**

Update `CliArgs` interface (around line 24):

```typescript
interface CliArgs {
  mode: 'preview' | 'test' | 'send';
  week: string;
  confirm: boolean;
  automated: boolean;  // Add this
}
```

Update `parseArgs` function to handle `--automated`:

```typescript
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  let mode: 'preview' | 'test' | 'send' = 'preview';
  let week = '';
  let confirm = false;
  let automated = false;  // Add this

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
    } else if (arg === '--automated') {  // Add this block
      automated = true;
      confirm = true;  // --automated implies --confirm
    }
  }

  // ... rest of validation
  return { mode, week, confirm, automated };
}
```

**Step 4: Update renderEmailHtml signature**

Change function signature to accept WrapperCopy directly:

```typescript
function renderEmailHtml(
  grouped: GroupedArticles,
  copy: WrapperCopy,
  weekId: string
): string {
```

(No change needed - signature already correct)

**Step 5: Update main() to use draft's wrapperCopy**

Replace the AI copy generation section (around lines 398-401) with:

```typescript
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
```

**Step 6: Run typecheck**

Run: `npm run check`
Expected: PASS

**Step 7: Commit**

```bash
git add scripts/send-newsletter.ts
git commit -m "feat: use wrapper copy from draft, add --automated flag"
```

---

## Task 4: Create notify-draft.ts Script

**Files:**
- Create: `scripts/notify-draft.ts`

**Step 1: Create the notification script**

```typescript
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

function groupByCategory(articles: ProcessedArticle[]): Record<ArticleCategory, number> {
  const counts: Record<ArticleCategory, number> = {
    'local-heroes': 0,
    'wins': 0,
    'green-stuff': 0,
    'quick-hits': 0,
  };
  for (const article of articles) {
    if (counts[article.category] !== undefined) {
      counts[article.category]++;
    }
  }
  return counts;
}

function renderNotificationEmail(draft: NewsletterDraft): string {
  const counts = groupByCategory(draft.selected);
  const githubUrl = `https://github.com/nclandrei/goodbrief/blob/main/data/drafts/${draft.weekId}.json`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Draft Ready - ${draft.weekId}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #3d5f46;">📝 Draft Ready for Review</h1>
  <p><strong>Week:</strong> ${draft.weekId}</p>
  <p><strong>Generated:</strong> ${new Date(draft.generatedAt).toLocaleString('ro-RO')}</p>
  
  <h2 style="margin-top: 24px;">Article Summary</h2>
  <ul>
    <li>🌱 Local Heroes: ${counts['local-heroes']}</li>
    <li>🏆 Wins: ${counts['wins']}</li>
    <li>💚 Green Stuff: ${counts['green-stuff']}</li>
    <li>✨ Quick Hits: ${counts['quick-hits']}</li>
  </ul>
  <p><strong>Total selected:</strong> ${draft.selected.length}</p>
  <p><strong>Reserves:</strong> ${draft.reserves.length}</p>
  
  <h2 style="margin-top: 24px;">Actions</h2>
  <p>
    <a href="${githubUrl}" style="background: #3d5f46; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Edit Draft on GitHub
    </a>
  </p>
  <p style="color: #666; font-size: 14px; margin-top: 16px;">
    A proof email with the rendered newsletter will follow this message.
  </p>
  
  <hr style="margin-top: 32px; border: none; border-top: 1px solid #e5e7eb;">
  <p style="color: #666; font-size: 12px;">
    This email was automatically sent by the Good Brief draft generation workflow.
  </p>
</body>
</html>
  `.trim();
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

async function main(): Promise<void> {
  const weekId = process.argv[2] || getISOWeekId();
  
  console.log(`\n📬 Good Brief Draft Notification`);
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

  // Send notification email
  console.log('Sending notification email...');
  const notificationHtml = renderNotificationEmail(draft);
  const { error: notifError } = await resend.emails.send({
    from: 'Good Brief <buna@goodbrief.ro>',
    to: editorEmail,
    subject: `[Action Required] Good Brief ${weekId} draft ready`,
    html: notificationHtml,
  });

  if (notifError) {
    console.error('Error sending notification:', notifError);
    process.exit(1);
  }
  console.log('✓ Notification email sent');

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
```

**Step 2: Add npm script**

In `package.json`, add to scripts:

```json
"notify-draft": "npx tsx scripts/notify-draft.ts"
```

**Step 3: Run typecheck**

Run: `npm run check`
Expected: PASS

**Step 4: Commit**

```bash
git add scripts/notify-draft.ts package.json
git commit -m "feat: add notify-draft script for Saturday notifications"
```

---

## Task 5: Create alert-missing-draft.ts Script

**Files:**
- Create: `scripts/alert-missing-draft.ts`

**Step 1: Create the alert script**

```typescript
#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Resend } from 'resend';

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

async function main(): Promise<void> {
  const weekId = process.argv[2] || getISOWeekId();
  const reason = process.argv[3] || 'Draft not found';

  console.log(`\n⚠️ Good Brief Alert`);
  console.log(`Week: ${weekId}`);
  console.log(`Reason: ${reason}\n`);

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

  const resend = new Resend(apiKey);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Alert - ${weekId}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #dc2626;">⚠️ Newsletter Not Sent</h1>
  <p><strong>Week:</strong> ${weekId}</p>
  <p><strong>Reason:</strong> ${reason}</p>
  <p><strong>Time:</strong> ${new Date().toLocaleString('ro-RO')}</p>
  
  <h2 style="margin-top: 24px;">What happened?</h2>
  <p>The Monday automated send workflow could not find a valid draft for this week.</p>
  
  <h2 style="margin-top: 24px;">What to do?</h2>
  <ol>
    <li>Check if the draft exists at <code>data/drafts/${weekId}.json</code></li>
    <li>If missing, run <code>npm run generate-draft</code> manually</li>
    <li>Then run <code>npm run email:send -- --week ${weekId} --confirm</code></li>
  </ol>
  
  <hr style="margin-top: 32px; border: none; border-top: 1px solid #e5e7eb;">
  <p style="color: #666; font-size: 12px;">
    This alert was sent by the Good Brief Monday send workflow.
  </p>
</body>
</html>
  `.trim();

  console.log('Sending alert email...');
  const { error } = await resend.emails.send({
    from: 'Good Brief <buna@goodbrief.ro>',
    to: editorEmail,
    subject: `[ALERT] Good Brief ${weekId} NOT sent - action required`,
    html,
  });

  if (error) {
    console.error('Error sending alert:', error);
    process.exit(1);
  }

  console.log('✓ Alert email sent');
  console.log('\n✨ Done!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

**Step 2: Add npm script**

In `package.json`, add to scripts:

```json
"alert-missing-draft": "npx tsx scripts/alert-missing-draft.ts"
```

**Step 3: Run typecheck**

Run: `npm run check`
Expected: PASS

**Step 4: Commit**

```bash
git add scripts/alert-missing-draft.ts package.json
git commit -m "feat: add alert-missing-draft script for Monday failures"
```

---

## Task 6: Update generate-newsletter.yml Workflow

**Files:**
- Modify: `.github/workflows/generate-newsletter.yml`

**Step 1: Add notification step**

Replace the entire workflow with:

```yaml
name: Generate Newsletter Draft

on:
  schedule:
    - cron: '0 10 * * 6'  # Saturday at 10:00 UTC
  workflow_dispatch:

permissions:
  contents: write

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run generate-draft
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      - name: Commit draft
        run: |
          git config user.name "Andrei-Mihai Nicolae"
          git config user.email "andrei@nicolaeandrei.com"
          git add data/drafts/
          git diff --staged --quiet || git commit -m "Generate newsletter draft"
          git pull --rebase
          git push
      - name: Send notification emails
        run: npm run notify-draft
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
```

**Step 2: Commit**

```bash
git add .github/workflows/generate-newsletter.yml
git commit -m "feat: add notification step to draft generation workflow"
```

---

## Task 7: Create send-newsletter.yml Workflow

**Files:**
- Create: `.github/workflows/send-newsletter.yml`

**Step 1: Create the workflow**

```yaml
name: Send Newsletter

on:
  schedule:
    - cron: '0 8 * * 1'  # Monday at 08:00 UTC (10:00 Romania)
  workflow_dispatch:
    inputs:
      week:
        description: 'Week ID (e.g., 2026-W02). Leave empty for current week.'
        required: false
        type: string

permissions:
  contents: read

jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci

      - name: Determine week ID
        id: week
        run: |
          if [ -n "${{ inputs.week }}" ]; then
            echo "id=${{ inputs.week }}" >> $GITHUB_OUTPUT
          else
            # Calculate current ISO week
            WEEK_ID=$(date -u +%G-W%V)
            echo "id=$WEEK_ID" >> $GITHUB_OUTPUT
          fi

      - name: Check draft exists
        id: check
        run: |
          DRAFT_PATH="data/drafts/${{ steps.week.outputs.id }}.json"
          if [ -f "$DRAFT_PATH" ]; then
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi

      - name: Send newsletter
        if: steps.check.outputs.exists == 'true'
        run: npm run email:send -- --week ${{ steps.week.outputs.id }} --automated
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          RESEND_SEGMENT_ID: ${{ secrets.RESEND_SEGMENT_ID }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}

      - name: Alert on missing draft
        if: steps.check.outputs.exists == 'false'
        run: npm run alert-missing-draft -- ${{ steps.week.outputs.id }} "Draft file not found"
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
```

**Step 2: Commit**

```bash
git add .github/workflows/send-newsletter.yml
git commit -m "feat: add Monday newsletter send workflow"
```

---

## Task 8: Final Verification

**Step 1: Run full typecheck**

Run: `npm run check`
Expected: PASS with no errors

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Test notify-draft locally (optional)**

Run: `npm run notify-draft -- 2026-W02`
Expected: Two emails sent to TEST_EMAIL

**Step 4: Final commit if any fixes needed**

```bash
git status
# If clean, you're done!
```

---

## Summary of Changes

| File | Action |
|------|--------|
| `scripts/types.ts` | Add `WrapperCopy` interface, extend `NewsletterDraft` |
| `scripts/generate-draft.ts` | Generate wrapper copy at draft time |
| `scripts/send-newsletter.ts` | Use draft's wrapper copy, add `--automated` flag |
| `scripts/notify-draft.ts` | **New** - Send notification + proof emails |
| `scripts/alert-missing-draft.ts` | **New** - Send missing draft alerts |
| `package.json` | Add `notify-draft` and `alert-missing-draft` scripts |
| `.github/workflows/generate-newsletter.yml` | Add notification step |
| `.github/workflows/send-newsletter.yml` | **New** - Monday send workflow |

## Required Secrets

Ensure these are set in GitHub repository settings:
- `GEMINI_API_KEY` ✓ (already exists)
- `RESEND_API_KEY` ✓ (already exists)
- `TEST_EMAIL` - Your editor email for notifications
- `RESEND_SEGMENT_ID` - Audience ID for broadcasts
