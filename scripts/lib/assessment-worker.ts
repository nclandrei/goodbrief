import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { hash, validateAssessment, type AssessmentRun } from './amp-assessment.js';
import { readJson, saveAssessmentJson } from './assessment-files.js';
import { editorReviewReady } from './editor-review.js';
import { validateIndependentProof, type IndependentProof } from '../send-independent-proof.js';
import type { WeeklyBuffer } from '../types.js';

export { readJson, saveAssessmentJson } from './assessment-files.js';

export function inspectAssessment(directory: string) {
  const raw = readJson<WeeklyBuffer>(join(directory, 'input.json'));
  const run = readJson<AssessmentRun>(join(directory, 'assessment.json'));
  const coverage = validateAssessment(run, raw);
  const output = join(directory, 'finished-proof.json');
  const receipt = join(directory, 'completion.json');
  let proof: IndependentProof | undefined;
  if (existsSync(output)) {
    proof = readJson<IndependentProof>(output);
    validateIndependentProof(proof, raw);
    if (hash(proof.assessment) !== hash(run)) throw new Error('Finished proof differs from current assessment');
  }
  if (existsSync(receipt)) {
    const completion = readJson<Record<string, unknown>>(receipt);
    if (!proof || completion.inputHash !== run.inputHash || completion.assessmentHash !== hash(run) ||
        completion.proofHash !== hash(proof) || completion.missing !== 0) {
      throw new Error('Completion receipt does not match validated proof and checkpoint');
    }
  }
  return { raw, run, coverage, proof, complete: Boolean(proof && existsSync(receipt)) };
}

// Retrying after a crash between the proof and receipt writes is safe; replacing a
// different finished edition is not. Neither output is a production draft.
export function finishAssessment(directory: string, proposal: IndependentProof): void {
  const { raw, run, coverage, proof: existing } = inspectAssessment(directory);
  validateAssessment(run, raw, true);
  const proof = { ...proposal, assessment: run };
  validateIndependentProof(proof, raw);
  if (existing && hash(existing) !== hash(proof)) throw new Error('Refusing to replace a different finished proof');
  if (!existing) saveAssessmentJson(join(directory, 'finished-proof.json'), proof);
  if (!existsSync(join(directory, 'completion.json'))) {
    saveAssessmentJson(join(directory, 'completion.json'), {
      completedAt: new Date().toISOString(), elapsedMs: Date.now() - Date.parse(run.startedAt),
      inputHash: run.inputHash, assessmentHash: hash(run), proofHash: hash(proof), ...coverage,
    });
  }
}

interface Worker {
  version: 1;
  threadId: string;
  directory: string;
  goal?: 'assessment' | 'editor-review';
  armedAt: string;
  deadlineAt: string;
  status: 'active' | 'complete' | 'cancelled' | 'expired' | 'stalled' | 'invalid' | 'limit' | 'error';
  continuations: number;
  noProgress: number;
  errors: number;
  progress: string;
  lastEventId?: string | number;
  reason?: string;
}

const workerPath = (root: string) => join(root, '.amp', 'assessment-worker.json');

function progressHash(directory: string, state: ReturnType<typeof inspectAssessment>): string {
  return hash([state.run, state.proof ?? null, state.complete,
    ...['proposal.json', 'editorial-review.json', 'proof-email.json', 'review-ready.json'].map(name => {
      const path = join(directory, name);
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    })]);
}

