import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ArticleCategory,
  DraftPipelineArtifact,
  ProcessedArticle,
  RawArticle,
  SemanticDedupPipelineData,
  CounterSignalPipelineData,
} from '../scripts/types.js';
import {
  PIPELINE_ARTIFACT_FILENAMES,
} from '../scripts/lib/pipeline-artifacts.js';
import {
  SATURDAY_PIPELINE_SCRIPTS,
  VERIFY_LOCAL_SCRIPTS,
} from '../scripts/lib/pipeline-commands.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();
const WEEK_ID = '2026-W10';

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

function stripVolatileTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVolatileTimestamps);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        if (key === 'generatedAt' || key === 'processedAt') {
          return [key, '<normalized>'];
        }
        return [key, stripVolatileTimestamps(entryValue)];
      })
    );
  }

  return value;
}

async function runTsxScript(
  scriptPath: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  await execFileAsync(
    process.execPath,
    ['--import', 'tsx', scriptPath, ...args],
    {
      cwd: REPO_ROOT,
      env,
    }
  );
}

async function runPhase(
  rootDir: string,
  phase: string,
  env: NodeJS.ProcessEnv = {}
): Promise<void> {
  await runTsxScript(
    join(REPO_ROOT, 'scripts', 'run-draft-phase.ts'),
    ['--phase', phase, '--week', WEEK_ID],
    {
      ...process.env,
      GOODBRIEF_ROOT_DIR: rootDir,
      GEMINI_API_KEY: 'test-key',
      ...env,
    }
  );
}

function makeProcessedArticle(
  id: string,
  positivity: number,
  impact: number,
  category: ArticleCategory = 'wins'
): ProcessedArticle {
  return {
    id,
    sourceId: 'fixture',
    sourceName: 'Fixture',
    originalTitle: `Story ${id}`,
    url: `https://example.ro/${id}`,
    summary: `Summary for ${id}`,
    positivity,
    impact,
    category,
    publishedAt: '2026-03-08T10:00:00.000Z',
    processedAt: '2026-03-08T10:00:00.000Z',
  };
}

