import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runDraftFreshnessValidation } from '../scripts/lib/draft-freshness-runner.js';
import { assertDraftReadyForProduction } from '../scripts/lib/draft-delivery.js';
import type { NewsletterDraft, ProcessedArticle } from '../scripts/types.js';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function makeArticle(index: number): ProcessedArticle {
  return {
    id: `article-${index}`,
    sourceId: 'source',
    sourceName: 'Source',
    originalTitle: `Fresh story ${index}`,
    url: `https://example.com/fresh-${index}`,
    summary: `Fresh story summary ${index}.`,
    positivity: 80,
    impact: 70,
    category: 'wins',
    publishedAt: '2026-06-26T10:00:00.000Z',
    processedAt: '2026-06-27T10:00:00.000Z',
  };
}

function makeDraft(weekId = '2026-W26'): NewsletterDraft {
  return {
    weekId,
    generatedAt: '2026-06-27T10:00:00.000Z',
    selected: Array.from({ length: 10 }, (_, index) => makeArticle(index)),
    reserves: [],
    discarded: 0,
    totalProcessed: 10,
  };
}

test('freshness runner is read-only and cannot turn deterministic success into production approval', async (t) => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-freshness-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const draft = makeDraft();
  const draftPath = join(rootDir, 'data', 'drafts', `${draft.weekId}.json`);
  writeJson(draftPath, draft);
  const before = readFileSync(draftPath, 'utf-8');

  const run = await runDraftFreshnessValidation({
    rootDir,
    args: ['--week', draft.weekId],
    now: new Date('2026-06-27T12:00:00.000Z'),
    logger: () => {},
  });

  assert.equal(run.result.status, 'passed');
  assert.equal(run.result.selectedFreshCount, 10);
  assert.equal(run.draftPath, draftPath);
  assert.equal(readFileSync(draftPath, 'utf-8'), before);
  assert.throws(() => assertDraftReadyForProduction(draft, 'send'), /not validated/);
});

test('freshness runner still checks recent selected draft history without rewriting the current edition', async (t) => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-freshness-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const draft = makeDraft();
  const draftPath = join(rootDir, 'data', 'drafts', `${draft.weekId}.json`);
  const previous = makeDraft('2026-W25');
  previous.selected = [{
    ...makeArticle(100),
    id: 'article-0',
    originalTitle: 'Un subiect din ediția anterioară',
    summary: 'O poveste mai veche.',
  }];
  writeJson(join(rootDir, 'data', 'drafts', `${previous.weekId}.json`), previous);
  writeJson(draftPath, draft);
  const before = readFileSync(draftPath, 'utf-8');

  const { result } = await runDraftFreshnessValidation({ rootDir, args: [], logger: () => {} });
  assert.equal(result.status, 'failed');
  assert.equal(result.recentDraftCount, 1);
  assert.equal(result.blockedArticles[0]?.reason, 'recent-draft-id');
  assert.equal(readFileSync(draftPath, 'utf-8'), before);
});

test('freshness runner resolves only draft week filenames and rejects a missing explicit week', async (t) => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-freshness-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  writeJson(join(rootDir, 'data', 'drafts', '2026-W26.json'), makeDraft());
  writeJson(join(rootDir, 'data', 'drafts', 'notes.json'), {});
  const run = await runDraftFreshnessValidation({ rootDir, args: [], logger: () => {} });
  assert.equal(run.weekId, '2026-W26');
  await assert.rejects(
    runDraftFreshnessValidation({ rootDir, args: ['--week'], logger: () => {} }),
    /Missing value for --week/
  );
});

test('freshness CLI reports its limited scope and leaves an unapproved draft byte-identical', async (t) => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-freshness-cli-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const draftPath = join(rootDir, 'data', 'drafts', '2026-W26.json');
  writeJson(draftPath, makeDraft());
  const before = readFileSync(draftPath, 'utf-8');
  const { stdout } = await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'validate-draft-freshness.ts'),
    ['--week', '2026-W26'],
    { GOODBRIEF_ROOT_DIR: rootDir, RESEND_API_KEY: '', TEST_EMAIL: '' }
  );

  assert.match(stdout, /Deterministic freshness: passed/);
  assert.match(stdout, /Amp must still verify sources and event deadlines/);
  assert.match(stdout, /does not approve delivery/);
  assert.equal(readFileSync(draftPath, 'utf-8'), before);
});

test('freshness CLI exits nonzero for a blocked selected story without replacing it', async (t) => {
  const rootDir = mkdtempSync(join(tmpdir(), 'goodbrief-freshness-cli-'));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const draft = makeDraft();
  draft.selected[0].publishedAt = 'unknown';
  const draftPath = join(rootDir, 'data', 'drafts', '2026-W26.json');
  writeJson(draftPath, draft);
  const before = readFileSync(draftPath, 'utf-8');

  await assert.rejects(runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'validate-draft-freshness.ts'),
    ['--week', '2026-W26'],
    { GOODBRIEF_ROOT_DIR: rootDir, RESEND_API_KEY: '', TEST_EMAIL: '' }
  ), (error: Error & { stdout?: string }) => {
    assert.match(error.stdout ?? '', /Deterministic freshness: failed/);
    return true;
  });
  assert.equal(readFileSync(draftPath, 'utf-8'), before);
});
