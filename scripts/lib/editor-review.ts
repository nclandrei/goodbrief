import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditJudgments, hash, type AssessmentRun } from './amp-assessment.js';
import { readJson, saveAssessmentJson } from './assessment-files.js';
import { validateDraftFreshness } from './draft-validation.js';
import { buildNewsletterEmail } from './newsletter-email.js';
import { loadHistoricalArticles } from './story-history.js';
import { materializeIndependentDraft, renderIndependentProof, validateIndependentProof, type IndependentProof } from '../send-independent-proof.js';
import type { NewsletterDraft, WeeklyBuffer } from '../types.js';

interface EditorialReview {
  selectionReasoning: string;
  alternativesAndCuts: string[];
  sourceLimitations: string;
  spotChecks: Array<{ index: number; notes: string }>;
}

export interface EditorEmailReceipt {
  version: 1;
  kind: 'proof' | 'test';
  proofHash: string;
  htmlHash: string;
  recipientHash: string;
  recipientCount: number;
  status: 'sending' | 'accepted';
  attemptedAt: string;
  acceptedAt?: string;
  emailId?: string;
}

export function validateEditorialReview(directory: string, run: AssessmentRun): EditorialReview {
  const review = readJson<EditorialReview>(join(directory, 'editorial-review.json'));
  if (typeof review.selectionReasoning !== 'string' || review.selectionReasoning.trim().length < 50 ||
      typeof review.sourceLimitations !== 'string' || review.sourceLimitations.trim().length < 30 ||
      !Array.isArray(review.alternativesAndCuts) || !review.alternativesAndCuts.length ||
      review.alternativesAndCuts.some(note => typeof note !== 'string' || note.trim().length < 30) ||
      !Array.isArray(review.spotChecks)) {
    throw new Error('Editorial review needs selection reasoning, alternatives, source limits and manual spot checks');
  }
  const indices = new Set<number>();
  const decisions = { candidate: 0, reject: 0 };
  for (const sample of review.spotChecks) {
    const assessment = run.assessments.find(item => item.index === sample.index);
    if (!assessment || indices.has(sample.index) || typeof sample.notes !== 'string' || sample.notes.trim().length < 30) {
      throw new Error('Invalid or repeated editorial spot check');
    }
    indices.add(sample.index);
    decisions[assessment.decision]++;
  }
  if (indices.size < Math.min(12, run.assessments.length) ||
      decisions.candidate < Math.min(3, run.assessments.filter(item => item.decision === 'candidate').length) ||
      decisions.reject < Math.min(3, run.assessments.filter(item => item.decision === 'reject').length)) {
    throw new Error('Manually spot-check at least 12 distinct assessments, including candidates and rejects');
  }
  return review;
}

function sameJsonFile(path: string, value: unknown): void {
  if (existsSync(path)) {
    if (hash(readJson(path)) !== hash(value)) throw new Error(`Refusing to replace different reviewed content at ${path}`);
    return;
  }
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

export async function stageEditorReview(root: string, directory: string, proof: IndependentProof, raw: WeeklyBuffer, materialize = false) {
  validateIndependentProof(proof, raw);
  validateEditorialReview(directory, proof.assessment);
  const draft = materializeIndependentDraft(proof, raw);
  const history = loadHistoricalArticles({ rootDir: root, currentWeekId: proof.weekId, draftLookback: 4 });
  const freshness = await validateDraftFreshness({ draft, historicalArticles: history.articles,
    recentDraftCount: history.draftArticleCount, publishedHistoryCount: history.issueArticleCount });
  saveAssessmentJson(join(directory, 'freshness.json'), freshness);
  if (freshness.status !== 'passed') throw new Error(`Freshness check blocked ${freshness.blockedArticles.map(item => item.articleId).join(', ')}; revise the proposal before finishing`);
  // Preview remains revisable until finish; only delivery installs the frozen edition.
  saveAssessmentJson(join(directory, 'draft.json'), draft);
  if (materialize) {
    sameJsonFile(join(root, 'data', 'orb-proofs', `${proof.weekId}.json`), proof);
    sameJsonFile(join(root, 'data', 'drafts', `${proof.weekId}.json`), draft);
  }
  const proofHtml = renderIndependentProof(proof, raw);
  const newsletter = buildNewsletterEmail(draft);
  writeFileSync(join(directory, 'editor-proof.html'), proofHtml);
  writeFileSync(join(directory, 'newsletter.html'), newsletter.html);
  saveAssessmentJson(join(directory, 'judgment-audit.json'), {
    checkedAt: new Date().toISOString(), assessmentHash: hash(proof.assessment), ...auditJudgments(proof.assessment),
  });
  return { weekId: proof.weekId, draftApproved: false, proofPath: join(directory, 'editor-proof.html'),
    newsletterPath: join(directory, 'newsletter.html'), deliverySha256: newsletter.deliverySha256 };
}

export function editorReviewReady(root: string, directory: string, proof: IndependentProof, raw: WeeklyBuffer): boolean {
  const path = join(directory, 'review-ready.json');
  if (!existsSync(path)) return false;
  validateIndependentProof(proof, raw);
  const review = validateEditorialReview(directory, proof.assessment);
  const receipt = readJson<Record<string, unknown>>(path);
  const email = readJson<EditorEmailReceipt>(join(directory, 'proof-email.json'));
  const draft = readJson<NewsletterDraft>(join(root, 'data', 'drafts', `${proof.weekId}.json`));
  const expectedDraft = materializeIndependentDraft(proof, raw);
  if (receipt.proofHash !== hash(proof) || receipt.reviewHash !== hash(review) || receipt.draftHash !== hash(draft) ||
      hash(readJson(join(root, 'data', 'orb-proofs', `${proof.weekId}.json`))) !== hash(proof) ||
      hash(draft) !== hash(expectedDraft) || draft.validation?.status !== 'failed' || draft.deliveryLock ||
      email.version !== 1 || email.kind !== 'proof' || email.status !== 'accepted' || !email.emailId ||
      email.recipientCount !== 1 || email.proofHash !== hash(proof) ||
      email.htmlHash !== hash(renderIndependentProof(proof, raw)) || receipt.emailId !== email.emailId) {
    throw new Error('Editor-ready receipt does not match the unapproved draft, proof, spot checks and accepted editor email');
  }
  return true;
}

export function finishEditorReview(root: string, directory: string, proof: IndependentProof, raw: WeeklyBuffer): void {
  const draft = readJson<NewsletterDraft>(join(root, 'data', 'drafts', `${proof.weekId}.json`));
  const review = validateEditorialReview(directory, proof.assessment);
  const email = readJson<EditorEmailReceipt>(join(directory, 'proof-email.json'));
  const receipt = { completedAt: new Date().toISOString(), proofHash: hash(proof),
    reviewHash: hash(review), draftHash: hash(draft), emailId: email.emailId };
  // Validate a proposed receipt before publishing the terminal marker.
  const path = join(directory, 'review-ready.json');
  if (email.version !== 1 || email.kind !== 'proof' || email.status !== 'accepted' || !email.emailId || email.recipientCount !== 1 ||
      email.proofHash !== hash(proof) || email.htmlHash !== hash(renderIndependentProof(proof, raw)) ||
      hash(draft) !== hash(materializeIndependentDraft(proof, raw))) {
    throw new Error('The matching editor proof must be accepted and its draft must remain unapproved');
  }
  if (!existsSync(path)) saveAssessmentJson(path, receipt);
  editorReviewReady(root, directory, proof, raw);
}