function makeDetailedProcessedArticle(
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

function setupPipelineRoot(rootDir: string): {
  rawArticles: RawArticle[];
  env: NodeJS.ProcessEnv;
} {
  mkdirSync(join(rootDir, 'data', 'raw'), { recursive: true });
  mkdirSync(join(rootDir, 'data', 'drafts'), { recursive: true });

  const rawArticles: RawArticle[] = [
    {
      id: 'alpha',
      sourceId: 'fixture',
      sourceName: 'Fixture',
      title: 'Program pilot pentru grădini urbane la Cluj',
      url: 'https://example.ro/alpha',
      summary: 'Alpha summary',
      publishedAt: '2026-03-01T10:00:00.000Z',
      fetchedAt: '2026-03-01T10:05:00.000Z',
    },
    {
      id: 'beta',
      sourceId: 'fixture',
      sourceName: 'Fixture',
      title: 'Biblioteci mobile ajung în sate din Moldova',
      url: 'https://example.ro/beta',
      summary: 'Beta summary',
      publishedAt: '2026-03-01T11:00:00.000Z',
      fetchedAt: '2026-03-01T11:05:00.000Z',
    },
    {
      id: 'gamma',
      sourceId: 'fixture',
      sourceName: 'Fixture',
      title: 'Elevi din Brașov lansează un laborator de robotică',
      url: 'https://example.ro/gamma',
      summary: 'Gamma summary',
      publishedAt: '2026-03-01T12:00:00.000Z',
      fetchedAt: '2026-03-01T12:05:00.000Z',
    },
    {
      id: 'delta',
      sourceId: 'fixture',
      sourceName: 'Fixture',
      title: 'Un spital din Timișoara deschide un centru nou de recuperare',
      url: 'https://example.ro/delta',
      summary: 'Delta summary',
      publishedAt: '2026-03-01T13:00:00.000Z',
      fetchedAt: '2026-03-01T13:05:00.000Z',
    },
    {
      id: 'epsilon',
      sourceId: 'fixture',
      sourceName: 'Fixture',
      title: 'O pădure degradată este refăcută printr-un proiect local',
      url: 'https://example.ro/epsilon',
      summary: 'Epsilon summary',
      publishedAt: '2026-03-01T14:00:00.000Z',
      fetchedAt: '2026-03-01T14:05:00.000Z',
    },
  ];

  writeJson(join(rootDir, 'data', 'raw', `${WEEK_ID}.json`), {
    weekId: WEEK_ID,
    articles: rawArticles,
    lastUpdated: '2026-03-08T10:00:00.000Z',
  });

  const scoreMockPath = join(rootDir, 'score-mock.json');
  writeJson(scoreMockPath, [
    {
      id: 'alpha',
      summary: 'Alpha summary scored',
      positivity: 90,
      impact: 80,
      romaniaRelevant: true,
      category: 'wins',
    },
    {
      id: 'beta',
      summary: 'Beta summary scored',
      positivity: 88,
      impact: 78,
      romaniaRelevant: true,
      category: 'wins',
    },
    {
      id: 'gamma',
      summary: 'Gamma summary scored',
      positivity: 86,
      impact: 76,
      romaniaRelevant: true,
      category: 'local-heroes',
    },
    {
      id: 'delta',
      summary: 'Delta summary scored',
      positivity: 84,
      impact: 74,
      romaniaRelevant: true,
      category: 'wins',
    },
    {
      id: 'epsilon',
      summary: 'Epsilon summary scored',
      positivity: 82,
      impact: 72,
      romaniaRelevant: true,
      category: 'quick-hits',
    },
  ]);

  const semanticMockPath = join(rootDir, 'semantic-mock.json');
  writeJson(semanticMockPath, {
    removedIds: [],
    clusters: [],
  });

  const counterSignalMockPath = join(rootDir, 'counter-signal-mock.json');
  writeJson(counterSignalMockPath, {
    beta: {
      verdict: 'borderline',
      reason: 'Există un semnal mixt pentru beta.',
      relatedArticleIds: [],
    },
  });

  const wrapperCopyMockPath = join(rootDir, 'wrapper-copy-mock.json');
  writeJson(wrapperCopyMockPath, {
    greeting: 'Salut!',
    intro: 'Intro mock.',
    signOff: 'Pe curând!',
    shortSummary: 'Rezumat mock.',
  });

  const refinementMockPath = join(rootDir, 'refinement-mock.json');
  writeJson(refinementMockPath, {
    selectedIds: ['alpha', 'gamma', 'delta'],
    intro: 'Intro rafinat.',
    shortSummary: 'Rezumat rafinat.',
    reasoning: 'Mock refinement',
  });

  return {
    rawArticles,
    env: {
      GOODBRIEF_SCORE_MOCK_FILE: scoreMockPath,
      GOODBRIEF_SEMANTIC_DEDUP_MOCK_FILE: semanticMockPath,
      GOODBRIEF_COUNTER_SIGNAL_MOCK_FILE: counterSignalMockPath,
      GOODBRIEF_WRAPPER_COPY_MOCK_FILE: wrapperCopyMockPath,
      GOODBRIEF_REFINEMENT_MOCK_FILE: refinementMockPath,
    },
  };
}

test('each phase fails clearly when its required input is missing', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-phase-missing-'));

  const expectations: Array<[string, RegExp]> = [
    ['prepare', /No raw data found|Git LFS pointer/],
    ['score', /Required pipeline artifact not found.*prepare/],
    ['semantic-dedup', /Required pipeline artifact not found.*score/],
    ['counter-signal-validate', /Required pipeline artifact not found.*prepare/],
    ['select', /Required pipeline artifact not found.*semantic-dedup/],
    ['wrapper-copy', /Required pipeline artifact not found.*select/],
    ['refine', /Required pipeline artifact not found.*select/],
  ];

  for (const [phase, pattern] of expectations) {
    await assert.rejects(
      runPhase(tempRoot, phase),
      (error: unknown) => {
        const value = error as { stderr?: string; stdout?: string; message?: string };
        const output = `${value.stderr || ''}\n${value.stdout || ''}\n${value.message || ''}`;
        assert.match(output, pattern);
        return true;
      }
    );
  }
});

