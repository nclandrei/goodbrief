import test from 'node:test';
import assert from 'node:assert/strict';
import { getRankingScore } from '../scripts/lib/ranking.js';
import {
  rebalancePreferredSelection,
  selectBalancedShortlist,
} from '../scripts/lib/editorial-balance.js';
import type { DraftValidation, ProcessedArticle } from '../scripts/types.js';

function makeArticle(
  id: string,
  overrides: Partial<ProcessedArticle> = {}
): ProcessedArticle {
  return {
    id,
    sourceId: 'fixture',
    sourceName: 'Fixture',
    originalTitle: `Story ${id}`,
    url: `https://example.ro/${id}`,
    summary: `Summary for ${id}`,
    positivity: 80,
    impact: 80,
    feltImpact: 60,
    certainty: 70,
    humanCloseness: 60,
    bureaucraticDistance: 30,
    promoRisk: 20,
    category: 'wins',
    publishedAt: '2026-03-08T10:00:00.000Z',
    processedAt: '2026-03-08T10:00:00.000Z',
    ...overrides,
  };
}

const EMPTY_VALIDATION: DraftValidation = {
  generatedAt: '2026-03-08T10:00:00.000Z',
  candidateCount: 0,
  flagged: [],
};

test('getRankingScore penalizes speculative bureaucratic stories even when structural impact is high', () => {
  const speculative = makeArticle('speculative', {
    positivity: 84,
    impact: 92,
    feltImpact: 38,
    certainty: 25,
    humanCloseness: 20,
    bureaucraticDistance: 90,
    promoRisk: 74,
    summary: 'Ministerul anunță un apel de finanțare care ar putea aduce fonduri.',
  });
  const tangible = makeArticle('tangible', {
    positivity: 81,
    impact: 74,
    feltImpact: 86,
    certainty: 90,
    humanCloseness: 92,
    bureaucraticDistance: 10,
    promoRisk: 6,
    category: 'local-heroes',
    summary: 'Voluntarii au deschis deja biblioteca mobilă în trei sate.',
  });

  assert.ok(getRankingScore(tangible) > getRankingScore(speculative));
});

test('getRankingScore prefers distinctive stories over routine high-positivity results', () => {
  const routineResult = makeArticle('routine-result', {
    positivity: 95,
    impact: 85,
    editorialInterest: 35,
    feltImpact: 75,
    certainty: 90,
    humanCloseness: 60,
    bureaucraticDistance: 10,
    promoRisk: 5,
  });
  const distinctiveStory = makeArticle('distinctive-story', {
    positivity: 82,
    impact: 75,
    editorialInterest: 90,
    feltImpact: 78,
    certainty: 90,
    humanCloseness: 75,
    bureaucraticDistance: 10,
    promoRisk: 5,
  });

  assert.ok(getRankingScore(distinctiveStory) > getRankingScore(routineResult));
});

test('selectBalancedShortlist caps niche institutional sources and preserves community stories when viable', () => {
  const rankedArticles = [
    makeArticle('startup-grants', {
      sourceId: 'startupcafe',
      sourceName: 'StartupCafe',
      positivity: 90,
      impact: 86,
      feltImpact: 55,
      certainty: 48,
      humanCloseness: 35,
      bureaucraticDistance: 76,
      promoRisk: 88,
    }),
    makeArticle('hospital-funds', {
      sourceId: 'economedia',
      sourceName: 'Economedia',
      positivity: 84,
      impact: 92,
      feltImpact: 40,
      certainty: 30,
      humanCloseness: 18,
      bureaucraticDistance: 90,
      promoRisk: 66,
    }),
    makeArticle('school-pilot', {
      sourceId: 'edupedu',
      sourceName: 'Edupedu',
      positivity: 88,
      impact: 88,
      feltImpact: 47,
      certainty: 45,
      humanCloseness: 25,
      bureaucraticDistance: 80,
      promoRisk: 58,
    }),
    makeArticle('mobile-library', {
      sourceId: 'dw-romania',
      sourceName: 'DW România',
      category: 'local-heroes',
      feltImpact: 89,
      certainty: 91,
      humanCloseness: 95,
      bureaucraticDistance: 8,
      promoRisk: 5,
    }),
    makeArticle('solar-village', {
      sourceId: 'biziday',
      sourceName: 'Biziday',
      category: 'green-stuff',
      positivity: 79,
      impact: 73,
      feltImpact: 84,
      certainty: 86,
      humanCloseness: 72,
      bureaucraticDistance: 14,
      promoRisk: 6,
    }),
    makeArticle('rail-started', {
      sourceId: 'agerpres',
      sourceName: 'Agerpres',
      positivity: 78,
      impact: 84,
      feltImpact: 62,
      certainty: 82,
      humanCloseness: 34,
      bureaucraticDistance: 34,
      promoRisk: 14,
    }),
  ];

  const shortlist = selectBalancedShortlist({
    rankedArticles,
    validation: EMPTY_VALIDATION,
    selectedCount: 4,
    reserveCount: 2,
  });

  assert.equal(
    shortlist.selected.some((article) => article.id === 'mobile-library'),
    true
  );
  assert.equal(
    shortlist.selected.some((article) => article.id === 'solar-village'),
    true
  );
  assert.ok(
    shortlist.selected.filter((article) =>
      ['startupcafe', 'economedia', 'edupedu', 'startup-ro'].includes(article.sourceId)
    ).length <= 3
  );
});

