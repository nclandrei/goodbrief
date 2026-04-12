import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type {
  DraftPipelineArtifact,
  DraftPipelinePhase,
} from '../types.js';
import type { ArticleScore } from './types.js';

export const PIPELINE_PHASES: DraftPipelinePhase[] = [
  'prepare',
  'score',
  'semantic-dedup',
  'counter-signal-validate',
  'select',
  'wrapper-copy',
  'refine',
];

export const PIPELINE_ARTIFACT_FILENAMES: Record<DraftPipelinePhase, string> = {
  prepare: '01-prepared.json',
  score: '02-scored.json',
  'semantic-dedup': '03-semantic-dedup.json',
  'counter-signal-validate': '04-counter-signals.json',
  select: '05-shortlist.json',
  'wrapper-copy': '06-wrapper-copy.json',
  refine: '07-refined-draft.json',
};

export function getRootDir(importMetaDirname: string): string {
  return process.env.GOODBRIEF_ROOT_DIR || join(importMetaDirname, '..');
}

export function getISOWeekId(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 -
      3 +
      ((week1.getDay() + 6) % 7)) /
      7 +
      1
  );
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

export function parseWeekArg(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--week' && args[i + 1]) {
      return args[i + 1];
    }
  }
  return null;
}

export function resolveWeekId(args: string[]): string {
  return parseWeekArg(args) || getISOWeekId();
}

export function getLatestDraftWeekId(rootDir: string): string | null {
  const draftsDir = join(rootDir, 'data', 'drafts');
  if (!existsSync(draftsDir)) {
    return null;
  }

  const files = readdirSync(draftsDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .reverse();

  return files.length > 0 ? files[0].replace('.json', '') : null;
}

export function resolveDraftWeekId(rootDir: string, args: string[]): string {
  return parseWeekArg(args) || getLatestDraftWeekId(rootDir) || getISOWeekId();
}

export function requireGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }
  return apiKey;
}

export function getPipelineDir(rootDir: string, weekId: string): string {
  return join(rootDir, 'data', 'pipeline', weekId);
}

export function getPipelineArtifactPath(
  rootDir: string,
  weekId: string,
  phase: DraftPipelinePhase
): string {
  return join(getPipelineDir(rootDir, weekId), PIPELINE_ARTIFACT_FILENAMES[phase]);
}

export function writePipelineArtifact<TData, TPhase extends DraftPipelinePhase>(
  rootDir: string,
  artifact: DraftPipelineArtifact<TData, TPhase>
): string {
  const outputPath = getPipelineArtifactPath(rootDir, artifact.weekId, artifact.phase);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(artifact, null, 2), 'utf-8');
  return outputPath;
}

export function readPipelineArtifact<TData, TPhase extends DraftPipelinePhase>(
  rootDir: string,
  weekId: string,
  phase: TPhase
): DraftPipelineArtifact<TData, TPhase> {
  const filePath = getPipelineArtifactPath(rootDir, weekId, phase);
  if (!existsSync(filePath)) {
    throw new Error(
      `Required pipeline artifact not found for phase "${phase}" at ${filePath}`
    );
  }

  return JSON.parse(readFileSync(filePath, 'utf-8')) as DraftPipelineArtifact<TData, TPhase>;
}

// --- Partial score persistence ---

interface PartialScoreData {
  weekId: string;
  scores: ArticleScore[];
  savedAt: string;
}

export function getPartialScorePath(rootDir: string, weekId: string): string {
  return join(getPipelineDir(rootDir, weekId), '02-scored.partial.json');
}

export function readPartialScores(rootDir: string, weekId: string): ArticleScore[] | null {
  const filePath = getPartialScorePath(rootDir, weekId);
  if (!existsSync(filePath)) {
    return null;
  }
  const data = JSON.parse(readFileSync(filePath, 'utf-8')) as PartialScoreData;
  return data.scores;
}

export function writePartialScores(rootDir: string, weekId: string, scores: ArticleScore[]): void {
  const filePath = getPartialScorePath(rootDir, weekId);
  mkdirSync(dirname(filePath), { recursive: true });
  const data: PartialScoreData = {
    weekId,
    scores,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function removePartialScores(rootDir: string, weekId: string): void {
  const filePath = getPartialScorePath(rootDir, weekId);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