test('select phase overwrites only its own artifact and leaves upstream artifacts unchanged', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-select-phase-'));
  const pipelineDir = join(tempRoot, 'data', 'pipeline', WEEK_ID);
  mkdirSync(pipelineDir, { recursive: true });

  const semanticArtifact: DraftPipelineArtifact<SemanticDedupPipelineData, 'semantic-dedup'> = {
    weekId: WEEK_ID,
    phase: 'semantic-dedup',
    generatedAt: '2026-03-08T10:00:00.000Z',
    inputFile: '02-scored.json',
    data: {
      articles: [
        makeProcessedArticle('alpha', 90, 80),
        makeProcessedArticle('beta', 88, 78),
        makeProcessedArticle('gamma', 70, 70),
      ],
      totalProcessed: 3,
      discarded: 0,
      removed: [],
      clusters: [],
    },
  };

  const counterSignalArtifact: DraftPipelineArtifact<
    CounterSignalPipelineData,
    'counter-signal-validate'
  > = {
    weekId: WEEK_ID,
    phase: 'counter-signal-validate',
    generatedAt: '2026-03-08T10:00:00.000Z',
    inputFile: '03-semantic-dedup.json + 01-prepared.json',
    data: {
      validation: {
        generatedAt: '2026-03-08T10:00:00.000Z',
        candidateCount: 3,
        flagged: [
          {
            candidateId: 'beta',
            verdict: 'strong',
            penaltyApplied: 30,
            reason: 'Beta are un contra-semnal puternic.',
            relatedArticleIds: ['beta-issue'],
            relatedArticleTitles: ['Beta issue'],
            generatedAt: '2026-03-08T10:00:00.000Z',
          },
        ],
      },
    },
  };

  const semanticPath = join(pipelineDir, PIPELINE_ARTIFACT_FILENAMES['semantic-dedup']);
  const counterSignalPath = join(
    pipelineDir,
    PIPELINE_ARTIFACT_FILENAMES['counter-signal-validate']
  );
  writeJson(semanticPath, semanticArtifact);
  writeJson(counterSignalPath, counterSignalArtifact);

  const beforeSemantic = readFileSync(semanticPath, 'utf-8');
  const beforeCounterSignals = readFileSync(counterSignalPath, 'utf-8');

  await runPhase(tempRoot, 'select');

  assert.equal(readFileSync(semanticPath, 'utf-8'), beforeSemantic);
  assert.equal(readFileSync(counterSignalPath, 'utf-8'), beforeCounterSignals);

  const shortlistPath = join(pipelineDir, PIPELINE_ARTIFACT_FILENAMES.select);
  assert.equal(existsSync(shortlistPath), true);

  const shortlist = JSON.parse(readFileSync(shortlistPath, 'utf-8')) as DraftPipelineArtifact<
    any,
    'select'
  >;
  assert.deepEqual(
    shortlist.data.selected.map((article: ProcessedArticle) => article.id),
    ['alpha', 'gamma', 'beta']
  );
});

