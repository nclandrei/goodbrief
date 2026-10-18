#!/usr/bin/env npx tsx

import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Resend } from 'resend';
import type { ArticleCategory, NewsletterDraft, ProcessedArticle, WeeklyBuffer, WrapperCopy } from './types.js';
import { resolveProjectRoot } from './lib/project-root.js';
import {
  buildResendEmailIdempotencyKey,
  sendResendEmailWithRetry,
} from './lib/resend-email.js';
import { buildNewsletterEmail } from './lib/newsletter-email.js';
import { MAX_SENDABLE_ARTICLE_COUNT, MIN_SENDABLE_ARTICLE_COUNT } from './lib/newsletter-policy.js';
import { hash, validateAssessedSelection, type AssessmentRun } from './lib/amp-assessment.js';
import { readJson, saveAssessmentJson } from './lib/assessment-files.js';
import type { EditorEmailReceipt } from './lib/editor-review.js';

export interface IndependentArticle {
  id: string;
  title: string;
  summary: string;
  category: ArticleCategory;
  positivity: number;
  impact: number;
  audienceRelevance: number;
}
export interface IndependentProof {
  weekId: string;
  generatedAt: string;
  assessment: AssessmentRun;
  selected: IndependentArticle[];
  wrapperCopy: WrapperCopy;
}

function sourcedArticles(proof: IndependentProof, raw: WeeklyBuffer): Array<ProcessedArticle & IndependentArticle> {
  const sourceById = new Map(raw.articles.map((article) => [article.id, article]));
  return proof.selected.map((article) => {
    const source = sourceById.get(article.id)!;
    return {
      ...article,
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      originalTitle: source.title,
      url: source.url,
      publishedAt: source.publishedAt,
      processedAt: proof.generatedAt,
    };
  });
}

export function materializeIndependentDraft(proof: IndependentProof, raw: WeeklyBuffer): NewsletterDraft {
  validateIndependentProof(proof, raw);
  return {
    weekId: proof.weekId,
    generatedAt: proof.generatedAt,
    selected: sourcedArticles(proof, raw),
    reserves: [],
    totalProcessed: raw.articles.length,
    discarded: raw.articles.length - proof.selected.length,
    wrapperCopy: proof.wrapperCopy,
    // Only an editor can mark this draft ready for Monday's subscriber delivery.
    validation: { generatedAt: proof.generatedAt, candidateCount: proof.selected.length, flagged: [], status: 'failed' },
  };
}

const ROOT_DIR = resolveProjectRoot(import.meta.url);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

export function validateIndependentProof(proof: IndependentProof, raw: WeeklyBuffer): void {
  if (proof.weekId !== raw.weekId || !/^\d{4}-W\d{2}$/.test(proof.weekId)) {
    throw new Error('Proof and raw news must have the same valid week ID');
  }
  if (!Array.isArray(proof.selected) || proof.selected.length < MIN_SENDABLE_ARTICLE_COUNT ||
      proof.selected.length > MAX_SENDABLE_ARTICLE_COUNT) {
    throw new Error(`Proof needs ${MIN_SENDABLE_ARTICLE_COUNT}–${MAX_SENDABLE_ARTICLE_COUNT} selected stories`);
  }
  if (!proof.wrapperCopy?.greeting || !proof.wrapperCopy.intro || !proof.wrapperCopy.signOff) {
    throw new Error('Proof is missing reader-facing wrapper copy');
  }

  const rawById = new Map(raw.articles.map((article) => [article.id, article]));
  const seen = new Set<string>();
  const seenUrls = new Set<string>();
  for (const article of proof.selected) {
    const source = rawById.get(article.id);
    if (!source || !/^https?:\/\//.test(source.url)) {
      throw new Error(`Story ${article.id} has no valid raw source and URL`);
    }
    if (seen.has(article.id) || seenUrls.has(source.url)) {
      throw new Error(`Duplicate story in proof: ${article.id}`);
    }
    seen.add(article.id);
    seenUrls.add(source.url);
    if (!['local-heroes', 'wins', 'green-stuff', 'quick-hits'].includes(article.category)) {
      throw new Error(`Invalid category for ${article.id}`);
    }
    if (!article.title || !article.summary) {
      throw new Error(`Missing title or summary for ${article.id}`);
    }
    for (const signal of ['positivity', 'impact', 'audienceRelevance'] as const) {
      if (!Number.isInteger(article[signal]) || article[signal] < 0 || article[signal] > 100) {
        throw new Error(`Invalid ${signal} score for ${article.id}`);
      }
    }
  }
  if (!proof.assessment) throw new Error('Proof requires a complete Amp assessment ledger');
  validateAssessedSelection(proof.assessment, raw, proof.selected.map(article => article.id));
  const latestEvidence = Math.max(Date.parse(proof.assessment.startedAt), ...proof.assessment.assessments.map(a => Date.parse(a.assessedAt)), ...proof.assessment.sourceChecks.map(c => Date.parse(c.checkedAt)));
  if (!proof.generatedAt?.endsWith('Z') || !Number.isFinite(Date.parse(proof.generatedAt)) || Date.parse(proof.generatedAt) < latestEvidence || Date.parse(proof.generatedAt) > Date.now()) {
    throw new Error('Proof timestamp must follow assessment and source checks');
  }
  for (const article of proof.selected) {
    const index = raw.articles.findIndex(source => source.id === article.id);
    const assessment = proof.assessment.assessments.find(item => item.index === index)!;
    if ((['positivity', 'impact', 'audienceRelevance'] as const).some(key => article[key] !== assessment[key])) {
      throw new Error(`Proof scores differ from assessment: ${article.id}`);
    }
  }
}

