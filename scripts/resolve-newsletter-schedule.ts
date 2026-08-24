#!/usr/bin/env npx tsx

import { appendFileSync } from 'node:fs';
import {
  getExpectedDeliveryWeek,
  getNewsletterDeliveryAt,
  resolveAutomatedNewsletterPreparation,
} from './lib/newsletter-schedule.js';

type Phase = 'prepare' | 'verify';

interface CliArgs {
  phase: Phase;
  weekId: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let phase: Phase | undefined;
  let weekId = '';

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--phase' && args[index + 1]) {
      const value = args[index + 1];
      if (value !== 'prepare' && value !== 'verify') {
        throw new Error(`Invalid --phase value: ${value}`);
      }
      phase = value;
      index += 1;
    } else if (args[index] === '--week' && args[index + 1]) {
      weekId = args[index + 1].trim();
      index += 1;
    }
  }

  if (!phase) {
    throw new Error('Missing required --phase argument');
  }

  return { phase, weekId };
}

function getNow(): Date {
  const override = process.env.GOODBRIEF_SCHEDULE_NOW?.trim();
  const now = override ? new Date(override) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid GOODBRIEF_SCHEDULE_NOW value: ${override}`);
  }
  return now;
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

function main(): void {
  const { phase, weekId: requestedWeek } = parseArgs();
  const now = getNow();
  const eventName = process.env.GITHUB_EVENT_NAME?.trim();

  if (!requestedWeek && eventName && eventName !== 'schedule') {
    throw new Error(
      'Manual newsletter runs require an explicit --week value; the workflow never selects the latest draft.'
    );
  }

  let weekId: string;
  let scheduledAt: string;

  if (requestedWeek) {
    weekId = requestedWeek;
    scheduledAt =
      getNewsletterDeliveryAt(weekId).toISOString();
  } else if (phase === 'prepare') {
    ({ weekId, scheduledAt } = resolveAutomatedNewsletterPreparation(now));
  } else {
    weekId = getExpectedDeliveryWeek(now);
    scheduledAt = getNewsletterDeliveryAt(weekId).toISOString();
  }

  writeOutputs({ week_id: weekId, scheduled_at: scheduledAt });
  console.log(`Week: ${weekId}`);
  console.log(`Scheduled delivery: ${scheduledAt}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
