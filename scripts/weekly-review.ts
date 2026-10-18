#!/usr/bin/env npx tsx

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { armAssessment, inspectAssessment, wakeAssessment } from './lib/assessment-worker.js';
import { readJson } from './lib/assessment-files.js';
import { editorReviewReady, finishEditorReview, stageEditorReview } from './lib/editor-review.js';
import { getISOWeekId } from './lib/news-ingest.js';
import { resolveProjectRoot } from './lib/project-root.js';
import type { IndependentProof } from './send-independent-proof.js';
import type { NewsletterDraft, WeeklyBuffer } from './types.js';

const root = resolveProjectRoot(import.meta.url);
const codeRoot = fileURLToPath(new URL('../', import.meta.url));

function cli(script: string, ...args: string[]): string {
  return execFileSync(process.execPath, ['--import', 'tsx', join(codeRoot, 'scripts', script), ...args],
    { cwd: codeRoot, encoding: 'utf8', stdio: 'pipe' });
}

function currentWeek(): { weekId: string; now: Date; saturday: boolean } {
  const now = new Date(process.env.GOODBRIEF_REVIEW_NOW || Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid review clock');
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest',
    year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long' }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  const calendarDate = new Date(Number(value('year')), Number(value('month')) - 1, Number(value('day')), 12);
  return { weekId: getISOWeekId(calendarDate), now, saturday: value('weekday') === 'Saturday' };
}

function prepare(threadId: string, requestedWeek?: string) {
  if (!/^T-[0-9a-f-]{36}$/i.test(threadId || '')) throw new Error('Use prepare <current-thread-id> [--week YYYY-WXX]');
  const clock = currentWeek();
  if (!requestedWeek && !clock.saturday) throw new Error('Automatic editorial review runs only on Saturday in Europe/Bucharest');
  const weekId = requestedWeek || clock.weekId;
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(weekId)) throw new Error('Invalid review week');
  const draftPath = join(root, 'data', 'drafts', `${weekId}.json`);
  if (existsSync(draftPath) && readJson<NewsletterDraft>(draftPath).validation?.approvalSource === 'editor-review') {
    return { weekId, proceed: false, status: 'already-editor-approved' };
  }
  const directory = join(root, 'data', 'assessments', weekId);
  const inputPath = join(directory, 'input.json');
  if (!existsSync(join(directory, 'assessment.json'))) {
    if (!existsSync(inputPath) && (existsSync(draftPath) || existsSync(join(root, 'data', 'orb-proofs', `${weekId}.json`)))) {
      throw new Error('A different edition already exists; do not replace it or use it to seed an independent run');
    }
    const sourcePath = existsSync(inputPath) ? inputPath : join(root, 'data', 'raw', `${weekId}.json`);
    const raw = readJson<WeeklyBuffer>(sourcePath);
    if (raw.weekId !== weekId || !Array.isArray(raw.articles) || !raw.articles.length ||
        !Number.isFinite(Date.parse(raw.lastUpdated)) ||
        (!existsSync(inputPath) && (clock.now.getTime() - Date.parse(raw.lastUpdated) > 86400000 || Date.parse(raw.lastUpdated) > clock.now.getTime()))) {
      throw new Error('Current-week raw pool is missing, stale, future-dated or malformed; ingest or hydrate it before starting');
    }
    cli('assess-news.ts', 'init', directory, sourcePath);
  }
  const state = inspectAssessment(directory);
  if (state.raw.weekId !== weekId) throw new Error('Existing snapshot belongs to another week');
  if (state.complete && editorReviewReady(root, directory, state.proof!, state.raw)) {
    return { weekId, directory, proceed: false, status: 'editor-ready' };
  }
  const workerPath = join(root, '.amp', 'assessment-worker.json');
  if (existsSync(workerPath)) {
    const worker = readJson<{ threadId: string; directory: string; status: string; goal?: string }>(workerPath);
    if (worker.status === 'active' || worker.directory === directory) {
      if (worker.threadId !== threadId || worker.directory !== directory || worker.goal !== 'editor-review') {
        throw new Error('Another worker owns this checkpoint; do not reset it');
      }
      const wake = wakeAssessment(root, directory, threadId);
      return { weekId, directory, ...wake };
    }
  }
  armAssessment(root, directory, threadId, 90, 'editor-review');
  return { weekId, directory, status: 'active', proceed: true, missing: state.coverage.missing };
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  if (command === 'prepare') {
    const args = process.argv.slice(2);
    const requested = args.includes('--week') ? args[args.indexOf('--week') + 1] : undefined;
    if (args.includes('--week') && (!requested || requested.startsWith('--'))) throw new Error('Use --week YYYY-WXX');
    console.log(JSON.stringify(prepare(argument, requested), null, 2));
    return;
  }
  if (!argument || !['stage', 'deliver'].includes(command)) throw new Error('Use weekly-review.ts prepare <thread-id> | stage|deliver <run-directory>');
  const directory = resolve(argument);
  const state = inspectAssessment(directory);
  const proof = state.proof ?? { ...readJson<IndependentProof>(join(directory, 'proposal.json')), assessment: state.run };
  if (command === 'stage') {
    console.log(JSON.stringify(await stageEditorReview(root, directory, proof, state.raw), null, 2));
    return;
  }
  if (!state.complete) throw new Error('Finish the validated assessment before editor delivery');
  await stageEditorReview(root, directory, proof, state.raw, true);
  const output = cli('send-independent-proof.ts', '--week', proof.weekId, '--run', directory);
  finishEditorReview(root, directory, proof, state.raw);
  console.log(output.trim());
  console.log(`Editor review ${proof.weekId} is ready; its matching draft remains unapproved. No subscriber broadcast was created.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
