import test from 'node:test';
import assert from 'node:assert/strict';
import type { RawArticle, WeeklyBuffer } from '../scripts/types.js';
import {
  materializeIndependentDraft,
  renderIndependentProof,
  validateIndependentProof,
  type IndependentProof,
} from '../scripts/send-independent-proof.js';

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
