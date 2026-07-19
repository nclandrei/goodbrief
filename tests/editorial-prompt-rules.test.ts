import test from 'node:test';
import assert from 'node:assert/strict';
import { getArticleScoreSchema, getScoringPrompt } from '../scripts/lib/gemini.js';
import { buildRefinePrompt } from '../scripts/lib/llm/refine-prompt.js';
import type { DraftValidation, ProcessedArticle } from '../scripts/types.js';

function makeArticle(id: string, overrides: Partial<ProcessedArticle> = {}): ProcessedArticle {
  return {
    id,
    sourceId: 'fixture',
    sourceName: 'Fixture',
    originalTitle: `Story ${id}`,
    url: `https://example.ro/${id}`,
    summary: `Summary for ${id}`,
    positivity: 80,
    impact: 70,
    feltImpact: 75,
    certainty: 85,
    humanCloseness: 80,
    bureaucraticDistance: 20,
    promoRisk: 10,
    category: 'local-heroes',
    publishedAt: '2026-06-28T10:00:00.000Z',
    processedAt: '2026-06-28T11:00:00.000Z',
    ...overrides,
  };
}

const EMPTY_VALIDATION: DraftValidation = {
  generatedAt: '2026-06-28T11:00:00.000Z',
  candidateCount: 1,
  flagged: [],
};

test('scoring prompt states hard editorial exclusions before articles are scored', () => {
  const prompt = getScoringPrompt('ID: a\nTitle: T\nContent: S', false);

  assert.match(prompt, /happy ending/i);
  assert.match(prompt, /FOTO|VIDEO/);
  assert.match(prompt, /Nostalgia|Untold/);
  assert.match(prompt, /commercial festivals/i);
  assert.match(prompt, /Bacalaureat.*(?:grade|average|appeal)/i);
});

test('scoring contract requires an explicit editorial-interest judgment', () => {
  const prompt = getScoringPrompt('ID: a\nTitle: T\nContent: S', false);
  const schema = getArticleScoreSchema(false);

  assert.match(prompt, /EDITORIAL INTEREST SCORE/i);
  assert.match(prompt, /tell a friend|share with a friend/i);
  assert.match(prompt, /routine.*(?:award|ranking|result)/i);
  assert.ok(schema.items.required.includes('editorialInterest'));
  assert.deepEqual(schema.items.properties.editorialInterest?.type, 'integer');
});

test('refine prompt tells reviewer to reject hard exclusions and editorial title prefixes', () => {
  const prompt = buildRefinePrompt({
    weekId: '2026-W26',
    selected: [makeArticle('a')],
    reserves: [makeArticle('b')],
    wrapperCopy: {
      greeting: 'Salut',
      intro: 'Intro',
      signOff: 'Pe luni',
      shortSummary: 'Summary',
    },
    validation: EMPTY_VALIDATION,
    previousArticles: [],
    lookbackLabel: 'fixture',
  });

  assert.match(prompt, /happy ending/i);
  assert.match(prompt, /FOTO|VIDEO/);
  assert.match(prompt, /Nostalgia|Untold/);
  assert.match(prompt, /commercial festivals/i);
  assert.match(prompt, /Bacalaureat.*(?:grade|average|appeal)/i);
});
