import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { randomUUID } from 'crypto';
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
  'natural-titles',
  'wrapper-copy',
  'refine',
];

export const PIPELINE_ARTIFACT_FILENAMES: Record<DraftPipelinePhase, string> = {
  prepare: '01-prepared.json',
  score: '02-scored.json',
  'semantic-dedup': '03-semantic-dedup.json',
  'counter-signal-validate': '04-counter-signals.json',
  select: '05-shortlist.json',
  'natural-titles': '05a-natural-titles.json',
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

export function getPipelinePhaseSkipReason(
  rootDir: string,
  weekId: string,
  phase: DraftPipelinePhase
): string | null {
  const artifactPath = getPipelineArtifactPath(rootDir, weekId, phase);
  if (existsSync(artifactPath)) {
    try {
      readValidatedPipelineArtifact(artifactPath, weekId, phase);
      return `validated artifact already exists at ${artifactPath}`;
    } catch (error) {
      console.warn(
        `Ignoring invalid checkpoint for phase "${phase}" at ${artifactPath}: ${formatError(error)}`
      );
    }
  }

  if (phase === 'natural-titles') {
    const refinedPath = getPipelineArtifactPath(rootDir, weekId, 'refine');
    if (existsSync(refinedPath)) {
      try {
        readValidatedPipelineArtifact(refinedPath, weekId, 'refine');
        return `validated legacy refined artifact already exists at ${refinedPath}`;
      } catch (error) {
        console.warn(
          `Ignoring invalid legacy refined checkpoint at ${refinedPath}: ${formatError(error)}`
        );
      }
    }
  }

  return null;
}

export function writePipelineArtifact<TData, TPhase extends DraftPipelinePhase>(
  rootDir: string,
  artifact: DraftPipelineArtifact<TData, TPhase>
): string {
  const outputPath = getPipelineArtifactPath(rootDir, artifact.weekId, artifact.phase);
  writeJsonAtomically(outputPath, artifact);
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

  return readValidatedPipelineArtifact<TData, TPhase>(filePath, weekId, phase);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readValidatedPipelineArtifact<
  TData,
  TPhase extends DraftPipelinePhase,
>(
  filePath: string,
  expectedWeekId: string,
  expectedPhase: TPhase
): DraftPipelineArtifact<TData, TPhase> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid pipeline artifact at ${filePath}: malformed JSON (${formatError(error)})`,
      { cause: error }
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid pipeline artifact at ${filePath}: expected a JSON object`);
  }

  const errors: string[] = [];
  if (parsed.weekId !== expectedWeekId) {
    errors.push(`weekId must be ${expectedWeekId}, got ${String(parsed.weekId)}`);
  }
  if (parsed.phase !== expectedPhase) {
    errors.push(`phase must be ${expectedPhase}, got ${String(parsed.phase)}`);
  }
  if (
    typeof parsed.generatedAt !== 'string' ||
    Number.isNaN(Date.parse(parsed.generatedAt))
  ) {
    errors.push('generatedAt must be a valid timestamp');
  }
  if (typeof parsed.inputFile !== 'string' || parsed.inputFile.length === 0) {
    errors.push('inputFile must be a non-empty string');
  }
  if (!isRecord(parsed.data)) {
    errors.push('data must be a JSON object');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid pipeline artifact at ${filePath}: ${errors.join('; ')}`);
  }

  return parsed as unknown as DraftPipelineArtifact<TData, TPhase>;
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf-8');
    renameSync(temporaryPath, filePath);
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
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

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.weekId !== weekId ||
      !Array.isArray(parsed.scores) ||
      typeof parsed.savedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.savedAt))
    ) {
      throw new Error('expected matching weekId, scores array, and valid savedAt');
    }
    return parsed.scores as ArticleScore[];
  } catch (error) {
    console.warn(
      `Ignoring invalid partial score checkpoint at ${filePath}: ${formatError(error)}`
    );
    return null;
  }
}

export function writePartialScores(rootDir: string, weekId: string, scores: ArticleScore[]): void {
  const filePath = getPartialScorePath(rootDir, weekId);
  mkdirSync(dirname(filePath), { recursive: true });
  const data: PartialScoreData = {
    weekId,
    scores,
    savedAt: new Date().toISOString(),
  };
  writeJsonAtomically(filePath, data);
}

export function removePartialScores(rootDir: string, weekId: string): void {
  const filePath = getPartialScorePath(rootDir, weekId);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
