import type { ProcessedArticle, RawArticle } from '../types.js';

type EditorialArticle =
  | Pick<ProcessedArticle, 'originalTitle' | 'summary'>
  | Pick<RawArticle, 'title' | 'summary'>;

const EDITORIAL_LABEL_PATTERN =
  /^(?:(?:foto|video|interviu|list[aă])(?:\s*[|:.\-–—]\s*|\s+))+/iu;

const COMMERCIAL_FESTIVAL_PATTERNS = [
  /\bnostalgi[ae]\b/iu,
  /\buntold\b/iu,
  /\bneversea\b/iu,
  /\belectric\s+castle\b/iu,
  /\bbeach,\s*please\b/iu,
  /\bsaga\s+festival\b/iu,
  /\bmassif\b/iu,
];

const RESCUE_RESOLUTION_PATTERN =
  /(?:salvat|salvat[ăa]|salvați|salvate|recuperat|recuperat[ăa]|recuperați|intervenit|intervenție|spart geamul|112)/iu;

const DANGER_PREMISE_PATTERN =
  /(?:bebelu[șs]|copil|copii|minor|încuiat|incuiat|blocat|captiv|disp[ăa]rut|r[ăa]t[ăa]cit|munte|f[ăa]r[ăa]\s+provizii|extenuat|accident|incendiu|înec|inec|spital|urgen[țt][ăa])/iu;

const CRIME_RESOLUTION_PATTERN =
  /(?:ho[țt]i|ho[țt]ul|furt|t[âa]lh[ăa]rie|jaf|flagrant|poli[țt]i[șs]ti|prins|prin[șs]i|arestat)/iu;

const SOFT_FIRST_PERSON_ESSAY_PATTERN =
  /\b(autocar|tren)\b[\s\S]*\b(m-am|lec[țt]ie pe care nu o voi uita|rom[âa]nia real[ăa])\b/iu;

function articleTitle(article: EditorialArticle): string {
  return 'originalTitle' in article ? article.originalTitle : article.title;
}

function articleText(article: EditorialArticle): string {
  return `${articleTitle(article)} ${article.summary}`;
}

export function normalizeDisplayTitle(title: string): string {
  return title.replace(EDITORIAL_LABEL_PATTERN, '').trim();
}

export function getEditorialBlockReason(article: EditorialArticle): string | null {
  const text = articleText(article);

  if (COMMERCIAL_FESTIVAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'commercial-festival-or-nostalgia';
  }

  if (CRIME_RESOLUTION_PATTERN.test(text)) {
    return 'crime-resolution';
  }

  if (RESCUE_RESOLUTION_PATTERN.test(text) && DANGER_PREMISE_PATTERN.test(text)) {
    return 'negative-premise-with-happy-ending';
  }

  if (SOFT_FIRST_PERSON_ESSAY_PATTERN.test(text)) {
    return 'soft-first-person-travel-essay';
  }

  return null;
}

export function shouldBlockEditorially(article: EditorialArticle): boolean {
  return getEditorialBlockReason(article) !== null;
}

export function normalizeRawArticleTitle(article: RawArticle): RawArticle {
  const title = normalizeDisplayTitle(article.title);
  return title === article.title ? article : { ...article, title };
}
