#!/usr/bin/env npx tsx

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { exec } from 'child_process';
import { Resend } from 'resend';
import type { NewsletterDraft } from './types.js';
import { sendAlert } from './lib/alert.js';
import { resolveProjectRoot } from './lib/project-root.js';
import {
  assertDraftValidated,
  recordDraftTestDelivery,
} from './lib/draft-delivery.js';
import { buildNewsletterEmail } from './lib/newsletter-email.js';
import { formatValidationNotesForConsole } from './lib/validation-notes.js';

const ROOT_DIR = resolveProjectRoot(import.meta.url);

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

function getDraftPath(weekId: string): string {
  return join(ROOT_DIR, 'data', 'drafts', `${weekId}.json`);
}

// Load draft from data/drafts/
function loadDraft(weekId: string): NewsletterDraft {
  const draftPath = getDraftPath(weekId);

  if (!existsSync(draftPath)) {
    console.error(`Error: Draft not found at ${draftPath}`);
    process.exit(1);
  }

  const content = readFileSync(draftPath, 'utf-8');
  return JSON.parse(content) as NewsletterDraft;
}

function saveDraft(weekId: string, draft: NewsletterDraft): void {
  writeFileSync(getDraftPath(weekId), `${JSON.stringify(draft, null, 2)}\n`);
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

// Test mode: send to test email(s)
async function handleTest(
  html: string,
  subject: string
): Promise<{ id: string; sentAt: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('Error: RESEND_API_KEY environment variable is required');
    process.exit(1);
  }

  const testEmailEnv = process.env.TEST_EMAIL;
  if (!testEmailEnv) {
    console.error(
      'Error: TEST_EMAIL environment variable is required for test mode'
    );
    console.error('Set it with: export TEST_EMAIL=your@email.com');
    console.error('For multiple recipients: export TEST_EMAIL="email1@example.com,email2@example.com"');
    process.exit(1);
  }

  const testEmails = testEmailEnv.split(',').map(e => e.trim()).filter(Boolean);

  const resend = new Resend(apiKey);

  console.log(`Sending test email to ${testEmails.join(', ')}...`);

  const { data, error } = await resend.emails.send({
    from: 'Good Brief <buna@goodbrief.ro>',
    replyTo: 'hello@goodbrief.ro',
    to: testEmails,
    subject: `[TEST] ${subject}`,
    html,
  });

  if (error) {
    console.error('Error sending test email:', error);
    process.exit(1);
  }

  if (!data?.id) {
    throw new Error('Resend accepted the test email without returning a message ID');
  }

  console.log(`✓ Test email sent! ID: ${data.id}`);
  return { id: data.id, sentAt: new Date().toISOString() };
}

// Send mode: broadcast to audience
async function handleSend(
  html: string,
  subject: string,
  weekId: string,
  confirm: boolean,
  automated: boolean,
  draft: NewsletterDraft
): Promise<void> {
  if (!confirm) {
    console.error(
      'Error: --confirm flag is required to send to all subscribers'
    );
    console.error('Run: npm run email:send -- --week ' + weekId + ' --confirm');
    process.exit(1);
  }

  // Only allow sending from GitHub Actions (CI environment)
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  if (!isCI) {
    console.error('Error: Newsletter can only be sent from GitHub Actions.');
    console.error('This prevents accidental sends outside the scheduled Monday delivery.');
    console.error('');
    console.error('Use --preview or --test mode for local testing.');
    process.exit(1);
  }

  if (!automated) {
    console.error('Error: --automated flag is required when running in CI.');
    process.exit(1);
  }

  assertDraftValidated(draft, 'newsletter delivery');

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
      replyTo: 'hello@goodbrief.ro',
      subject,
      html,
    });

  if (broadcastError || !broadcast) {
    await sendAlert({
      title: 'Newsletter send failed',
      weekId,
      reason: 'Failed to create Resend broadcast',
      details: JSON.stringify(broadcastError, null, 2),
      actionItems: [
        'Check the Resend dashboard at <a href="https://resend.com/broadcasts">resend.com/broadcasts</a>',
        'Verify the RESEND_API_KEY and RESEND_SEGMENT_ID are correct',
        'Check if your Resend account has sending limits',
        `Run manually: <code>npm run email:send -- --week ${weekId} --confirm</code>`,
      ],
    });
    console.error('Error creating broadcast:', broadcastError);
    process.exit(1);
  }

  console.log(`✓ Broadcast created: ${broadcast.id}`);
  console.log('Sending to all subscribers...');

  const { error: sendError } = await resend.broadcasts.send(broadcast.id);

  if (sendError) {
    await sendAlert({
      title: 'Newsletter send failed',
      weekId,
      reason: 'Broadcast created but failed to send',
      details: `Broadcast ID: ${broadcast.id}\nError: ${JSON.stringify(sendError, null, 2)}`,
      actionItems: [
        `Check the broadcast status at <a href="https://resend.com/broadcasts/${broadcast.id}">Resend dashboard</a>`,
        'The broadcast may have been created but not sent - check if you can retry from the dashboard',
        'Verify your Resend account has enough sending quota',
        `If the broadcast shows as "draft", you can send it manually from the Resend dashboard`,
      ],
    });
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
  if (args.mode !== 'send') {
    const validationNotes = formatValidationNotesForConsole(draft);
    if (validationNotes) {
      console.log(`${validationNotes}\n`);
    }
  }

  const email = buildNewsletterEmail(draft);
  const grouped = email.grouped;
  console.log(
    `✓ Grouped: ${grouped['local-heroes'].length} local-heroes, ${grouped.wins.length} wins, ${grouped['green-stuff'].length} green-stuff, ${grouped['quick-hits'].length} quick-hits`
  );
  console.log('Using wrapper copy from draft');

  // Render HTML
  console.log('Rendering email HTML...');
  const { html, subject, deliverySha256 } = email;
  console.log('✓ Email rendered\n');
  console.log(`Delivery SHA-256: ${deliverySha256}\n`);

  // Handle mode
  switch (args.mode) {
    case 'preview':
      await handlePreview(html, args.week);
      break;
    case 'test': {
      assertDraftValidated(draft, 'test newsletter delivery');
      const result = await handleTest(html, subject);
      recordDraftTestDelivery(draft, result.sentAt, result.id);
      saveDraft(args.week, draft);
      console.log('✓ Recorded tested delivery hash in the draft');
      console.log('Remember to commit and push the updated draft before Monday.');
      break;
    }
    case 'send':
      await handleSend(
        html,
        subject,
        args.week,
        args.confirm,
        args.automated,
        draft
      );
      break;
  }

  console.log('\n✨ Done!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
