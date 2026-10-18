import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { RawArticle, WeeklyBuffer } from '../scripts/types.js';
import {
  materializeIndependentDraft,
  renderIndependentProof,
  validateIndependentProof,
  type IndependentProof,
} from '../scripts/send-independent-proof.js';
import { WORKSPACE_ROOT } from './helpers.js';
import { fingerprint, hash, startAssessment } from '../scripts/lib/amp-assessment.js';
import { armAssessment, continueAssessment, inspectAssessment, wakeAssessment } from '../scripts/lib/assessment-worker.js';

const execFileAsync = promisify(execFile);

const weekId = '2026-W41';
const rawArticles: RawArticle[] = Array.from({ length: 7 }, (_, i) => ({
  id: `source-${i}`,
  sourceId: 'test',
  sourceName: 'Sursa',
  title: `Titlu ${i}`,
  url: `https://example.com/${i}`,
  summary: `Rezumat ${i}`,
  publishedAt: '2026-10-09T10:00:00Z',
  fetchedAt: '2026-10-09T12:00:00Z',
}));
const raw: WeeklyBuffer = { weekId, lastUpdated: '2026-10-09T12:00:00Z', articles: rawArticles };

function proof(): IndependentProof {
  const assessment = startAssessment(raw, '2026-10-10T09:00:00Z', '2026-10-10T09:00:00Z');
  assessment.assessments = rawArticles.map((_, index) => ({
    index, fingerprint: fingerprint(raw, index), assessedAt: '2026-10-10T09:00:00Z',
    decision: 'candidate', positivity: 87, impact: 63, audienceRelevance: 92,
    judgment: `Synthetic fixture for story ${index}; not an editorial assessment.`,
  }));
  assessment.sourceChecks = rawArticles.map((a, index) => {
    const sourceText = `Synthetic full source fixture ${index}. `.repeat(30);
    return { index, checkedAt: '2026-10-10T09:00:00Z', url: a.url, sourceText,
      sourceHash: hash(sourceText), claims: 'Synthetic verified claim for validation tests only.',
      caveats: 'Not a real source check.', verdict: 'verified' };
  });
  return {
    weekId,
    generatedAt: '2026-10-10T09:00:00Z',
    assessment,
    wrapperCopy: {
      greeting: 'Bună!', intro: 'Știri bune.',
      signOff: 'Pe curând!', shortSummary: 'O săptămână bună.',
    },
    selected: rawArticles.map((article) => ({
      id: article.id,
      title: `Veste ${article.id}`,
      summary: article.summary,
      category: 'local-heroes',
      positivity: 87,
      impact: 63,
      audienceRelevance: 92,
    })),
  };
}

test('editor proof only accepts unique sourced stories from the specified raw week', () => {
  const draft = proof();
  assert.doesNotThrow(() => validateIndependentProof(draft, raw));

  draft.selected[0].id = 'invented';
  assert.throws(() => validateIndependentProof(draft, raw), /no valid raw source/);
  draft.selected[0].id = rawArticles[0].id;
  draft.selected[1] = { ...draft.selected[0] };
  assert.throws(() => validateIndependentProof(draft, raw), /Duplicate story/);
});

test('proof renders scores and escapes untrusted news copy', () => {
  const draft = proof();
  draft.selected[0].title = '<img src=x onerror=alert(1)>';
  const html = renderIndependentProof(draft, raw);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.match(html, /Relevanță pentru public 92\/100/);
  assert.match(html, /PROOF INDEPENDENT/);
});

test('materialized draft remains unapproved for subscriber delivery', () => {
  const draft = materializeIndependentDraft(proof(), raw);
  assert.equal(draft.selected[0].url, 'https://example.com/0');
  assert.equal(draft.selected[0].originalTitle, 'Titlu 0');
  assert.equal(draft.validation?.status, 'failed');
  assert.equal(draft.validation?.approvalSource, undefined);
});

