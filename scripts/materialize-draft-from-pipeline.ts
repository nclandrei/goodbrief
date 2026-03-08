#!/usr/bin/env npx tsx

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { materializeDraftFromRefinedArtifact } from './lib/draft-pipeline.js';
import { getRootDir, resolveWeekId } from './lib/pipeline-artifacts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = getRootDir(__dirname);

async function main(): Promise<void> {
  const weekId = resolveWeekId(process.argv.slice(2));
  const draftPath = materializeDraftFromRefinedArtifact(ROOT_DIR, weekId);
  console.log(`Materialized draft to ${draftPath}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
