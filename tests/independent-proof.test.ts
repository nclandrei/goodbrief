import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  return {
    weekId,
    generatedAt: '2026-10-10T09:00:00Z',
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