export function renderIndependentProof(proof: IndependentProof, raw: WeeklyBuffer): string {
  validateIndependentProof(proof, raw);
  const sourced = sourcedArticles(proof, raw);
  const sections = [
    ['local-heroes', '🌱 Local Heroes'],
    ['wins', '🏆 Wins'],
    ['green-stuff', '💚 Green Stuff'],
    ['quick-hits', '✨ Quick Hits'],
  ] as const;
  const copy = proof.wrapperCopy;
  const articleHtml = sections.map(([category, label]) => {
    const articles = sourced.filter((article) => article.category === category);
    if (!articles.length) return '';
    return `<h2 style="font-size:16px;color:#3d5f46;border-bottom:1px solid #e5e7eb;padding-top:16px">${label}</h2>${articles.map((article) => `
      <article style="padding:8px 0 18px">
        <h3 style="font-size:18px;margin:0 0 8px">${escapeHtml(article.title)}</h3>
        <p style="line-height:1.6;margin:0 0 8px">${escapeHtml(article.summary)}</p>
        <a style="color:#3d5f46" href="${escapeHtml(article.url)}">→ Citește pe ${escapeHtml(article.sourceName)}</a>
        <p style="font-size:12px;color:#6b7280">Pozitivitate ${article.positivity}/100 · Impact ${article.impact}/100 · Relevanță pentru public ${article.audienceRelevance}/100</p>
      </article>`).join('')}`;
  }).join('');

  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f5f1eb;color:#1f2937;font-family:Arial,sans-serif">
    <main style="max-width:600px;margin:24px auto;padding:32px 24px;background:white;border-radius:8px">
      <header style="text-align:center"><img src="https://goodbrief.ro/logo.png" alt="Good Brief" width="120"><p style="color:#6b7280">Vești bune din România</p></header>
      <p style="font-size:13px;color:#6b7280">PROOF INDEPENDENT · ${escapeHtml(proof.weekId)} · Pentru revizie editorială, nu pentru abonați</p>
      <p>${escapeHtml(copy.greeting)}</p><p style="line-height:1.6">${escapeHtml(copy.intro)}</p>
      <p style="color:#6b7280">${proof.selected.length} știri, sub 5 minute.</p>
      ${articleHtml}
      <hr style="border:0;border-top:1px solid #e5e7eb"><p style="white-space:pre-line">${escapeHtml(copy.signOff)}</p>
      <p style="font-size:12px;color:#6b7280">Verifică sursele și aprobă separat versiunea finală înainte de trimiterea către abonați.</p>
    </main>
  </body></html>`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const week = args[args.indexOf('--week') + 1];
  if (!/^\d{4}-W\d{2}$/.test(week || '')) {
    throw new Error('Use --week YYYY-WXX');
  }
  const runArgument = args.includes('--run') ? args[args.indexOf('--run') + 1] : undefined;
  if (args.includes('--run') && (!runArgument || runArgument.startsWith('--'))) throw new Error('Use --run <assessment-directory>');
  const directory = runArgument ? resolve(runArgument) : undefined;
  const proof = readJson<IndependentProof>(directory ? join(directory, 'finished-proof.json') : join(ROOT_DIR, 'data', 'orb-proofs', `${week}.json`));
  const raw = readJson<WeeklyBuffer>(directory ? join(directory, 'input.json') : join(ROOT_DIR, 'data', 'raw', `${week}.json`));
  if (proof.weekId !== week) throw new Error('Requested week does not match proof');
  validateIndependentProof(proof, raw);
  const testEmail = args.includes('--test-email');
  const newsletter = testEmail ? buildNewsletterEmail(materializeIndependentDraft(proof, raw)) : null;
  const html = newsletter?.html ?? renderIndependentProof(proof, raw);
  if (args.includes('--materialize-draft')) {
    const draftPath = join(ROOT_DIR, 'data', 'drafts', `${week}.json`);
    if (existsSync(draftPath)) throw new Error(`Refusing to overwrite existing draft at ${draftPath}`);
    mkdirSync(dirname(draftPath), { recursive: true });
    writeFileSync(draftPath, `${JSON.stringify(materializeIndependentDraft(proof, raw), null, 2)}\n`, { flag: 'wx' });
    console.log(`Unapproved draft written to ${draftPath}`);
  }
  if (args.includes('--dry-run')) {
    const output = args[args.indexOf('--output') + 1];
    if (!output || output.startsWith('--')) throw new Error('Use --dry-run --output <path>');
    writeFileSync(output, html);
    console.log(`Preview written to ${output}`);
    return;
  }

  const usingAmpAccount = testEmail ? Boolean(process.env.AMP_USER_EMAIL) : !process.env.TEST_EMAIL;
  const recipient = usingAmpAccount ? process.env.AMP_USER_EMAIL : process.env.TEST_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!recipient || !apiKey) {
    throw new Error('TEST_EMAIL (or the Amp account email) and RESEND_API_KEY are required for editor-only email delivery');
  }
  const recipients = recipient.split(',').map((email) => email.trim()).filter(Boolean);
  if ((testEmail || directory) && recipients.length !== 1) {
    throw new Error('The independent newsletter review must have exactly one editor recipient');
  }
  const resend = new Resend(apiKey);
  const payload = {
    from: 'Good Brief <buna@goodbrief.ro>',
    to: recipients,
    subject: testEmail
      ? `[TEST] Good Brief ${week} – Vești bune din România`
      : `[PROOF INDEPENDENT] Good Brief ${week} – Vești bune din România`,
    html,
  };
  const receiptPath = directory ? join(directory, testEmail ? 'test-email.json' : 'proof-email.json') : undefined;
  const receipt: EditorEmailReceipt = {
    version: 1, kind: testEmail ? 'test' : 'proof', proofHash: hash(proof), htmlHash: hash(html),
    recipientHash: hash(recipients), recipientCount: recipients.length, status: 'sending', attemptedAt: new Date().toISOString(),
  };
  if (receiptPath && existsSync(receiptPath)) {
    const previous = readJson<EditorEmailReceipt>(receiptPath);
    if (previous.version !== 1 || previous.kind !== receipt.kind || previous.proofHash !== receipt.proofHash ||
        previous.htmlHash !== receipt.htmlHash || previous.recipientHash !== receipt.recipientHash || previous.recipientCount !== 1) {
      throw new Error('Existing editor email receipt belongs to different content or recipient; refusing to resend');
    }
    if (previous.status !== 'accepted' || !previous.emailId) {
      throw new Error('Previous editor send has an uncertain outcome; inspect Resend before retrying, do not send blindly');
    }
    console.log(`Editor email was already accepted (${previous.emailId}); not sending again`);
    return;
  }
  if (receiptPath) saveAssessmentJson(receiptPath, receipt);
  console.log(`Sending ${testEmail ? 'test newsletter' : 'editor proof'} to ${usingAmpAccount ? 'the Amp account email' : 'TEST_EMAIL'}`);
  const result = await sendResendEmailWithRetry(resend.emails.send.bind(resend.emails), payload, {
    idempotencyKey: buildResendEmailIdempotencyKey(`${testEmail ? 'independent-test' : 'independent-proof'}-${week}`, payload),
  });
  if (receiptPath) saveAssessmentJson(receiptPath, { ...receipt, status: 'accepted', acceptedAt: new Date().toISOString(), emailId: result.id });
  console.log(`${testEmail ? 'Test newsletter' : 'Independent proof'} accepted by Resend (${result.id})`);
}

if (process.argv[1]?.endsWith('send-independent-proof.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
