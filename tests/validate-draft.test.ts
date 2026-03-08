import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  DraftPipelineArtifact,
  NewsletterDraft,
  PreparedPipelineData,
  WeeklyBuffer,
} from '../scripts/types.js';

const execFileAsync = promisify(execFile);

function loadFixture() {
  const fixturePath = join(
    import.meta.dirname,
    'fixtures',
    'w10-like-counter-signal.json'
  );
  return JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
    rawArticles: WeeklyBuffer['articles'];
    processedCandidates: NewsletterDraft['selected'];
  };
}

test('validate-draft rewrites only the validation block', async () => {
  const fixture = loadFixture();
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-validate-draft-'));
  mkdirSync(join(tempRoot, 'data', 'drafts'), { recursive: true });
  mkdirSync(join(tempRoot, 'data', 'raw'), { recursive: true });
  mkdirSync(join(tempRoot, 'data', 'pipeline', '2026-W10'), { recursive: true });

  const draft: NewsletterDraft = {
    weekId: '2026-W10',
    generatedAt: '2026-03-07T10:48:02.731Z',
    selected: fixture.processedCandidates.slice(0, 2),
    reserves: fixture.processedCandidates.slice(2),
    discarded: 5,
    totalProcessed: 12,
    wrapperCopy: {
      greeting: 'Salut!',
      intro: 'Un intro care trebuie păstrat.',
      signOff: 'Pe curând!',
      shortSummary: 'Rezumat scurt',
    },
    validation: {
      generatedAt: '2026-03-07T10:48:02.731Z',
      candidateCount: 3,
      flagged: [],
    },
  };

  const rawBuffer: WeeklyBuffer = {
    weekId: '2026-W10',
    articles: fixture.rawArticles,
    lastUpdated: '2026-03-08T10:00:00.000Z',
  };

  const draftPath = join(tempRoot, 'data', 'drafts', '2026-W10.json');
  const rawPath = join(tempRoot, 'data', 'raw', '2026-W10.json');
  const prepareArtifactPath = join(
    tempRoot,
    'data',
    'pipeline',
    '2026-W10',
    '01-prepared.json'
  );
  const mockPath = join(tempRoot, 'counter-signal-mock.json');

  writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf-8');
  writeFileSync(rawPath, JSON.stringify(rawBuffer, null, 2), 'utf-8');
  const prepareArtifact: DraftPipelineArtifact<PreparedPipelineData, 'prepare'> = {
    weekId: '2026-W10',
    phase: 'prepare',
    generatedAt: '2026-03-08T10:00:00.000Z',
    inputFile: rawPath,
    data: {
      sameWeekRepresentatives: fixture.rawArticles,
      preparedArticles: fixture.rawArticles,
      deduplication: {
        inputCount: fixture.rawArticles.length,
        outputCount: fixture.rawArticles.length,
        clusters: [],
      },
      historicalFilter: {
        inputCount: fixture.rawArticles.length,
        outputCount: fixture.rawArticles.length,
        filteredOut: 0,
        historicalCount: 0,
      },
    },
  };
  writeFileSync(prepareArtifactPath, JSON.stringify(prepareArtifact, null, 2), 'utf-8');
  writeFileSync(
    mockPath,
    JSON.stringify(
      {
        'fara-hartie': {
          verdict: 'strong',
          reason: 'Există reclamații în aceeași săptămână care slăbesc povestea.',
          relatedArticleIds: ['fara-hartie-complaint'],
        },
      },
      null,
      2
    ),
    'utf-8'
  );

  await execFileAsync(process.execPath, [
    '--import',
    'tsx',
    join(process.cwd(), 'scripts', 'validate-draft.ts'),
    '--week',
    '2026-W10',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GEMINI_API_KEY: 'test-key',
      GOODBRIEF_ROOT_DIR: tempRoot,
      GOODBRIEF_COUNTER_SIGNAL_MOCK_FILE: mockPath,
    },
  });

  const updated = JSON.parse(readFileSync(draftPath, 'utf-8')) as NewsletterDraft;

  assert.deepEqual(
    {
      ...updated,
      validation: undefined,
    },
    {
      ...draft,
      validation: undefined,
    }
  );

  assert.equal(updated.validation?.candidateCount, 3);
  assert.equal(updated.validation?.flagged.length, 1);
  assert.deepEqual(updated.validation?.flagged[0].relatedArticleIds, [
    'fara-hartie-complaint',
  ]);
  assert.equal(
    existsSync(join(tempRoot, 'data', 'pipeline', '2026-W10', '04-counter-signals.json')),
    true
  );
});
