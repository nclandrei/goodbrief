import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditJudgments, fingerprint, startAssessment, validateAssessment } from '../scripts/lib/amp-assessment.js';
import { armAssessment, continueAssessment, wakeAssessment } from '../scripts/lib/assessment-worker.js';
import type { WeeklyBuffer } from '../scripts/types.js';
import { WORKSPACE_ROOT } from './helpers.js';

const raw: WeeklyBuffer = { weekId: '2026-W42', lastUpdated: '2026-10-17T10:00:00Z', articles: [
  { id: 'a', sourceId: 'test', sourceName: 'Test', title: 'A park opens', summary: 'Accessible park', url: 'https://example.com/a', publishedAt: '2026-10-16T10:00:00Z', fetchedAt: '2026-10-17T10:00:00Z' },
  { id: 'b', sourceId: 'test', sourceName: 'Test', title: 'A budget cut', summary: 'Less transport', url: 'https://example.com/b', publishedAt: '2026-10-15T10:00:00Z', fetchedAt: '2026-10-17T10:00:00Z' },
  { id: 'old', sourceId: 'test', sourceName: 'Test', title: 'Old opening', summary: '', url: 'https://example.com/old', publishedAt: '2026-10-01T10:00:00Z', fetchedAt: '2026-10-17T10:00:00Z' },
] };
const now = '2026-10-17T12:00:00Z';
const item = (index: number) => ({ index, fingerprint: fingerprint(raw, index), assessedAt: now,
  decision: index === 0 ? 'candidate' as const : 'reject' as const,
  positivity: index === 0 ? 90 : 5, impact: 60, audienceRelevance: 70,
  judgment: index === 0 ? 'Accessible park adds public space for neighborhood residents.' : 'Transport budget reduction removes service rather than adding progress.' });

test('coverage distinguishes explicit date exclusions from negative eligible stories and fails closed', () => {
  const run = startAssessment(raw, now, now);
  assert.equal(run.exclusions.length, 1);
  assert.equal(run.exclusions[0].index, 2);
  run.assessments.push(item(0));
  assert.equal(validateAssessment(run, raw).missing, 1);
  assert.throws(() => validateAssessment(run, raw, true), /Incomplete/);
  run.assessments.push(item(1));
  assert.equal(validateAssessment(run, raw, true).missing, 0);
  const changed = structuredClone(raw);
  changed.articles[0].summary = 'Changed excerpt';
  assert.throws(() => validateAssessment(run, changed), /snapshot mismatch/);
  for (const mutate of [
    (r: typeof run) => { r.assessments.push(item(0)); },
    (r: typeof run) => { r.assessments[0].impact = NaN; },
    (r: typeof run) => { r.assessments[1].judgment = r.assessments[0].judgment; },
    (r: typeof run) => { r.exclusions[0].reason = 'Not interesting'; },
    (r: typeof run) => { r.assessments[0].fingerprint = 'bad'; },
  ]) {
    const bad = structuredClone(run); mutate(bad);
    assert.throws(() => validateAssessment(bad, raw));
  }
});

test('eligibility records malformed, repeated, future and stale inputs, including the age boundary', () => {
  const pool = structuredClone(raw);
  pool.articles = [
    { ...raw.articles[0], publishedAt: '2026-10-03T12:00:00Z' },
    { ...raw.articles[1], publishedAt: '2026-10-03T11:59:59Z' },
    { ...raw.articles[0], id: 'future', publishedAt: '2026-10-17T12:00:01Z' },
    { ...raw.articles[0], id: 'invalid', publishedAt: 'unknown' },
    { ...raw.articles[0] },
    { ...raw.articles[0], id: 'bad-title', title: '' },
  ];
  const run = startAssessment(pool, now, now);
  assert.deepEqual(run.exclusions.map(e => e.index), [1, 2, 3, 4, 5]);
  assert.match(run.exclusions[2].reason, /Invalid publication/);
  assert.match(run.exclusions[3].reason, /Duplicate raw ID/);
  assert.equal(validateAssessment(run, pool).missing, 1);
  run.assessments = [item(0), { ...item(1), judgment: 'Accessible park adds public space for neighborhood residents, also today.' }];
  assert.ok(auditJudgments(run).repeatedSixWordPhrases.some(p => p.indices.join(',') === '0,1'));
});

