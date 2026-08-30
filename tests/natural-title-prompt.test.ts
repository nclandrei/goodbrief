import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNaturalTitlesPrompt,
  naturalTitlesResponseSchema,
  NaturalTitlesPartialError,
  normalizeNaturalTitlesResponse,
} from '../scripts/lib/llm/natural-title-prompt.js';
import {
  LlmOutputError,
  LlmProviderError,
} from '../scripts/lib/llm/provider.js';
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
  assert.match(prompt, /balanced closing quote/i);
  assert.match(prompt, /Example summary:.*Iosefina/i);
  assert.match(prompt, /Example summary:.*Munții Apuseni/i);
});

test('natural-title response schema caps titles at 110 characters', () => {
  assert.equal(
    naturalTitlesResponseSchema.properties.titles.items.properties.title
      .maxLength,
    110
  );
});

test('W35 overlong generated title falls back to the valid source title', () => {
  const sourceTitle =
    'Aproape 100 de voluntari salvează o biserică veche din Bistrița-Năsăud. Lăcașul va deveni centru cultural';
  const generatedTitle =
    'Aproape 100 de voluntari salvează o biserică veche din Bistrița-Năsăud pentru a o transforma în centru cultural';
  const article: ProcessedArticle = {
    ...ARTICLE,
    id: '89b3bfd50958d53f',
    originalTitle: sourceTitle,
  };

  assert.equal(sourceTitle.length, 105);
  assert.equal(generatedTitle.length, 111);
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
  try {
    assert.deepEqual(
      normalizeNaturalTitlesResponse('gemini', [article], {
        titles: [{ id: article.id, title: generatedTitle }],
      }),
      [{ id: article.id, title: sourceTitle }]
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /gemini.*89b3bfd50958d53f.*using validated source title.*exceeds 110/
  );
});

test('missing generated title falls back to a source title that passes the hard validator', () => {
  const article = {
    ...ARTICLE,
    originalTitle: 'Comunitatea repară biblioteca veche din centrul orașului',
  };

  assert.deepEqual(
    normalizeNaturalTitlesResponse('gemini', [article], { titles: [] }),
    [{ id: article.id, title: article.originalTitle }]
  );
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

test('natural-title partial errors preserve valid results and fail closed for an unsafe source', () => {
  const validArticle = {
    ...ARTICLE,
    id: 'valid-article',
    originalTitle: 'Titlu sursă sigur pentru primul articol',
  };
  const unsafeArticle = {
    ...ARTICLE,
    id: 'unsafe-article',
    originalTitle: 'FOTO: Un rezultat spectaculos!',
  };

  assert.throws(
    () =>
      normalizeNaturalTitlesResponse(
        'gemini',
        [validArticle, unsafeArticle],
        {
          titles: [
            {
              id: validArticle.id,
              title: 'Primul articol păstrează titlul generat valid',
            },
            { id: unsafeArticle.id, title: 'x'.repeat(111) },
          ],
        }
      ),
    (error: unknown) =>
      error instanceof NaturalTitlesPartialError &&
      error.unresolvedArticleIds.length === 1 &&
      error.unresolvedArticleIds[0] === unsafeArticle.id &&
      error.partialTitles.length === 1 &&
      error.partialTitles[0].id === validArticle.id &&
      /source title fallback rejected/.test(error.message)
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
    '„Titlu firesc”',
  ];

  for (const title of invalidTitles) {
    assert.throws(
      () =>
        normalizeNaturalTitlesResponse('gemini', [ARTICLE], {
          titles: [{ id: ARTICLE.id, title }],
        }),
      (error: unknown) =>
        error instanceof LlmOutputError &&
        /headline quality rule/.test(error.message),
      title
    );
  }
});

test('natural-title validation allows a balanced quoted name at the end', () => {
  const titles = normalizeNaturalTitlesResponse('gemini', [ARTICLE], {
    titles: [
      {
        id: ARTICLE.id,
        title:
          'Peste 165 de muzee participă la „Noaptea Muzeelor la Sate”',
      },
    ],
  });

  assert.equal(
    titles[0].title,
    'Peste 165 de muzee participă la „Noaptea Muzeelor la Sate”'
  );
});

test('natural-title output errors include bounded rejected-title diagnostics', () => {
  assert.throws(
    () =>
      normalizeNaturalTitlesResponse('gemini', [ARTICLE], {
        titles: [{ id: ARTICLE.id, title: 'Titlu firesc?' }],
      }),
    (error: unknown) =>
      error instanceof LlmOutputError &&
      /rejectedTitle="Titlu firesc\?"/.test(error.message) &&
      /U\+003F/.test(error.message)
  );
});

test('natural-title validation normalizes a trailing period from provider output', () => {
  assert.deepEqual(
    normalizeNaturalTitlesResponse('gemini', [ARTICLE], {
      titles: [
        {
          id: ARTICLE.id,
          title: 'Elevii finalizează un proiect pentru comunitate.',
        },
      ],
    }),
    [
      {
        id: ARTICLE.id,
        title: 'Elevii finalizează un proiect pentru comunitate',
      },
    ]
  );
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
