import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadHistoricalArticles as loadPipelineHistory } from '../scripts/lib/historical-articles.js';
import {
  loadHistoricalArticles as loadStoryHistory,
  parseIssueMarkdown,
} from '../scripts/lib/story-history.js';
import { ARCHIVE_GATE_FIXTURE, createTempProjectFromFixture } from './helpers.js';

test('parseIssueMarkdown extracts titles, summaries, and links', () => {
  const markdown = readFileSync(
    join(ARCHIVE_GATE_FIXTURE, 'content', 'issues', '2026-03-02-issue.md'),
    'utf-8'
  );

  const items = parseIssueMarkdown(markdown);

  assert.equal(items.length, 2);
  assert.equal(
    items[0].title,
    'Bistrița face mai ușor accesul la servicii pentru persoanele cu autism'
  );
  assert.match(items[0].summary, /35 de instituții/);
  assert.match(items[0].url, /autism/);
});

test('loadHistoricalArticles reads full issue history and recent selected draft stories', () => {
  const tempRoot = createTempProjectFromFixture();

  const history = loadStoryHistory({
    rootDir: tempRoot,
    currentWeekId: '2026-W10',
    draftLookback: 4,
  });

  assert.equal(history.issueArticleCount, 2);
  assert.equal(history.draftArticleCount, 1);
  assert.equal(history.issueFilesLoaded, 1);
  assert.equal(history.draftFilesLoaded, 1);
  assert.equal(
    history.articles.find((article) => article.source === 'draft')?.title,
    'Biblioteci vii pentru liceeni din trei orașe'
  );
  assert.equal(
    history.articles.some((article) => article.title === 'Acest reserve nu ar trebui încărcat în istoric'),
    false
  );
});

test('draft history keeps the source headline when an editorial title exists', () => {
  const tempRoot = createTempProjectFromFixture();
  const draftPath = join(tempRoot, 'data', 'drafts', '2026-W09.json');
  const draft = JSON.parse(readFileSync(draftPath, 'utf-8')) as {
    selected: Array<{ title?: string }>;
  };
  draft.selected[0].title = 'Liceenii redescoperă lectura în trei biblioteci vii';
  writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf-8');

  const history = loadStoryHistory({
    rootDir: tempRoot,
    currentWeekId: '2026-W10',
    draftLookback: 4,
  });
  const draftArticle = history.articles.find((article) => article.source === 'draft');
  const pipelineHistory = loadPipelineHistory(tempRoot, '2026-W10', 0, 4);
  const pipelineDraftArticle = pipelineHistory.articles.find(
    (article) => article.source === 'draft'
  );

  assert.equal(draftArticle?.title, 'Biblioteci vii pentru liceeni din trei orașe');
  assert.notEqual(draftArticle?.title, draft.selected[0].title);
  assert.equal(
    pipelineDraftArticle?.title,
    'Biblioteci vii pentru liceeni din trei orașe'
  );
  assert.notEqual(pipelineDraftArticle?.title, draft.selected[0].title);
});
