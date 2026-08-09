import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatValidationNotesForConsole,
  renderValidationNotesHtml,
} from '../scripts/lib/validation-notes.js';
import type { NewsletterDraft } from '../scripts/types.js';

const DRAFT: NewsletterDraft = {
  weekId: '2026-W32',
  generatedAt: '2026-08-08T12:00:00.000Z',
  selected: [
    {
      id: 'article-1',
      sourceId: 'source',
      sourceName: 'Source',
      originalTitle: 'Business CheckIn. Titlul sursă',
      title: 'La Iași, o familie păstrează rețetele casei',
      url: 'https://example.com/article-1',
      summary: 'Rezumat',
      positivity: 80,
      impact: 70,
      category: 'local-heroes',
      publishedAt: '2026-08-08T10:00:00.000Z',
      processedAt: '2026-08-08T11:00:00.000Z',
    },
  ],
  reserves: [],
  discarded: 0,
  totalProcessed: 1,
  validation: {
    generatedAt: '2026-08-08T12:00:00.000Z',
    candidateCount: 1,
    flagged: [
      {
        candidateId: 'article-1',
        verdict: 'borderline',
        penaltyApplied: 10,
        reason: 'Necesită o verificare editorială.',
        relatedArticleIds: [],
        relatedArticleTitles: [],
        generatedAt: '2026-08-08T12:00:00.000Z',
      },
    ],
  },
};

test('validation notes identify flagged stories by their editorial title', () => {
  const consoleNotes = formatValidationNotesForConsole(DRAFT);
  const htmlNotes = renderValidationNotesHtml(DRAFT);

  assert.match(consoleNotes || '', /La Iași, o familie păstrează rețetele casei/);
  assert.match(htmlNotes, /La Iași, o familie păstrează rețetele casei/);
  assert.doesNotMatch(consoleNotes || '', /Business CheckIn/);
  assert.doesNotMatch(htmlNotes, /Business CheckIn/);
});
