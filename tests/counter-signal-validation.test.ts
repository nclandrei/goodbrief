import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HistoricalArticleCandidate } from '../scripts/lib/deduplication.js';
import {
  findCrossWeekDuplicate,
} from '../scripts/lib/deduplication.js';
import {
  COUNTER_SIGNAL_STRONG_PENALTY,
  findRelatedRawArticles,
  validateSameWeekCounterSignals,
} from '../scripts/lib/counter-signal-validation.js';
import type { ProcessedArticle, RawArticle } from '../scripts/types.js';

interface FixtureShape {
  rawArticles: RawArticle[];
  processedCandidates: ProcessedArticle[];
  repeatCandidate: {
    id: string;
    title: string;
    url: string;
  };
  historicalArticles: HistoricalArticleCandidate[];
}

function loadFixture(): FixtureShape {
  const fixturePath = join(
    import.meta.dirname,
    'fixtures',
    'w10-like-counter-signal.json'
  );
  return JSON.parse(readFileSync(fixturePath, 'utf-8')) as FixtureShape;
}

test('same-week prefilter finds the counter-signal but avoids broad-theme false positives', () => {
  const fixture = loadFixture();
  const [faraHartie, , spitale] = fixture.processedCandidates;

  const faraHartieMatches = findRelatedRawArticles(faraHartie, fixture.rawArticles);
  assert.deepEqual(
    faraHartieMatches.map((match) => match.article.id),
    ['fara-hartie-complaint']
  );

  const spitaleMatches = findRelatedRawArticles(spitale, fixture.rawArticles);
  assert.equal(spitaleMatches.length, 0);
});

test('cross-week hard filtering still catches previously covered stories', () => {
  const fixture = loadFixture();
  const duplicate = findCrossWeekDuplicate(
    fixture.repeatCandidate,
    fixture.historicalArticles
  );

  assert.ok(duplicate);
  assert.equal(duplicate?.reason, 'url-match');
});

test('W10-like validation flags Fără hârtie strongly and leaves Educație fizică fără etichete alone', async () => {
  const fixture = loadFixture();

  const validation = await validateSameWeekCounterSignals({
    weekId: '2026-W10',
    candidates: fixture.processedCandidates,
    rawArticles: fixture.rawArticles,
    classifier: async ({ candidate, relatedArticles }) => {
      if (candidate.id === 'fara-hartie') {
        return {
          verdict: 'strong',
          reason:
            'În aceeași săptămână au apărut reclamații și blocaje care fac povestea prea fragilă pentru un newsletter de good news.',
          relatedArticleIds: relatedArticles
            .filter((article) => article.id === 'fara-hartie-complaint')
            .map((article) => article.id),
        };
      }

      return {
        verdict: 'none',
        reason: 'Nu există semnale care să slăbească povestea.',
        relatedArticleIds: [],
      };
    },
    generatedAt: '2026-03-08T10:00:00.000Z',
  });

  assert.equal(validation.flagged.length, 1);
  assert.deepEqual(validation.flagged[0], {
    candidateId: 'fara-hartie',
    verdict: 'strong',
    penaltyApplied: COUNTER_SIGNAL_STRONG_PENALTY,
    reason:
      'În aceeași săptămână au apărut reclamații și blocaje care fac povestea prea fragilă pentru un newsletter de good news.',
    relatedArticleIds: ['fara-hartie-complaint'],
    relatedArticleTitles: [
      'Platforma „Fără hârtie” pentru reducerea birocrației a Guvernului a strâns deja reclamații și sesizări despre erori și blocaje',
    ],
    generatedAt: '2026-03-08T10:00:00.000Z',
  });
});