test('no rendering or materialization can bypass coverage and full-source checks', () => {
  for (const finish of [renderIndependentProof, materializeIndependentDraft]) {
    const p = proof();
    p.assessment.assessments.pop();
    p.assessment.sourceChecks.pop();
    assert.throws(() => finish(p, raw), /Incomplete assessment/);
    const unverified = proof();
    unverified.assessment.sourceChecks[2].verdict = 'unverified';
    assert.throws(() => finish(unverified, raw), /full-source verification/);
    const rss = proof();
    rss.assessment.sourceChecks[2].sourceText = raw.articles[2].summary;
    rss.assessment.sourceChecks[2].sourceHash = hash(raw.articles[2].summary);
    assert.throws(() => finish(rss, raw), /Invalid full-source/);
    const changedScore = proof();
    changedScore.selected[3].impact = 20;
    assert.throws(() => finish(changedScore, raw), /scores differ/);
  }
});

test('latest source check controls completion and failed retrieval can recover without deleting history', async () => {
  const p = proof();
  p.assessment.sourceChecks.push({ ...p.assessment.sourceChecks[0], checkedAt: '2026-10-10T09:00:01Z',
    verdict: 'unverified', sourceText: '', sourceHash: hash(''), caveats: 'Publisher unavailable during recheck.' });
  p.generatedAt = '2026-10-10T09:00:02Z';
  assert.throws(() => validateIndependentProof(p, raw), /full-source verification/);
  p.assessment.sourceChecks.push({ ...p.assessment.sourceChecks[0], checkedAt: '2026-10-10T09:00:02Z' });
  assert.doesNotThrow(() => validateIndependentProof(p, raw));
  const dir = mkdtempSync(join(tmpdir(), 'amp-complete-'));
  try {
    writeFileSync(join(dir, 'input.json'), JSON.stringify(raw));
    writeFileSync(join(dir, 'assessment.json'), JSON.stringify(p.assessment));
    writeFileSync(join(dir, 'proposal.json'), JSON.stringify(p));
    await execFileAsync(process.execPath, ['--import', 'tsx', join(WORKSPACE_ROOT, 'scripts/assess-news.ts'), 'finish', dir, join(dir, 'proposal.json')]);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'finished-proof.json'), 'utf8')), p);
    assert.equal(JSON.parse(readFileSync(join(dir, 'completion.json'), 'utf8')).missing, 0);
    // A crash after publishing the proof but before the receipt must be recoverable.
    unlinkSync(join(dir, 'completion.json'));
    const threadId = 'T-00000000-0000-0000-0000-000000000001';
    armAssessment(dir, dir, threadId);
    assert.ok(continueAssessment(dir, { thread: { id: threadId }, id: 1, status: 'done' }));
    const retry = () => execFileAsync(process.execPath, ['--import', 'tsx', join(WORKSPACE_ROOT, 'scripts/assess-news.ts'), 'finish', dir, join(dir, 'finished-proof.json')]);
    await retry();
    const receipt = readFileSync(join(dir, 'completion.json'), 'utf8');
    await retry();
    assert.equal(readFileSync(join(dir, 'completion.json'), 'utf8'), receipt);
    assert.equal(inspectAssessment(dir).complete, true);
    assert.equal(continueAssessment(dir, { thread: { id: threadId }, id: 2, status: 'done' }), undefined);
    assert.equal(JSON.parse(readFileSync(join(dir, '.amp', 'assessment-worker.json'), 'utf8')).status, 'complete');
    const changed = { ...p, wrapperCopy: { ...p.wrapperCopy, intro: 'A different edition.' } };
    writeFileSync(join(dir, 'proposal.json'), JSON.stringify(changed));
    await assert.rejects(execFileAsync(process.execPath, ['--import', 'tsx', join(WORKSPACE_ROOT, 'scripts/assess-news.ts'), 'finish', dir, join(dir, 'proposal.json')]), /different finished proof/);
    writeFileSync(join(dir, 'completion.json'), JSON.stringify({ ...JSON.parse(receipt), proofHash: 'forged' }));
    assert.throws(() => inspectAssessment(dir), /receipt does not match/);
    p.assessment.sourceChecks.at(-1)!.sourceText += 'tampered';
    assert.throws(() => validateIndependentProof(p, raw), /Invalid full-source/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('independent proof and subscriber-style test email stay separate and editor-only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'goodbrief-independent-test-'));
  mkdirSync(join(root, 'data', 'orb-proofs'), { recursive: true });
  mkdirSync(join(root, 'data', 'raw'), { recursive: true });
  writeFileSync(join(root, 'data', 'orb-proofs', `${weekId}.json`), JSON.stringify(proof()));
  writeFileSync(join(root, 'data', 'raw', `${weekId}.json`), JSON.stringify(raw));

  const requests: Array<{ body: { to: string[]; subject: string; html: string }; key: string | undefined }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    requests.push({
      body: JSON.parse(Buffer.concat(chunks).toString()),
      key: request.headers['idempotency-key'] as string | undefined,
    });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: `email-${requests.length}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const env = {
      ...process.env,
      GOODBRIEF_ROOT_DIR: root,
      RESEND_BASE_URL: `http://127.0.0.1:${address.port}`,
      RESEND_API_KEY: 're_test_key',
      AMP_USER_EMAIL: 'owner@example.com',
      TEST_EMAIL: 'editor@example.com',
    };
    const script = join(WORKSPACE_ROOT, 'scripts', 'send-independent-proof.ts');
    await execFileAsync(process.execPath, ['--import', 'tsx', script, '--week', weekId], { env });
    await execFileAsync(process.execPath, ['--import', 'tsx', script, '--week', weekId, '--test-email'], { env });

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].body.to, ['editor@example.com']);
    assert.match(requests[0].body.subject, /^\[PROOF INDEPENDENT\]/);
    assert.match(requests[0].body.html, /Pozitivitate 87\/100/);
    assert.deepEqual(requests[1].body.to, ['owner@example.com']);
    assert.match(requests[1].body.subject, /^\[TEST\]/);
    assert.match(requests[1].body.html, /Veste source-0/);
    assert.doesNotMatch(requests[1].body.html, /Pozitivitate 87\/100/);
    assert.ok(requests[0].key);
    assert.ok(requests[1].key);
    assert.notEqual(requests[0].key, requests[1].key);
    assert.throws(() => readFileSync(join(root, 'data', 'drafts', `${weekId}.json`)), /ENOENT/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('weekly review resumes a frozen pool without replacing its schedule or another worker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'goodbrief-weekly-prepare-'));
  const threadId = 'T-00000000-0000-0000-0000-000000000001';
  const directory = join(root, 'data', 'assessments', weekId);
  const env = { ...process.env, GOODBRIEF_ROOT_DIR: root, GOODBRIEF_REVIEW_NOW: '2026-10-10T09:00:00Z' };
  const cli = (...args: string[]) => execFileAsync(process.execPath,
    ['--import', 'tsx', join(WORKSPACE_ROOT, 'scripts/weekly-review.ts'), 'prepare', ...args], { env });
  mkdirSync(join(root, 'data', 'raw'), { recursive: true });
  const rawPath = join(root, 'data', 'raw', `${weekId}.json`);
  try {
    writeFileSync(rawPath, JSON.stringify({ ...raw, lastUpdated: '2026-10-08T00:00:00Z' }));
    await assert.rejects(cli(threadId), /stale/);
    assert.throws(() => readFileSync(join(directory, 'assessment.json')), /ENOENT/);
    writeFileSync(rawPath, JSON.stringify(raw));
    assert.equal(JSON.parse((await cli(threadId)).stdout).missing, 7);
    const before = readFileSync(join(directory, 'input.json'), 'utf8');
    const worker = JSON.parse(readFileSync(join(root, '.amp', 'assessment-worker.json'), 'utf8'));
    assert.equal(worker.goal, 'editor-review');
    assert.throws(() => readFileSync(join(directory, 'schedule-request.json')), /ENOENT/);
    writeFileSync(rawPath, JSON.stringify({ ...raw, articles: [] }));
    assert.equal(JSON.parse((await cli(threadId)).stdout).proceed, true);
    assert.equal(readFileSync(join(directory, 'input.json'), 'utf8'), before);
    await assert.rejects(cli('T-00000000-0000-0000-0000-000000000002'), /Another worker owns/);
    worker.deadlineAt = '2020-01-01T00:00:00Z';
    writeFileSync(join(root, '.amp', 'assessment-worker.json'), JSON.stringify(worker));
    assert.equal(JSON.parse((await cli(threadId)).stdout).status, 'expired');
    assert.equal(JSON.parse((await cli(threadId)).stdout).proceed, false);
    assert.equal(readFileSync(join(directory, 'input.json'), 'utf8'), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('weekly editor handoff requires manual review, sends once, and never approves or replaces a reviewed draft', async () => {
  const root = mkdtempSync(join(tmpdir(), 'goodbrief-weekly-handoff-'));
  const directory = join(root, 'data', 'assessments', weekId);
  const threadId = 'T-00000000-0000-0000-0000-000000000001';
  const p = proof();
  mkdirSync(directory, { recursive: true });
  for (const [name, value] of [['input', raw], ['assessment', p.assessment], ['proposal', p]] as const) {
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(value));
  }
  const review = { selectionReasoning: 'Synthetic editorial rationale covering the range of fixture stories and the intended audience.',
    alternativesAndCuts: ['Synthetic alternative was considered but offers less reader value than the sourced fixture stories.'],
    sourceLimitations: 'These are synthetic fixtures; no factual source verification is claimed by this integration test.',
    spotChecks: rawArticles.map((_, index) => ({ index, notes: `Synthetic manual review fixture at raw index ${index}; confirms the recorded assessment contract.` })) };
  const requests: Array<{ to: string[]; subject: string }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: `proof-${requests.length}` }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const env = { ...process.env, GOODBRIEF_ROOT_DIR: root, RESEND_BASE_URL: `http://127.0.0.1:${address.port}`,
    RESEND_API_KEY: 're_test_key', TEST_EMAIL: 'editor@example.com', AMP_USER_EMAIL: 'owner@example.com' };
  const weekly = (...args: string[]) => execFileAsync(process.execPath,
    ['--import', 'tsx', join(WORKSPACE_ROOT, 'scripts/weekly-review.ts'), ...args], { env });
  try {
    armAssessment(root, directory, threadId, 90, 'editor-review');
    await assert.rejects(weekly('stage', directory), /editorial-review.json/);
    writeFileSync(join(directory, 'editorial-review.json'), JSON.stringify({ ...review, spotChecks: review.spotChecks.slice(0, 3) }));
    await assert.rejects(weekly('stage', directory), /Manually spot-check/);
    writeFileSync(join(directory, 'editorial-review.json'), JSON.stringify(review));
    await weekly('stage', directory);
    assert.throws(() => readFileSync(join(root, 'data', 'drafts', `${weekId}.json`)), /ENOENT/);
    const preview = JSON.parse(readFileSync(join(directory, 'draft.json'), 'utf8'));
    assert.equal(preview.validation.status, 'failed');
    await assert.rejects(weekly('deliver', directory), /Finish the validated assessment/);
    await execFileAsync(process.execPath, ['--import', 'tsx', join(WORKSPACE_ROOT, 'scripts/assess-news.ts'),
      'finish', directory, join(directory, 'proposal.json')], { env });
    assert.match(wakeAssessment(root, directory, threadId).instructions!, /phase=editor-handoff/);
    assert.equal(requests.length, 0);
    await weekly('deliver', directory);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].to, ['editor@example.com']);
    assert.match(requests[0].subject, /^\[PROOF INDEPENDENT\]/);
    const draftPath = join(root, 'data', 'drafts', `${weekId}.json`);
    const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
    assert.equal(draft.validation.status, 'failed');
    assert.equal(draft.deliveryLock, undefined);
    assert.equal(draft.selected[0].title, p.selected[0].title);
    assert.equal(JSON.parse(readFileSync(join(directory, 'review-ready.json'), 'utf8')).emailId, 'proof-1');
    assert.equal(wakeAssessment(root, directory, threadId).status, 'complete');
    assert.match((await weekly('deliver', directory)).stdout, /not sending again/);
    assert.equal(requests.length, 1);

    const receiptPath = join(directory, 'proof-email.json');
    const receipt = readFileSync(receiptPath, 'utf8');
    writeFileSync(receiptPath, JSON.stringify({ ...JSON.parse(receipt), status: 'sending' }));
    await assert.rejects(weekly('deliver', directory), /uncertain outcome/);
    assert.equal(requests.length, 1);
    writeFileSync(receiptPath, receipt);
    draft.validation = { ...draft.validation, status: 'passed', approvalSource: 'editor-review' };
    const approved = JSON.stringify(draft);
    writeFileSync(draftPath, approved);
    await assert.rejects(weekly('deliver', directory), /Refusing to replace/);
    assert.equal(readFileSync(draftPath, 'utf8'), approved);
    assert.equal(requests.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
