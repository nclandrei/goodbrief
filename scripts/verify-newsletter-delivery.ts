#!/usr/bin/env npx tsx

import 'dotenv/config';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertDraftReadyForProduction } from './lib/draft-delivery.js';
import {
  createDesiredNewsletterDelivery,
  loadNewsletterDeliveryManifest,
  ResendNewsletterBroadcastGateway,
  saveNewsletterDeliveryManifest,
  verifyNewsletterDelivery,
} from './lib/newsletter-delivery.js';
import { buildNewsletterEmail } from './lib/newsletter-email.js';
import { getNewsletterDeliveryAt } from './lib/newsletter-schedule.js';
import { resolveProjectRoot } from './lib/project-root.js';
import type { NewsletterDraft } from './types.js';

interface CliArgs {
  weekId: string;
  scheduledAt: string;
  allowPending: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let weekId = '';
  let scheduledAt = '';
  let allowPending = false;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--week' && args[index + 1]) {
      weekId = args[index + 1];
      index += 1;
    } else if (args[index] === '--scheduled-at' && args[index + 1]) {
      scheduledAt = args[index + 1];
      index += 1;
    } else if (args[index] === '--allow-pending') {
      allowPending = true;
    }
  }

  if (!weekId || !scheduledAt) {
    throw new Error('Both --week and --scheduled-at are required');
  }
  return { weekId, scheduledAt, allowPending };
}

function writeOutputs(outputs: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  appendFileSync(
    outputPath,
    `${Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    'utf-8'
  );
}

async function main(): Promise<void> {
  const { weekId, scheduledAt, allowPending } = parseArgs();
  const rootDir = resolveProjectRoot(import.meta.url);
  const expectedScheduledAt = getNewsletterDeliveryAt(weekId).toISOString();
  if (scheduledAt !== expectedScheduledAt) {
    throw new Error(
      `Unexpected scheduled time ${scheduledAt}; expected ${expectedScheduledAt}.`
    );
  }

  const draftPath = join(rootDir, 'data', 'drafts', `${weekId}.json`);
  if (!existsSync(draftPath)) {
    throw new Error(`Draft not found at ${draftPath}`);
  }
  const draft = JSON.parse(readFileSync(draftPath, 'utf-8')) as NewsletterDraft;
  if (draft.weekId !== weekId) {
    throw new Error(
      `Draft identity mismatch: requested ${weekId}, but the file contains ${draft.weekId}.`
    );
  }
  assertDraftReadyForProduction(draft, 'post-send verification');

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const segmentId = (
    process.env.RESEND_SEGMENT_ID || process.env.RESEND_AUDIENCE_ID
  )?.trim();
  if (!apiKey || !segmentId) {
    throw new Error('RESEND_API_KEY and RESEND_SEGMENT_ID are required');
  }

  const email = buildNewsletterEmail(draft);
  const desired = createDesiredNewsletterDelivery({
    weekId,
    segmentId,
    scheduledAt,
    subject: email.subject,
    html: email.html,
    deliverySha256: email.deliverySha256,
  });
  const manifest = loadNewsletterDeliveryManifest(rootDir, weekId);
  if (!manifest) {
    throw new Error(
      `Delivery manifest for ${weekId} is missing; the newsletter was not safely prepared.`
    );
  }

  const result = await verifyNewsletterDelivery({
    desired,
    gateway: new ResendNewsletterBroadcastGateway(apiKey),
    manifest,
    allowPending,
  });
  const manifestPath = saveNewsletterDeliveryManifest(rootDir, result.manifest);
  writeOutputs({
    ready_to_publish: String(result.readyToPublish),
    remote_status: result.manifest.remoteStatus,
    manifest_path: manifestPath,
  });

  if (result.readyToPublish) {
    console.log(
      `✓ Resend confirms ${weekId} broadcast ${manifest.broadcastId} was sent.`
    );
  } else {
    console.log(
      `Newsletter ${weekId} is still ${result.manifest.remoteStatus}; the grace-period check will not publish yet.`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
