#!/usr/bin/env npx tsx

import 'dotenv/config';
import { resolveProjectRoot } from './lib/project-root.js';
import { checkConfiguredFeedHealth } from './lib/feed-health.js';

const ROOT_DIR = resolveProjectRoot(import.meta.url);

async function main(): Promise<void> {
  const results = await checkConfiguredFeedHealth(ROOT_DIR);
  let failed = 0;

  for (const result of results) {
    if (!result.ok) {
      failed += 1;
      console.log(
        `FAIL ${result.source.name}: status=${result.statusCode ?? 'n/a'} usable=${result.usableItemCount} parsed=${result.parsedItemCount} error=${result.error}`
      );
      continue;
    }

    console.log(
      `OK   ${result.source.name}: status=${result.statusCode ?? 'n/a'} usable=${result.usableItemCount} parsed=${result.parsedItemCount} content_type=${result.contentType ?? 'n/a'}`
    );
  }

  if (failed > 0) {
    throw new Error(`${failed} feed(s) failed health verification`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
