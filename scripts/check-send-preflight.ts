#!/usr/bin/env npx tsx

import { appendFileSync } from 'fs';
import { resolveProjectRoot } from './lib/project-root.js';
import { getSendPreflight } from './lib/send-preflight.js';

function parseWeekArg(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--week' && args[i + 1]) {
      return args[i + 1];
    }
  }

  throw new Error('Missing required --week argument');
}

function writeOutputs(outputs: Record<string, string>): void {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, 'utf-8');
}

function main(): void {
  const weekId = parseWeekArg();
  const rootDir = resolveProjectRoot(import.meta.url);
  const preflight = getSendPreflight(rootDir, weekId);
  const outputs = {
    draft_exists: String(preflight.draftExists),
    issue_exists: String(preflight.issueExists),
    issue_filename: preflight.issueFilename,
    issue_path: preflight.issuePath,
  };

  writeOutputs(outputs);

  console.log(`Week: ${weekId}`);
  console.log(`Draft exists: ${preflight.draftExists}`);
  console.log(`Issue exists: ${preflight.issueExists}`);
  console.log(`Issue file: ${preflight.issueFilename}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
