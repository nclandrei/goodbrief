import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNaturalTitlesPrompt,
  normalizeNaturalTitlesResponse,
} from '../scripts/lib/llm/natural-title-prompt.js';
import { LlmProviderError } from '../scripts/lib/llm/provider.js';
import type { ProcessedArticle } from '../scripts/types.js';

const ARTICLE: ProcessedArticle = {
  id: 'article-1',
  sourceId: 'source',
  sourceName: 'Source',
  originalTitle: 'Business CheckIn. Titlul sursă',
  url: 'https://example.com/article-1',
  summary: 'Lucrarea urmează să fie reevaluată după o amânare.',
  positivity: 80,
  impact: 70,
  category: 'wins',
  publishedAt: '2026-08-08T10:00:00.000Z',
  processedAt: '2026-08-08T11:00:00.000Z',
};

test('natural-title prompt encodes the W32 editorial voice and caveat rules', () => {
  const prompt = buildNaturalTitlesPrompt('2026-W32', [ARTICLE]);

  assert.match(prompt, /Business CheckIn/);
  assert.match(prompt, /La Iași, Iosefina și mama ei fac conserve/);
  assert.match(prompt, /Peștera Vântului are 52 de kilometri/);
  assert.match(prompt, /trailere de carte/);
  assert.match(prompt, /delay|postponement/i);
  assert.match(prompt, /completed result/i);
  assert.match(prompt, /scrie istorie/);
  assert.match(prompt, /Add no facts/i);
  assert.match(prompt, /Example summary:.*Iosefina/i);
  assert.match(prompt, /Example summary:.*Munții Apuseni/i);
});

test('natural-title validation rejects outputs longer than 110 characters', () => {
  assert.throws(
    () =>
      normalizeNaturalTitlesResponse('gemini', [ARTICLE], {
        titles: [{ id: ARTICLE.id, title: 'x'.repeat(111) }],
      }),
    (error: unknown) =>
      error instanceof LlmProviderError && /110/.test(error.message)
  );
});

test('natural-title validation requires every requested ID exactly once', () => {
  const secondArticle = { ...ARTICLE, id: 'article-2' };

  assert.throws(
    () =>
      normalizeNaturalTitlesResponse('openrouter', [ARTICLE, secondArticle], {
        titles: [{ id: ARTICLE.id, title: 'Titlu firesc' }],
      }),
    /missing article IDs article-2/
  );
  assert.throws(
    () =>
      normalizeNaturalTitlesResponse('openrouter', [ARTICLE], {
        titles: [
          { id: ARTICLE.id, title: 'Titlu firesc' },
          { id: ARTICLE.id, title: 'Alt titlu' },
        ],
      }),
    /duplicate article ID article-1/
  );
  assert.throws(
    () =>
      normalizeNaturalTitlesResponse('openrouter', [ARTICLE], {
        titles: [{ id: 'unknown', title: 'Titlu firesc' }],
      }),
    /unexpected article ID unknown/
  );
  assert.throws(
    () =>
      normalizeNaturalTitlesResponse(
        'openrouter',
        [ARTICLE, { ...ARTICLE }],
        { titles: [{ id: ARTICLE.id, title: 'Titlu firesc' }] }
      ),
    /duplicate requested article ID article-1/
  );
});

test('natural-title validation rejects deterministic headline anti-patterns', () => {
  const invalidTitles = [
    'FOTO: SPECTACULOS!',
    'Business CheckIn. Titlu firesc pentru cititori',
    'Titlu firesc?',
    '🌟 Titlu firesc pentru cititori',
    'România câștigă 🇷🇴',
    'Titlu 1️⃣ pentru cititori',
    'Elevii lansează un proiect nou — VIDEO',
    'Titlu firesc…',
    'Titlu firesc,',
  ];

  for (const title of invalidTitles) {
    assert.throws(
      () =>
        normalizeNaturalTitlesResponse('gemini', [ARTICLE], {
          titles: [{ id: ARTICLE.id, title }],
        }),
      (error: unknown) =>
        error instanceof LlmProviderError &&
        /headline quality rule/.test(error.message),
      title
    );
  }
});

test('natural-title validation does not confuse factual wording with a cliché', () => {
  const validTitles = [
    'Zimbrul recucerește Munții Făgăraș',
    'Prima operație de succes la Cluj',
    'Editura publică un nou capitol al romanului',
  ];

  for (const title of validTitles) {
    assert.doesNotThrow(() =>
      normalizeNaturalTitlesResponse('gemini', [ARTICLE], {
        titles: [{ id: ARTICLE.id, title }],
      })
    );
  }
});