test('select phase favors tangible human-centered stories over speculative bureaucratic wins', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-select-editorial-balance-'));
  const pipelineDir = join(tempRoot, 'data', 'pipeline', WEEK_ID);
  mkdirSync(pipelineDir, { recursive: true });

  const article = (
    id: string,
    positivity: number,
    impact: number,
    category: ArticleCategory,
    sourceId: string,
    sourceName: string,
    extras: Record<string, number>
  ): ProcessedArticle =>
    ({
      id,
      sourceId,
      sourceName,
      originalTitle: `Story ${id}`,
      url: `https://example.ro/${id}`,
      summary: `Summary for ${id}`,
      positivity,
      impact,
      category,
      publishedAt: '2026-03-08T10:00:00.000Z',
      processedAt: '2026-03-08T10:00:00.000Z',
      ...extras,
    }) as ProcessedArticle;

  const semanticArtifact: DraftPipelineArtifact<SemanticDedupPipelineData, 'semantic-dedup'> = {
    weekId: WEEK_ID,
    phase: 'semantic-dedup',
    generatedAt: '2026-03-08T10:00:00.000Z',
    inputFile: '02-scored.json',
    data: {
      articles: [
        article(
          'hospital-funds-potential',
          84,
          92,
          'wins',
          'economedia',
          'Economedia',
          {
            feltImpact: 42,
            certainty: 28,
            humanCloseness: 18,
            bureaucraticDistance: 92,
            promoRisk: 65,
          }
        ),
        article(
          'women-startup-grants',
          89,
          83,
          'wins',
          'startupcafe',
          'StartupCafe',
          {
            feltImpact: 58,
            certainty: 46,
            humanCloseness: 38,
            bureaucraticDistance: 76,
            promoRisk: 88,
          }
        ),
        article(
          'green-school-roofs',
          81,
          74,
          'green-stuff',
          'stirileprotv',
          'Știrile ProTV',
          {
            feltImpact: 84,
            certainty: 87,
            humanCloseness: 74,
            bureaucraticDistance: 14,
            promoRisk: 8,
          }
        ),
        article(
          'mobile-library-volunteers',
          83,
          72,
          'local-heroes',
          'dw-romania',
          'DW România',
          {
            feltImpact: 88,
            certainty: 92,
            humanCloseness: 95,
            bureaucraticDistance: 8,
            promoRisk: 5,
          }
        ),
        article(
          'rail-modernization-started',
          77,
          84,
          'wins',
          'agerpres',
          'Agerpres',
          {
            feltImpact: 64,
            certainty: 82,
            humanCloseness: 34,
            bureaucraticDistance: 36,
            promoRisk: 18,
          }
        ),
      ],
      totalProcessed: 5,
      discarded: 0,
      removed: [],
      clusters: [],
    },
  };

  const counterSignalArtifact: DraftPipelineArtifact<
    CounterSignalPipelineData,
    'counter-signal-validate'
  > = {
    weekId: WEEK_ID,
    phase: 'counter-signal-validate',
    generatedAt: '2026-03-08T10:00:00.000Z',
    inputFile: '03-semantic-dedup.json + 01-prepared.json',
    data: {
      validation: {
        generatedAt: '2026-03-08T10:00:00.000Z',
        candidateCount: 5,
        flagged: [],
      },
    },
  };

  writeJson(join(pipelineDir, PIPELINE_ARTIFACT_FILENAMES['semantic-dedup']), semanticArtifact);
  writeJson(
    join(pipelineDir, PIPELINE_ARTIFACT_FILENAMES['counter-signal-validate']),
    counterSignalArtifact
  );

  await runPhase(tempRoot, 'select', {
    FINAL_SELECTED_COUNT: '3',
    FINAL_RESERVES_COUNT: '2',
  });

  const shortlist = JSON.parse(
    readFileSync(join(pipelineDir, PIPELINE_ARTIFACT_FILENAMES.select), 'utf-8')
  ) as DraftPipelineArtifact<any, 'select'>;

  assert.deepEqual(
    shortlist.data.selected.map((entry: ProcessedArticle) => entry.id),
    ['mobile-library-volunteers', 'green-school-roofs', 'rail-modernization-started']
  );
  assert.equal(
    shortlist.data.selected.some(
      (entry: ProcessedArticle) => entry.id === 'hospital-funds-potential'
    ),
    false
  );
});

