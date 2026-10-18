#!/usr/bin/env npx tsx
// No inference API: Amp reads input pages and authors assessment JSON batches.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditJudgments, fingerprint, hash, startAssessment, validateAssessment, type AssessmentRun } from './lib/amp-assessment.js';
import { armAssessment, finishAssessment, inspectAssessment, readJson as load, saveAssessmentJson as save, wakeAssessment } from './lib/assessment-worker.js';
import type { IndependentProof } from './send-independent-proof.js';
import type { WeeklyBuffer } from './types.js';

const [command, directory, argument] = process.argv.slice(2);
try {
  if (!directory) throw new Error('Use assess-news.ts init|page|import|check|audit|finish|arm|wake|status <run-directory> [raw-file|offset|batch-file|proof-file|thread-id]');
  const inputPath = join(directory, 'input.json');
  const runPath = join(directory, 'assessment.json');
  if (command === 'init') {
    if (existsSync(runPath)) throw new Error('Refusing to overwrite a run; resume it instead');
    const raw = load(argument) as WeeklyBuffer;
    if (existsSync(inputPath) && hash(load(inputPath)) !== hash(raw)) throw new Error('Interrupted initialization has a different input snapshot');
    const run = startAssessment(raw, new Date().toISOString());
    save(inputPath, raw);
    save(join(directory, 'input-manifest.json'), { acquiredAt: run.startedAt, weekId: raw.weekId, inputHash: run.inputHash,
      rows: raw.articles.map((a, index) => ({ index, id: a?.id, fingerprint: fingerprint(raw, index) })) });
    save(runPath, run);
  } else if (command === 'arm') {
    armAssessment(fileURLToPath(new URL('../', import.meta.url)), directory, argument, Number(process.argv[5] ?? 90));
    console.log(`Worker armed locally. Install ${join(directory, 'schedule-request.json')} with Amp set_schedule and confirm it with get_schedule before unattended work.`);
  } else if (command === 'wake') {
    console.log(JSON.stringify(wakeAssessment(fileURLToPath(new URL('../', import.meta.url)), directory, argument), null, 2));
  } else if (command === 'status') {
    const { coverage, complete } = inspectAssessment(directory);
    console.log(JSON.stringify({ ...coverage, complete }, null, 2));
    if (!complete) process.exitCode = 1;
  } else {
    const raw = load(inputPath) as WeeklyBuffer;
    const run = load(runPath) as AssessmentRun;
    const coverage = validateAssessment(run, raw);
    if (command === 'page') {
      const offset = Number(argument ?? 0);
      if (!Number.isInteger(offset) || offset < 0) throw new Error('Offset must be a nonnegative integer');
      console.log(JSON.stringify(coverage.missingIndices.slice(offset, offset + 25).map(index => ({ index, ...raw.articles[index] })), null, 2));
    } else if (command === 'import') {
      const batch = load<{ assessments?: AssessmentRun['assessments']; sourceChecks?: AssessmentRun['sourceChecks'] }>(argument);
      if (!Array.isArray(batch.assessments ?? []) || !Array.isArray(batch.sourceChecks ?? [])) throw new Error('Invalid batch');
      run.assessments.push(...(batch.assessments ?? []));
      run.sourceChecks.push(...(batch.sourceChecks ?? []));
      validateAssessment(run, raw);
      save(runPath, run);
    } else if (command === 'audit') {
      const report = { checkedAt: new Date().toISOString(), assessmentHash: hash(run), ...auditJudgments(run) };
      save(join(directory, 'judgment-audit.json'), report);
      console.log(JSON.stringify(report, null, 2));
    } else if (command === 'check') {
      const report = { checkedAt: new Date().toISOString(), inputHash: run.inputHash, assessmentHash: hash(run), ...coverage, complete: coverage.missing === 0 };
      save(join(directory, 'validation.json'), report);
      console.log(JSON.stringify(report, null, 2));
      if (coverage.missing) process.exitCode = 1;
    } else if (command === 'finish') {
      finishAssessment(directory, load<IndependentProof>(argument));
    } else throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