test('selectBalancedShortlist excludes low-interest stories from both selected and reserves', () => {
  const rankedArticles = [
    makeArticle('strong-community', {
      category: 'local-heroes',
      editorialInterest: 88,
      feltImpact: 90,
      certainty: 92,
      humanCloseness: 95,
    }),
    makeArticle('routine-green-ranking', {
      category: 'green-stuff',
      editorialInterest: 35,
      positivity: 96,
      impact: 90,
      feltImpact: 88,
      certainty: 94,
    }),
    makeArticle('strong-win-1', { editorialInterest: 82 }),
    makeArticle('strong-win-2', { editorialInterest: 78 }),
    makeArticle('strong-win-3', { editorialInterest: 74 }),
  ];

  const shortlist = selectBalancedShortlist({
    rankedArticles,
    validation: EMPTY_VALIDATION,
    selectedCount: 3,
    reserveCount: 2,
  });

  assert.equal(
    [...shortlist.selected, ...shortlist.reserves].some(
      (article) => article.id === 'routine-green-ranking'
    ),
    false
  );
  assert.equal(shortlist.selected.length, 3);
  assert.equal(shortlist.reserves.length, 1);
});

test('selectBalancedShortlist skips a category when its best story trails the edition quality', () => {
  const strongSignals: Partial<ProcessedArticle> = {
    positivity: 85,
    impact: 80,
    editorialInterest: 75,
    feltImpact: 75,
    certainty: 80,
    humanCloseness: 70,
    bureaucraticDistance: 20,
    promoRisk: 10,
  };
  const rankedArticles = [
    makeArticle('community-1', { ...strongSignals, category: 'local-heroes' }),
    makeArticle('community-2', { ...strongSignals, category: 'local-heroes' }),
    makeArticle('strong-win-1', strongSignals),
    makeArticle('strong-win-2', strongSignals),
    makeArticle('lagging-green', {
      category: 'green-stuff',
      positivity: 78,
      impact: 70,
      editorialInterest: 60,
      feltImpact: 65,
      certainty: 75,
      humanCloseness: 55,
      bureaucraticDistance: 45,
      promoRisk: 25,
    }),
  ];

  const shortlist = selectBalancedShortlist({
    rankedArticles,
    validation: EMPTY_VALIDATION,
    selectedCount: 4,
    reserveCount: 1,
  });

  assert.equal(
    shortlist.selected.some((article) => article.id === 'lagging-green'),
    false
  );
  assert.equal(shortlist.selected.length, 4);
  assert.equal(shortlist.reserves[0]?.id, 'lagging-green');
});