test('refine phase keeps shortlist balance when refinement tries to reintroduce bureaucratic reserve stories', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-refine-editorial-balance-'));
  const pipelineDir = join(tempRoot, 'data', 'pipeline', WEEK_ID);
  mkdirSync(pipelineDir, { recursive: true });

  const selected = [
    makeDetailedProcessedArticle('mobile-library-volunteers', {
      sourceId: 'dw-romania',
      sourceName: 'DW România',
      category: 'local-heroes',
      feltImpact: 88,
      certainty: 92,
      humanCloseness: 95,
      bureaucraticDistance: 8,
      promoRisk: 5,
    }),
    makeDetailedProcessedArticle('green-school-roofs', {
      sourceId: 'stirileprotv',
      sourceName: 'Știrile ProTV',
      category: 'green-stuff',
      positivity: 81,
      impact: 74,
      feltImpact: 84,
      certainty: 87,
      humanCloseness: 74,
      bureaucraticDistance: 14,
      promoRisk: 8,
    }),
    makeDetailedProcessedArticle('oncogen-immunotherapy', {
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
    makeDetailedProcessedArticle('rail-modernization-started', {
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
    makeDetailedProcessedArticle('park-restoration', {
      sourceId: 'republica',
      sourceName: 'Republica',
      category: 'local-heroes',
      positivity: 79,
      impact: 68,
      feltImpact: 84,
      certainty: 90,
      humanCloseness: 88,
      bureaucraticDistance: 12,
      promoRisk: 4,
    }),
    makeDetailedProcessedArticle('g4media-ai-chat', {
      sourceId: 'mediafax',
      sourceName: 'Mediafax',
      positivity: 82,
      impact: 76,
      feltImpact: 72,
      certainty: 86,
      humanCloseness: 58,
      bureaucraticDistance: 18,
      promoRisk: 10,
    }),
    makeDetailedProcessedArticle('bihor-cultural-center', {
      sourceId: 'agerpres',
      sourceName: 'Agerpres',
      positivity: 80,
      impact: 72,
      feltImpact: 78,
      certainty: 84,
      humanCloseness: 76,
      bureaucraticDistance: 16,
      promoRisk: 8,
    }),
    makeDetailedProcessedArticle('giggle-growth', {
      sourceId: 'startup-ro',
      sourceName: 'start-up.ro',
      positivity: 78,
      impact: 78,
      feltImpact: 68,
      certainty: 88,
      humanCloseness: 64,
      bureaucraticDistance: 20,
      promoRisk: 26,
    }),
    makeDetailedProcessedArticle('grădina-icoanei', {
      sourceId: 'stirileprotv',
      sourceName: 'Știrile ProTV',
      category: 'green-stuff',
      positivity: 84,
      impact: 70,
      feltImpact: 80,
      certainty: 90,
      humanCloseness: 72,
      bureaucraticDistance: 16,
      promoRisk: 6,
    }),
    makeDetailedProcessedArticle('dinosaur-discovery', {
      sourceId: 'mediafax',
      sourceName: 'Mediafax',
      category: 'quick-hits',
      positivity: 94,
      impact: 70,
      feltImpact: 60,
      certainty: 100,
      humanCloseness: 40,
      bureaucraticDistance: 10,
      promoRisk: 0,
    }),
  ];

  const reserves = [
    makeDetailedProcessedArticle('women-startup-grants', {
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
    makeDetailedProcessedArticle('school-pilot-funding', {
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
    makeDetailedProcessedArticle('omd-tourism-funding', {
      sourceId: 'startupcafe',
      sourceName: 'StartupCafe',
      positivity: 75,
      impact: 65,
      feltImpact: 45,
      certainty: 70,
      humanCloseness: 35,
      bureaucraticDistance: 85,
      promoRisk: 20,
    }),
    makeDetailedProcessedArticle('hospital-funds-potential', {
      sourceId: 'economedia',
      sourceName: 'Economedia',
      positivity: 84,
      impact: 92,
      feltImpact: 42,
      certainty: 28,
      humanCloseness: 18,
      bureaucraticDistance: 92,
      promoRisk: 65,
    }),
  ];

  const shortlistArtifact: DraftPipelineArtifact<any, 'select'> = {
    weekId: WEEK_ID,
    phase: 'select',
    generatedAt: '2026-03-08T10:00:00.000Z',
    inputFile: '03-semantic-dedup.json + 04-counter-signal-validate.json',
    data: {
      selected,
      reserves,
      totalProcessed: selected.length + reserves.length,
      discarded: 0,
      validation: {
        generatedAt: '2026-03-08T10:00:00.000Z',
        candidateCount: selected.length + reserves.length,
        flagged: [],
      },
    },
  };

  const wrapperArtifact: DraftPipelineArtifact<any, 'wrapper-copy'> = {
    weekId: WEEK_ID,
    phase: 'wrapper-copy',
    generatedAt: '2026-03-08T10:00:00.000Z',
    inputFile: '05-shortlist.json',
    data: {
      wrapperCopy: {
        greeting: 'Salut!',
        intro: 'Intro mock.',
        signOff: 'Pe curând!',
        shortSummary: 'Rezumat mock.',
      },
    },
  };

  const refinementMockPath = join(tempRoot, 'refinement-mock.json');
  writeJson(refinementMockPath, {
    selectedIds: [
      'women-startup-grants',
      'school-pilot-funding',
      'oncogen-immunotherapy',
      'rail-modernization-started',
      'g4media-ai-chat',
      'bihor-cultural-center',
      'giggle-growth',
      'dinosaur-discovery',
      'hospital-funds-potential',
      'omd-tourism-funding',
    ],
    intro: 'Intro rafinat.',
    shortSummary: 'Rezumat rafinat.',
    reasoning: 'Am adus mai multă substanță instituțională.',
  });

  writeJson(join(pipelineDir, PIPELINE_ARTIFACT_FILENAMES.select), shortlistArtifact);
  writeJson(join(pipelineDir, PIPELINE_ARTIFACT_FILENAMES['wrapper-copy']), wrapperArtifact);

  await runPhase(tempRoot, 'refine', {
    GOODBRIEF_REFINEMENT_MOCK_FILE: refinementMockPath,
  });

  const refinedDraft = JSON.parse(
    readFileSync(join(tempRoot, 'data', 'drafts', `${WEEK_ID}.json`), 'utf-8')
  ) as DraftPipelineArtifact<any, 'refine'>['data']['draft'];

  assert.equal(
    refinedDraft.selected.some((article: ProcessedArticle) => article.id === 'mobile-library-volunteers'),
    true
  );
  assert.equal(
    refinedDraft.selected.some((article: ProcessedArticle) => article.id === 'green-school-roofs'),
    true
  );
  assert.ok(
    refinedDraft.selected.filter((article: ProcessedArticle) => {
      const bureaucraticDistance = article.bureaucraticDistance || 0;
      const certainty = article.certainty || 0;
      const promoRisk = article.promoRisk || 0;
      return bureaucraticDistance >= 70 && (certainty < 60 || promoRisk >= 70);
    }).length <= 2
  );
});

test('generate-draft wrapper produces the same final draft as running phases manually', async () => {
  const manualRoot = mkdtempSync(join(tmpdir(), 'goodbrief-manual-pipeline-'));
  const wrapperRoot = mkdtempSync(join(tmpdir(), 'goodbrief-wrapper-pipeline-'));
  const manualSetup = setupPipelineRoot(manualRoot);
  const wrapperSetup = setupPipelineRoot(wrapperRoot);

  for (const phase of [
    'prepare',
    'score',
    'semantic-dedup',
    'counter-signal-validate',
    'select',
    'wrapper-copy',
    'refine',
  ]) {
    await runPhase(manualRoot, phase, manualSetup.env);
  }

  await runTsxScript(
    join(REPO_ROOT, 'scripts', 'generate-draft.ts'),
    ['--week', WEEK_ID],
    {
      ...process.env,
      GOODBRIEF_ROOT_DIR: wrapperRoot,
      GEMINI_API_KEY: 'test-key',
      ...wrapperSetup.env,
    }
  );

  assert.deepEqual(
    stripVolatileTimestamps(
      JSON.parse(readFileSync(join(manualRoot, 'data', 'drafts', `${WEEK_ID}.json`), 'utf-8'))
    ),
    stripVolatileTimestamps(
      JSON.parse(readFileSync(join(wrapperRoot, 'data', 'drafts', `${WEEK_ID}.json`), 'utf-8'))
    )
  );
  assert.deepEqual(
    stripVolatileTimestamps(
      JSON.parse(
        readFileSync(
          join(manualRoot, 'data', 'pipeline', WEEK_ID, PIPELINE_ARTIFACT_FILENAMES.refine),
          'utf-8'
        )
      )
    ),
    stripVolatileTimestamps(
      JSON.parse(
        readFileSync(
          join(wrapperRoot, 'data', 'pipeline', WEEK_ID, PIPELINE_ARTIFACT_FILENAMES.refine),
          'utf-8'
        )
      )
    )
  );
});

test('verify-local shares the same Saturday phase command order and the workflow uses it in order', () => {
  assert.deepEqual(
    VERIFY_LOCAL_SCRIPTS.slice(0, SATURDAY_PIPELINE_SCRIPTS.length),
    [...SATURDAY_PIPELINE_SCRIPTS]
  );
  assert.ok(
    VERIFY_LOCAL_SCRIPTS.indexOf('validate-draft-freshness') >
      VERIFY_LOCAL_SCRIPTS.indexOf('validate-draft'),
    'verify-local should run draft freshness validation after same-week validation'
  );

  const workflow = readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'generate-newsletter.yml'),
    'utf-8'
  );

  let lastIndex = -1;
  for (const script of SATURDAY_PIPELINE_SCRIPTS) {
    const index = workflow.indexOf(`npm run ${script}`);
    assert.notEqual(index, -1, `Workflow should include ${script}`);
    assert.ok(index > lastIndex, `Workflow should run ${script} after the previous phase`);
    lastIndex = index;
  }

  assert.match(workflow, /materialize-draft-from-pipeline\.ts/);
  assert.match(workflow, /npm run validate-draft-freshness/);
});
