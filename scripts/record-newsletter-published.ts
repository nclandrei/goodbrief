#!/usr/bin/env npx tsx

import {
  loadNewsletterDeliveryManifest,
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

function main(): void {
  const weekId = parseWeek();
  const rootDir = resolveProjectRoot(import.meta.url);
  const manifest = loadNewsletterDeliveryManifest(rootDir, weekId);
  if (!manifest || manifest.remoteStatus !== 'sent') {
    throw new Error(
      `Cannot mark ${weekId} published without a sent delivery manifest.`
    );
  }

  manifest.publishedAt ||= new Date().toISOString();
  const path = saveNewsletterDeliveryManifest(rootDir, manifest);
  console.log(`✓ Recorded archive publication in ${path}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
