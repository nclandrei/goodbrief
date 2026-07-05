import type { ProcessedArticle, RawArticle } from '../types.js';

type EditorialArticle =
  | Pick<ProcessedArticle, 'originalTitle' | 'summary'>
  | Pick<RawArticle, 'title' | 'summary'>;

const EDITORIAL_LABEL_PATTERN =
  String.raw`(?:galerie\s+foto|foto(?:\s*(?:&|/|\+)\s*video)?|video(?:\s*(?:&|/|\+)\s*foto|\s+interviu)?|interviu|grafic)`;

const EDITORIAL_LABEL_PREFIX_PATTERN = new RegExp(
  String.raw`^(?:(?:${EDITORIAL_LABEL_PATTERN})(?:\s*[|:.\-–—]\s*|\s+))+`,
  'iu'
);

const EDITORIAL_LABEL_SEPARATOR_SUFFIX_PATTERN = new RegExp(
  String.raw`\s*[|:.\-–—/]\s*${EDITORIAL_LABEL_PATTERN}(?:\s+[A-Z][\p{L}\d.-]+){0,2}\s*$`,
  'iu'
);

const EDITORIAL_LABEL_UPPERCASE_SUFFIX_PATTERN =
  /\s+(?:GALERIE\s+FOTO|FOTO(?:\s*&\s*VIDEO)?|VIDEO(?:\s*&\s*FOTO)?|GRAFIC|INTERVIU)\s*$/u;

const HTML_TAG_PATTERN = /<[^>]*>/gu;

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: "'",
  nbsp: ' ',
  quot: '"',
};

const COMMERCIAL_FESTIVAL_PATTERNS = [
  /\bfestival(?:ului|ul)?\s+nostalgia\b/iu,
  /\bnostalgia\b[\s\S]{0,80}\b(?:festival|p[ăa]durea\s+b[ăa]neasa|muzica anilor|petrecere)\b/iu,
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

const SPONSORED_MARKER_PATTERNS = [
  /\((?:p|publicitate)\)/iu,
  /\[(?:p|publicitate)\]/iu,
  /\b(?:advertorial|sponsorizat[ăa]?|sponsored)\b/iu,
];

function articleTitle(article: EditorialArticle): string {
  return 'originalTitle' in article ? article.originalTitle : article.title;
}

function articleText(article: EditorialArticle): string {
  return `${articleTitle(article)} ${article.summary}`;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return HTML_ENTITY_MAP[normalized] ?? match;
  });
}

export function normalizeDisplayTitle(title: string): string {
  let normalized = decodeHtmlEntities(title)
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  normalized = normalized
    .replace(EDITORIAL_LABEL_PREFIX_PATTERN, '')
    .replace(EDITORIAL_LABEL_SEPARATOR_SUFFIX_PATTERN, '')
    .replace(EDITORIAL_LABEL_UPPERCASE_SUFFIX_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

export function getEditorialBlockReason(article: EditorialArticle): string | null {
  const text = articleText(article);

  if (SPONSORED_MARKER_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'sponsored-or-advertorial';
  }

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