export function armAssessment(root: string, directory: string, threadId: string, minutes = 90, goal: Worker['goal'] = 'assessment'): void {
  if (!/^T-[0-9a-f-]{36}$/i.test(threadId) || !Number.isFinite(minutes) || minutes <= 0 || minutes > 180) {
    throw new Error('Use a valid Amp thread ID and a deadline of 1–180 minutes');
  }
  const path = workerPath(root);
  if (existsSync(path) && readJson<Worker>(path).status === 'active') throw new Error('An assessment worker is already active');
  directory = resolve(directory);
  const state = inspectAssessment(directory);
  if (state.complete && (goal !== 'editor-review' || editorReviewReady(root, directory, state.proof!, state.raw))) {
    throw new Error('Assessment is already finished');
  }
  const worker: Worker = {
    version: 1, threadId, directory, goal, armedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + minutes * 60000).toISOString(), status: 'active',
    continuations: 0, noProgress: 0, errors: 0, progress: progressHash(directory, state),
  };
  // Weekly production review uses its persistent Saturday wake-ups. Never
  // replace that recurring schedule with a temporary trial recovery schedule.
  if (goal === 'editor-review') {
    saveAssessmentJson(path, worker);
    return;
  }
  // A server-owned wake-up is independent of a lost agent.end dispatch. Creating
  // this request is local; the operator must explicitly install it with Amp tools.
  saveAssessmentJson(join(directory, 'schedule-request.json'), {
    title: `Bounded Good Brief assessment recovery ${state.run.weekId}`,
    run_mode: 'existing',
    schedule: `RRULE:FREQ=MINUTELY;INTERVAL=5;COUNT=${Math.ceil(minutes / 5)}`,
    schedule_label: `Every 5 minutes, at most ${Math.ceil(minutes / 5)} times`,
    prompt: `Continue this thread's explicitly armed Good Brief assessment, not another thread. ` +
      `First run: node --import tsx scripts/assess-news.ts wake ${JSON.stringify(directory)} ${threadId}. ` +
      'Read the JSON result. If proceed is false, clear this recovery schedule and stop; report a failure unless status is complete. ' +
      'If proceed is true, load .amp/plugins/goodbrief-assessment.js if its hooks were lost, then follow instructions from the JSON and resume the existing checkpoint. ' +
      'Never initialize a replacement run, manufacture missing judgments, or consult previous editorial artifacts. ' +
      'After a validated finished proof and matching receipt, clear this recovery schedule before your final reply. ' +
      'Do not send mail, approve, push, publish or change any production schedule.',
  });
  saveAssessmentJson(path, worker);
}

function readWorker(root: string, threadId: string): Worker | undefined {
  if (!existsSync(workerPath(root))) return;
  const worker = readJson<Worker>(workerPath(root));
  if (worker.threadId !== threadId || worker.status !== 'active') return;
  if (worker.version !== 1 || !isAbsolute(worker.directory) || !Number.isFinite(Date.parse(worker.deadlineAt)) ||
      (worker.goal !== undefined && !['assessment', 'editor-review'].includes(worker.goal)) ||
      ![worker.continuations, worker.noProgress, worker.errors].every(n => Number.isInteger(n) && n >= 0)) {
    throw new Error('Invalid assessment worker configuration');
  }
  return worker;
}

export function assessmentTimeRemaining(root: string, threadId: string): number | undefined {
  const worker = readWorker(root, threadId);
  return worker ? Math.max(0, Date.parse(worker.deadlineAt) - Date.now()) : undefined;
}

export function assessmentWorkerContext(root: string, threadId: string): string | undefined {
  const worker = readWorker(root, threadId);
  if (!worker) return;
  return `Checkpoint-driven Good Brief assessment is armed until ${worker.deadlineAt}. ` +
    `Use the existing run at ${JSON.stringify(worker.directory)}. Assess every missing title and complete RSS excerpt yourself; ` +
    'never generate scores or judgments from rules, templates, another model API, or previous editorial artifacts. ' +
    'Persist small authored batches. After full coverage, verify finalist full sources, choose a varied 7–12-story edition, ' +
    'write proposal.json. Coverage alone is not completion. ' +
    (worker.goal === 'editor-review'
      ? 'Write editorial-review.json with selectionReasoning, alternativesAndCuts, sourceLimitations and at least 12 distinct spotChecks {index, notes}, including candidates and rejects across the pool. ' +
        'Run weekly-review.ts stage before assess-news.ts finish, so freshness failures can still change the proposal. Inspect the staged proof and newsletter in the browser. ' +
        'Then finish the assessment and run weekly-review.ts deliver. Completion requires the matching unapproved draft and one accepted editor-only proof, not merely a finished assessment. ' +
        'Do not send a separate test email automatically. Never approve, push, email subscribers, or change or clear the recurring weekly schedule. '
      : 'Run assess-news.ts finish. No email, approval, push, production writes, or production schedule changes. ' +
        'Manage only this run’s bounded recovery schedule and clear it at any terminal outcome. ') +
    'Do not ask a person to continue.';
}