test('CLI survives interruption, rejects a bad batch atomically, resumes and blocks unfinished proof', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amp-assessment-'));
  const cli = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', join(WORKSPACE_ROOT, 'scripts/assess-news.ts'), ...args], { encoding: 'utf8', stdio: 'pipe' });
  try {
    const path = join(dir, 'raw.json'); writeFileSync(path, JSON.stringify(raw));
    // Simulate death during init after snapshot persistence, before ledger persistence.
    writeFileSync(join(dir, 'input.json'), JSON.stringify(raw));
    cli('init', dir, path);
    const checkpoint = join(dir, 'assessment.json');
    const batch = join(dir, 'batch.json');
    const imported = { ...item(0), assessedAt: new Date().toISOString() };
    writeFileSync(batch, JSON.stringify({ assessments: [imported] }));
    cli('import', dir, batch);
    const before = readFileSync(checkpoint, 'utf8');
    writeFileSync(`${checkpoint}.tmp`, '{unfinished write');
    // A second process resumes from disk, not in-memory state.
    assert.throws(() => cli('check', dir));
    assert.throws(() => cli('import', dir, batch));
    assert.equal(readFileSync(checkpoint, 'utf8'), before);
    const proof = join(dir, 'proposal.json');
    writeFileSync(proof, JSON.stringify({ weekId: raw.weekId, selected: [] }));
    assert.throws(() => cli('finish', dir, proof), /Incomplete assessment/);
    assert.equal(existsSync(join(dir, 'finished-proof.json')), false);
    writeFileSync(batch, JSON.stringify({ assessments: [{ ...item(1), assessedAt: new Date().toISOString() }] }));
    cli('import', dir, batch);
    assert.equal(JSON.parse(cli('check', dir)).missing, 0);
    assert.throws(() => cli('init', dir, path));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const threadId = 'T-00000000-0000-0000-0000-000000000001';

test('unattended recovery uses persisted coverage, keeps finalization pending, and is thread-bound', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amp-worker-'));
  const event = (id: number) => ({ thread: { id: threadId }, id, status: 'done' as const });
  try {
    const run = startAssessment(raw, now, now);
    writeFileSync(join(dir, 'input.json'), JSON.stringify(raw));
    writeFileSync(join(dir, 'assessment.json'), JSON.stringify(run));
    armAssessment(dir, dir, threadId);
    assert.equal(continueAssessment(dir, { ...event(1), thread: { id: 'T-unrelated' } }), undefined);
    assert.match(continueAssessment(dir, event(1))!.userMessage, /2 rows remain/);
    assert.equal(continueAssessment(dir, event(1)), undefined);
    // No state lives in the handler: the next invocation sees a restarted writer's work.
    run.assessments.push(item(0), item(1));
    writeFileSync(join(dir, 'assessment.json'), JSON.stringify(run));
    const next = continueAssessment(dir, event(2));
    assert.match(next!.userMessage, /0 rows remain; phase=source-check-and-finalize/);
    assert.equal(JSON.parse(readFileSync(join(dir, '.amp', 'assessment-worker.json'), 'utf8')).status, 'active');
    assert.throws(() => armAssessment(dir, dir, threadId), /already active/);
    assert.equal(existsSync(join(dir, 'completion.json')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unattended recovery stops on cancellation, no progress, expiry or invalid state instead of looping or claiming success', () => {
  for (const mode of ['cancelled', 'stalled', 'expired', 'invalid'] as const) {
    const dir = mkdtempSync(join(tmpdir(), 'amp-worker-stop-'));
    try {
      writeFileSync(join(dir, 'input.json'), JSON.stringify(raw));
      writeFileSync(join(dir, 'assessment.json'), JSON.stringify(startAssessment(raw, now, now)));
      armAssessment(dir, dir, threadId);
      const path = join(dir, '.amp', 'assessment-worker.json');
      if (mode === 'expired') {
        const config = JSON.parse(readFileSync(path, 'utf8'));
        config.deadlineAt = '2020-01-01T00:00:00Z';
        writeFileSync(path, JSON.stringify(config));
      }
      if (mode === 'invalid') writeFileSync(join(dir, 'assessment.json'), '{torn checkpoint');
      const end = (id: number) => continueAssessment(dir, {
        thread: { id: threadId }, id, status: mode === 'cancelled' ? 'cancelled' : 'done',
      });
      if (mode === 'stalled') { assert.ok(end(1)); assert.ok(end(2)); }
      assert.equal(end(3), undefined);
      assert.equal(JSON.parse(readFileSync(path, 'utf8')).status, mode);
      assert.equal(end(4), undefined);
      assert.deepEqual(wakeAssessment(dir, dir, threadId), { status: mode, proceed: false, instructions: undefined });
      assert.equal(existsSync(join(dir, 'completion.json')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a durable scheduled wake recovers a missed end event without reinitializing or changing authored work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amp-scheduled-worker-'));
  try {
    const run = startAssessment(raw, now, now);
    writeFileSync(join(dir, 'input.json'), JSON.stringify(raw));
    writeFileSync(join(dir, 'assessment.json'), JSON.stringify(run));
    armAssessment(dir, dir, threadId, 90);
    const request = JSON.parse(readFileSync(join(dir, 'schedule-request.json'), 'utf8'));
    assert.equal(request.schedule, 'RRULE:FREQ=MINUTELY;INTERVAL=5;COUNT=18');
    assert.equal(request.run_mode, 'existing');
    // The agent persisted a batch, then ended, but NO agent.end callback ran.
    run.assessments.push(item(0));
    const checkpoint = JSON.stringify(run);
    writeFileSync(join(dir, 'assessment.json'), checkpoint);
    const wake = wakeAssessment(dir, dir, threadId);
    assert.equal(wake.proceed, true);
    assert.match(wake.instructions!, /1 rows remain/);
    assert.equal(readFileSync(join(dir, 'assessment.json'), 'utf8'), checkpoint);
    assert.equal(existsSync(join(dir, 'finished-proof.json')), false);
    assert.throws(() => wakeAssessment(dir, dir, 'T-another-thread'), /does not own/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