test('selectBalancedShortlist does not cap broad outlets when they carry the strongest concrete stories', () => {
  const rankedArticles = [
    makeArticle('protv-local', {
      sourceId: 'stirileprotv',
      sourceName: 'Știrile ProTV',
      category: 'local-heroes',
      positivity: 87,
      impact: 74,
      feltImpact: 90,
      certainty: 94,
      humanCloseness: 95,
      bureaucraticDistance: 8,
      promoRisk: 5,
    }),
    makeArticle('protv-green', {
      sourceId: 'stirileprotv',
      sourceName: 'Știrile ProTV',
      category: 'green-stuff',
      positivity: 84,
      impact: 78,
      feltImpact: 86,
      certainty: 90,
      humanCloseness: 80,
      bureaucraticDistance: 14,
      promoRisk: 8,
    }),
    makeArticle('protv-win', {
      sourceId: 'stirileprotv',
      sourceName: 'Știrile ProTV',
      positivity: 83,
      impact: 80,
      feltImpact: 74,
      certainty: 88,
      humanCloseness: 70,
      bureaucraticDistance: 18,
      promoRisk: 10,
    }),
    makeArticle('agerpres-win', {
      sourceId: 'agerpres',
      sourceName: 'Agerpres',
      positivity: 81,
      impact: 79,
      feltImpact: 70,
      certainty: 84,
      humanCloseness: 58,
      bureaucraticDistance: 22,
      promoRisk: 10,
    }),
    makeArticle('mediafax-quick', {
      sourceId: 'mediafax',
      sourceName: 'Mediafax',
      category: 'quick-hits',
      positivity: 80,
      impact: 68,
      feltImpact: 64,
      certainty: 96,
      humanCloseness: 46,
      bureaucraticDistance: 12,
      promoRisk: 4,
    }),
  ];

  const shortlist = selectBalancedShortlist({
    rankedArticles,
    validation: EMPTY_VALIDATION,
    selectedCount: 4,
    reserveCount: 1,
  });

  assert.equal(
    shortlist.selected.filter((article) => article.sourceId === 'stirileprotv').length,
    3
  );
});

test('rebalancePreferredSelection keeps community and green stories when refine prefers bureaucratic reserves', () => {
  const allArticles = [
    makeArticle('mobile-library', {
      sourceId: 'dw-romania',
      sourceName: 'DW România',
      category: 'local-heroes',
      positivity: 84,
      impact: 72,
      feltImpact: 90,
      certainty: 95,
      humanCloseness: 96,
      bureaucraticDistance: 8,
      promoRisk: 5,
    }),
    makeArticle('solar-village', {
      sourceId: 'stirileprotv',
      sourceName: 'Știrile ProTV',
      category: 'green-stuff',
      positivity: 82,
      impact: 76,
      feltImpact: 86,
      certainty: 90,
      humanCloseness: 74,
      bureaucraticDistance: 12,
      promoRisk: 6,
    }),
    makeArticle('oncogen', {
      sourceId: 'agerpres',
      sourceName: 'Agerpres',
      positivity: 92,
      impact: 94,
      feltImpact: 86,
      certainty: 88,
      humanCloseness: 90,
      bureaucraticDistance: 14,
      promoRisk: 8,
    }),
    makeArticle('rail-started', {
      sourceId: 'economedia',
      sourceName: 'Economedia',
      positivity: 78,
      impact: 84,
      feltImpact: 64,
      certainty: 82,
      humanCloseness: 34,
      bureaucraticDistance: 36,
      promoRisk: 18,
    }),
    makeArticle('startup-grants', {
      sourceId: 'startupcafe',
      sourceName: 'StartupCafe',
      positivity: 89,
      impact: 83,
      feltImpact: 58,
      certainty: 46,
      humanCloseness: 38,
      bureaucraticDistance: 76,
      promoRisk: 88,
    }),
    makeArticle('school-pilot', {
      sourceId: 'edupedu',
      sourceName: 'Edupedu',
      positivity: 88,
      impact: 88,
      feltImpact: 47,
      certainty: 45,
      humanCloseness: 25,
      bureaucraticDistance: 80,
      promoRisk: 58,
    }),
  ];

  const rebalanced = rebalancePreferredSelection({
    preferredArticles: [
      allArticles[4],
      allArticles[5],
      allArticles[2],
      allArticles[3],
    ],
    allArticles,
    validation: EMPTY_VALIDATION,
  });

  assert.equal(
    rebalanced.selected.some((article) => article.id === 'mobile-library'),
    true
  );
  assert.equal(
    rebalanced.selected.some((article) => article.id === 'solar-village'),
    true
  );
  assert.ok(
    rebalanced.selected.filter((article) => article.bureaucraticDistance! >= 70).length <= 2
  );
});
