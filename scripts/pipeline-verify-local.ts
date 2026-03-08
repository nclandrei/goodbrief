#!/usr/bin/env npx tsx

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { VERIFY_LOCAL_SCRIPTS, runScriptSequence } from './lib/pipeline-commands.js';
import { getRootDir, resolveWeekId } from './lib/pipeline-artifacts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COMMAND_ROOT_DIR = join(__dirname, '..');
const DATA_ROOT_DIR = getRootDir(__dirname);

async function main(): Promise<void> {
  const weekId = resolveWeekId(process.argv.slice(2));
  console.log(`Running local draft pipeline verification for ${weekId}...`);
  await runScriptSequence(COMMAND_ROOT_DIR, DATA_ROOT_DIR, VERIFY_LOCAL_SCRIPTS, weekId);
  console.log(`✓ Local verification finished for ${weekId}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
