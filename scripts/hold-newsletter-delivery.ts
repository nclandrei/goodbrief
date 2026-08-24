#!/usr/bin/env npx tsx

import 'dotenv/config';
import {
  holdNewsletterDelivery,
  loadNewsletterDeliveryManifest,
  ResendNewsletterBroadcastGateway,
  saveNewsletterDeliveryManifest,
} from './lib/newsletter-delivery.js';
import { resolveProjectRoot } from './lib/project-root.js';

function parseWeek(): string {
  const args = process.argv.slice(2);
  const index = args.indexOf('--week');
  if (index < 0 || !args[index + 1]) {
    throw new Error('Missing required --week argument');
  }
  return args[index + 1];
}

async function main(): Promise<void> {
  const weekId = parseWeek();
  const rootDir = resolveProjectRoot(import.meta.url);
  const manifest = loadNewsletterDeliveryManifest(rootDir, weekId);
  if (!manifest) {
    throw new Error(`Cannot place ${weekId} on hold without a delivery manifest.`);
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is required to place a delivery on hold.');
  }

  const held = await holdNewsletterDelivery({
    gateway: new ResendNewsletterBroadcastGateway(apiKey),
    manifest,
  });
  const path = saveNewsletterDeliveryManifest(rootDir, held);
  console.log(`✓ Broadcast ${held.broadcastId} is on hold as a Resend draft.`);
  console.log(`✓ Updated ${path}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
