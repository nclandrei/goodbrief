import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';

test('newsletter preview renders the editorial title instead of the source headline', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-newsletter-title-'));
  const weekId = '2099-W50';
  mkdirSync(join(tempRoot, 'data', 'drafts'), { recursive: true });
  writeFileSync(
    join(tempRoot, 'data', 'drafts', `${weekId}.json`),
    JSON.stringify({
      weekId,
      generatedAt: '2099-12-12T10:00:00.000Z',
      selected: [
        {
          id: 'article-1',
          sourceId: 'source',
          sourceName: 'Source',
          originalTitle: 'Business CheckIn. Titlul sursă de marketing',
          title: 'La Iași, o familie păstrează rețetele casei',
          url: 'https://example.com/article-1',
          summary: 'Rezumatul știrii.',
          positivity: 80,
          impact: 70,
          category: 'local-heroes',
          publishedAt: '2099-12-10T10:00:00.000Z',
          processedAt: '2099-12-12T10:00:00.000Z'
        }
      ],
      reserves: [],
      discarded: 0,
      totalProcessed: 1,
      wrapperCopy: {
        greeting: 'Bună dimineața!',
        intro: 'Intro.',
        signOff: 'Pe curând.',
        shortSummary: 'Rezumat.'
      }
    }),
    'utf-8'
  );

  const fakeBin = join(tempRoot, 'bin');
  mkdirSync(fakeBin, { recursive: true });
  const fakeOpen = join(fakeBin, 'open');
  writeFileSync(fakeOpen, '#!/bin/sh\nexit 0\n', 'utf-8');
  chmodSync(fakeOpen, 0o755);

  await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'send-newsletter.ts'),
    ['--preview', '--week', weekId],
    {
      GOODBRIEF_ROOT_DIR: tempRoot,
      PATH: `${fakeBin}:${process.env.PATH || ''}`,
    }
  );

  const previewHtml = readFileSync(
    join(tmpdir(), `goodbrief-${weekId}-preview.html`),
    'utf-8'
  );
  assert.match(previewHtml, /La Iași, o familie păstrează rețetele casei/);
  assert.doesNotMatch(previewHtml, /Business CheckIn/);
});
