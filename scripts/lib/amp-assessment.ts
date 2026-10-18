import { createHash } from 'node:crypto';
import type { WeeklyBuffer } from '../types.js';

export interface Assessment {
  index: number;
  fingerprint: string;
  assessedAt: string;
  decision: 'candidate' | 'reject';
  positivity: number;
  impact: number;
  audienceRelevance: number;
  judgment: string;
}

export interface SourceCheck {
  index: number;
  checkedAt: string;
  url: string;
  // Evidence is the full retrieved source, not the RSS excerpt. Persist it with the run.
  sourceText: string;
  sourceHash: string;
  claims: string;
  caveats: string;
  verdict: 'verified' | 'unverified';
}

export interface AssessmentRun {
  version: 1;
  author: 'Amp';
  weekId: string;
  startedAt: string;
  asOf: string;
  inputHash: string;
  inputCount: number;
  exclusions: Array<{ index: number; fingerprint: string; reason: string }>;
  assessments: Assessment[];
  sourceChecks: SourceCheck[];
}

export const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const fingerprint = (raw: WeeklyBuffer, index: number): string => hash([index, raw.articles[index]]);
const utc = (value: string): boolean => typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value));

function exclusion(raw: WeeklyBuffer, index: number, asOf: string): string | undefined {
  const a = raw.articles[index];
  if (!a || ['id', 'title', 'summary', 'url', 'sourceId', 'sourceName'].some(key => typeof a[key as keyof typeof a] !== 'string') || !a.id || !a.title.trim() || !/^https?:\/\//.test(a.url)) return 'Malformed required raw fields';
  if (raw.articles.findIndex(other => other?.id === a.id) !== index) return `Duplicate raw ID: ${a.id}`;
  if (!utc(a.publishedAt) || !utc(a.fetchedAt)) return 'Invalid publication or acquisition timestamp';
  if (Date.parse(a.publishedAt) > Date.parse(asOf) || Date.parse(a.fetchedAt) > Date.parse(asOf)) return 'Published or acquired after as-of cutoff';
  if (Date.parse(asOf) - Date.parse(a.publishedAt) > 14 * 86400000) return 'Publication older than rolling 14-day ingestion window at as-of cutoff';
}

export function startAssessment(raw: WeeklyBuffer, asOf: string, startedAt = new Date().toISOString()): AssessmentRun {
  if (!/^\d{4}-W\d{2}$/.test(raw.weekId) || !Array.isArray(raw.articles) || !raw.articles.length || !utc(asOf) || !utc(startedAt) || Date.parse(asOf) > Date.parse(startedAt) || Date.parse(startedAt) > Date.now()) throw new Error('Invalid raw pool or UTC cutoff/start');
  return {
    version: 1, author: 'Amp', weekId: raw.weekId, startedAt, asOf,
    inputHash: hash(raw), inputCount: raw.articles.length,
    exclusions: raw.articles.flatMap((_, index) => {
      const reason = exclusion(raw, index, asOf);
      return reason ? [{ index, fingerprint: fingerprint(raw, index), reason }] : [];
    }),
    assessments: [], sourceChecks: [],
  };
}

export function validateAssessment(run: AssessmentRun, raw: WeeklyBuffer, complete = false) {
  const expected = startAssessment(raw, run.asOf, run.startedAt);
  if (run.version !== 1 || run.author !== 'Amp' || run.weekId !== raw.weekId || run.inputHash !== expected.inputHash || run.inputCount !== raw.articles.length) throw new Error('Assessment input snapshot mismatch');
  if (JSON.stringify(run.exclusions) !== JSON.stringify(expected.exclusions)) throw new Error('Invalid or missing explicit exclusions');
  if (!Array.isArray(run.assessments) || !Array.isArray(run.sourceChecks)) throw new Error('Invalid assessment ledger');
  const seen = new Set(run.exclusions.map(e => e.index));
  const judgments = new Set<string>();
  for (const a of run.assessments) {
    if (!Number.isInteger(a.index) || a.index < 0 || a.index >= raw.articles.length || seen.has(a.index) || a.fingerprint !== fingerprint(raw, a.index)) throw new Error(`Duplicate, excluded, unknown or changed assessment: ${a.index}`);
    if (!utc(a.assessedAt) || Date.parse(a.assessedAt) < Date.parse(run.startedAt) || Date.parse(a.assessedAt) > Date.now() || !['candidate', 'reject'].includes(a.decision)) throw new Error(`Invalid assessment metadata: ${a.index}`);
    for (const score of [a.positivity, a.impact, a.audienceRelevance]) if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error(`Invalid score: ${a.index}`);
    if (typeof a.judgment !== 'string' || a.judgment.trim().length < 30) throw new Error(`Missing article-specific judgment: ${a.index}`);
    const normalized = a.judgment.toLocaleLowerCase('ro').replace(/[^\p{L}\p{N}]/gu, '');
    if (judgments.has(normalized)) throw new Error(`Repeated judgment: ${a.index}`);
    judgments.add(normalized);
    seen.add(a.index);
  }
  const checked = new Map<number, SourceCheck>();
  for (const c of run.sourceChecks) {
    const a = run.assessments.find(a => a.index === c.index);
    const previous = checked.get(c.index);
    if (!a || a.decision !== 'candidate' ||
        (previous && Date.parse(c.checkedAt) <= Date.parse(previous.checkedAt)) ||
        !/^https?:\/\//.test(c.url) || !utc(c.checkedAt) ||
        Date.parse(c.checkedAt) < Date.parse(a.assessedAt) || Date.parse(c.checkedAt) > Date.now() ||
        !['verified', 'unverified'].includes(c.verdict) || typeof c.sourceText !== 'string' ||
        hash(c.sourceText) !== c.sourceHash || typeof c.claims !== 'string' || c.claims.trim().length < 30 ||
        typeof c.caveats !== 'string' || !c.caveats.trim() ||
        (c.verdict === 'verified' && (c.sourceText.trim().length < 500 || c.sourceText.trim() === raw.articles[c.index].summary.trim()))) {
      throw new Error(`Invalid full-source check: ${c.index}`);
    }
    checked.set(c.index, c);
  }
  const missing = raw.articles.flatMap((_, index) => seen.has(index) ? [] : [index]);
  if (complete && missing.length) throw new Error(`Incomplete assessment: ${missing.length} missing of ${raw.articles.length}`);
  return { input: raw.articles.length, excluded: run.exclusions.length, assessed: run.assessments.length, missing: missing.length, missingIndices: missing, candidates: run.assessments.filter(a => a.decision === 'candidate').length, verified: [...checked.values()].filter(c => c.verdict === 'verified').length };
}

// This flags shared wording for editorial review; it cannot establish independent thought.
export function auditJudgments(run: AssessmentRun) {
  const phrases = new Map<string, Set<number>>();
  for (const a of run.assessments) {
    const words = a.judgment.toLocaleLowerCase('ro').match(/[\p{L}\p{N}]+/gu) ?? [];
    for (let i = 0; i + 6 <= words.length; i++) {
      const phrase = words.slice(i, i + 6).join(' ');
      const indices = phrases.get(phrase) ?? new Set<number>();
      indices.add(a.index);
      phrases.set(phrase, indices);
    }
  }
  return { assessed: run.assessments.length, repeatedSixWordPhrases: [...phrases].filter(([, indices]) => indices.size > 1).map(([phrase, indices]) => ({ phrase, indices: [...indices] })) };
}

export function validateAssessedSelection(run: AssessmentRun, raw: WeeklyBuffer, ids: string[]): void {
  validateAssessment(run, raw, true);
  for (const id of ids) {
    const index = raw.articles.findIndex(a => a.id === id);
    if (raw.articles.filter(a => a?.id === id).length !== 1) throw new Error(`Selected raw ID is missing or ambiguous: ${id}`);
    const latest = run.sourceChecks.filter(c => c.index === index).at(-1);
    if (!run.assessments.some(a => a.index === index && a.decision === 'candidate') || latest?.verdict !== 'verified') throw new Error(`Selected story lacks candidate assessment and full-source verification: ${id}`);
  }
}