export function continueAssessment(root: string, event: {
  thread: { id: string }; id: string | number; status: 'done' | 'error' | 'cancelled';
  source?: 'agent.end' | 'schedule';
}): { action: 'continue'; userMessage: string; maxContinuations: number } | undefined {
  const worker = readWorker(root, event.thread.id);
  if (!worker || worker.lastEventId === event.id) return;
  worker.lastEventId = event.id;
  let missing: number | undefined;
  let phase = 'invalid';
  try {
    const state = inspectAssessment(worker.directory);
    missing = state.coverage.missing;
    const complete = state.complete && (worker.goal !== 'editor-review' || editorReviewReady(root, worker.directory, state.proof!, state.raw));
    phase = missing ? 'assessment' : complete ? 'complete' : state.complete ? 'editor-handoff' : 'source-check-and-finalize';
    const current = progressHash(worker.directory, state);
    worker.noProgress = current === worker.progress ? worker.noProgress + 1 : 0;
    worker.progress = current;
    worker.errors = event.status === 'error' ? worker.errors + 1 : 0;
    if (event.status === 'cancelled') worker.status = 'cancelled';
    else if (complete) worker.status = 'complete';
    else if (Date.now() >= Date.parse(worker.deadlineAt)) worker.status = 'expired';
    else if (worker.errors >= 3) worker.status = 'error';
    else if (worker.noProgress >= 3) worker.status = 'stalled';
    else if (worker.continuations >= 128) worker.status = 'limit';
    else worker.continuations++;
  } catch (error) {
    worker.status = event.status === 'cancelled' ? 'cancelled' : 'invalid';
    worker.reason = error instanceof Error ? error.message : String(error);
  }
  appendFileSync(join(worker.directory, 'continuations.jsonl'), `${JSON.stringify({
    at: new Date().toISOString(), eventId: event.id, turnStatus: event.status, source: event.source ?? 'agent.end',
    workerStatus: worker.status, missing, phase, continuations: worker.continuations,
    noProgress: worker.noProgress, errors: worker.errors, reason: worker.reason,
  })}\n`);
  saveAssessmentJson(workerPath(root), worker);
  if (worker.status !== 'active') return;
  return {
    action: 'continue', maxContinuations: 128,
    userMessage: `${assessmentWorkerContext(root, event.thread.id)}\n` +
      `Automatic checkpoint recovery ${worker.continuations}: ${missing} rows remain; phase=${phase}. ` +
      `Read the validated checkpoint, run page for the next missing rows, and keep working. ` +
      'If all rows are assessed, complete source checks, selection, audit and finish instead. ' +
      'If finished-proof.json exists without completion.json, retry finish using that same proof. ' +
      'A final reply is not a successful run; only the validated matching completion receipt stops recovery.',
  };
}

export function wakeAssessment(root: string, directory: string, threadId: string) {
  const path = workerPath(root);
  const before = readJson<Worker>(path);
  if (before.threadId !== threadId || before.directory !== resolve(directory)) throw new Error('Scheduled wake-up does not own this run');
  const continuation = continueAssessment(root, {
    thread: { id: threadId }, id: `scheduled-${randomUUID()}`, status: 'done', source: 'schedule',
  });
  const worker = readJson<Worker>(path);
  if (worker.status === 'complete' && !inspectAssessment(directory).complete) throw new Error('Finished worker has no valid completion');
  return { status: worker.status, proceed: Boolean(continuation), instructions: continuation?.userMessage };
}
