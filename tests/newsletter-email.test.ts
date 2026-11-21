import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNewsletterEmail } from '../scripts/lib/newsletter-email.js';
import {
  MAX_SENDABLE_ARTICLE_COUNT,
  TARGET_SELECTED_ARTICLE_COUNT,
} from '../scripts/lib/newsletter-policy.js';
import type { NewsletterDraft, ProcessedArticle } from '../scripts/types.js';

function makeArticle(index: number): ProcessedArticle {
  return {
    id: `article-${index}`,
    sourceId: 'source',
    sourceName: 'Source',
    originalTitle: `Titlu sursă ${index}`,
    title: `Titlu editorial ${index}`,
    url: `https://example.com/article-${index}`,
    summary: `Rezumat ${index}.`,
    positivity: 80,
    impact: 70,
    category: index % 2 === 0 ? 'wins' : 'local-heroes',
    publishedAt: '2099-12-10T10:00:00.000Z',
    processedAt: '2099-12-12T10:00:00.000Z',
  } as ProcessedArticle;
}

function makeDraft(selectedCount: number): NewsletterDraft {
  return {
    weekId: '2099-W50',
    generatedAt: '2099-12-12T10:00:00.000Z',
    selected: Array.from({ length: selectedCount }, (_, i) => makeArticle(i + 1)),
    reserves: [],
    discarded: 0,
    totalProcessed: selectedCount,
    wrapperCopy: {
      greeting: 'Bună dimineața!',
      intro: 'Intro.',
      signOff: 'Pe curând.',
      shortSummary: 'Rezumat.',
    },
  } as NewsletterDraft;
}

test('an editor-extended selection renders every article up to the sendable cap', () => {
  assert.ok(MAX_SENDABLE_ARTICLE_COUNT > TARGET_SELECTED_ARTICLE_COUNT);

  const email = buildNewsletterEmail(makeDraft(MAX_SENDABLE_ARTICLE_COUNT));

  assert.equal(email.articles.length, MAX_SENDABLE_ARTICLE_COUNT);
  assert.match(email.html, new RegExp(`${MAX_SENDABLE_ARTICLE_COUNT} știri, sub 5 minute`));
  assert.match(email.html, /Titlu editorial 11/);
  assert.match(email.html, new RegExp(`Titlu editorial ${MAX_SENDABLE_ARTICLE_COUNT}`));
});

test('an edition can lead with Green Stuff without changing default order or its stories', () => {
  const draft = makeDraft(7);
  draft.selected[1].category = 'green-stuff';
  draft.selected[3].category = 'quick-hits';
  const original = buildNewsletterEmail(draft);
  const reordered = buildNewsletterEmail({ ...draft, firstSection: 'green-stuff' });
  const headings = (html: string) => [...html.matchAll(/<h2\b[^>]*>\s*([^<]+)<\/h2>/g)].map(match => match[1].trim());

  assert.deepEqual(headings(original.html), ['🌱 LOCAL HEROES', '🏆 WINS', '💚 GREEN STUFF', '✨ QUICK HITS']);
  assert.deepEqual(headings(reordered.html), ['💚 GREEN STUFF', '🌱 LOCAL HEROES', '🏆 WINS', '✨ QUICK HITS']);
  assert.deepEqual(reordered.articles, original.articles);
  assert.notEqual(reordered.deliverySha256, original.deliverySha256);
  assert.throws(() => buildNewsletterEmail({ ...draft, firstSection: 'invalid' as never }), /Unsupported first newsletter section/);
});

test('selections beyond the sendable cap are truncated in draft order', () => {
  const email = buildNewsletterEmail(makeDraft(MAX_SENDABLE_ARTICLE_COUNT + 1));

  assert.equal(email.articles.length, MAX_SENDABLE_ARTICLE_COUNT);
  assert.equal(email.articles[0]?.id, 'article-1');
  assert.doesNotMatch(
    email.html,
    new RegExp(`Titlu editorial ${MAX_SENDABLE_ARTICLE_COUNT + 1}\\b`)
  );
});
