import type { ProcessedArticle } from '../../types.js';
import type { LlmProviderName } from './provider.js';
import { LlmOutputError, LlmProviderError } from './provider.js';

export interface NaturalTitle {
  id: string;
  title: string;
}

export interface NaturalTitlesResponse {
  titles: NaturalTitle[];
}

/**
 * A model response can contain many usable titles even when a few entries are
 * malformed. Preserve those usable results so a fallback provider only needs
 * to regenerate the unresolved articles.
 */
export class NaturalTitlesPartialError extends LlmOutputError {
  readonly partialTitles: NaturalTitle[];
  readonly unresolvedArticleIds: string[];
  readonly diagnostics: string[];

  constructor(
    provider: LlmProviderName,
    partialTitles: NaturalTitle[],
    unresolvedArticleIds: string[],
    diagnostics: string[],
    options: { cause?: unknown } = {}
  ) {
    const unresolvedSummary = unresolvedArticleIds.length > 0
      ? `unresolved article IDs ${unresolvedArticleIds.join(', ')}`
      : 'unresolved natural-title response';
    super(
      provider,
      `generateNaturalTitles: ${unresolvedSummary}; ${diagnostics.join('; ')}`,
      options
    );
    this.name = 'NaturalTitlesPartialError';
    this.partialTitles = partialTitles;
    this.unresolvedArticleIds = unresolvedArticleIds;
    this.diagnostics = diagnostics;
  }
}

export const naturalTitlesResponseSchema = {
  type: 'object',
  properties: {
    titles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string', maxLength: 110 },
        },
        required: ['id', 'title'],
      },
    },
  },
  required: ['titles'],
};

export function buildNaturalTitlesPrompt(
  weekId: string,
  articles: ProcessedArticle[]
): string {
  const articleInput = articles.map((article) => ({
    id: article.id,
    sourceTitle: article.originalTitle,
    summary: article.summary,
    source: article.sourceName,
  }));

  return `Rewrite the source headlines for Good Brief week ${weekId}.

Good Brief is a Romanian positive-news newsletter for educated readers aged 20–30. Write one natural Romanian headline for every input article.

Rules:
- Rebuild each headline around the central verified fact. Do not mechanically shorten the source title.
- Use calm, specific, declarative Romanian. Prefer a concrete actor or place plus an action or result.
- Usually use 7–14 words and 45–90 characters. Never exceed 110 characters.
- Preserve names, places, numbers, timing, tense, certainty, and material caveats exactly.
- Never turn a plan, possibility, ongoing step, delay, or postponement into a completed result.
- Add no facts, causation, emotion, praise, superlatives, or positive spin unsupported by the source title and summary.
- Remove outlet rubrics and format labels such as Business CheckIn, Doctor de bine, FOTO, VIDEO, LIVE, EXCLUSIV, INTERVIU, and GRAFIC.
- Remove quote hooks, rhetorical questions, ALL CAPS, emoji, source names, and stacked headline decks.
- Avoid clickbait and marketing language such as „spectaculos”, „incredibil”, „de succes”, „fără precedent”, „cucerește”, and „gustul copilăriei”.
- Avoid AI formulas such as „scrie istorie”, „pune România pe hartă”, „un pas important”, „un nou capitol”, „o dovadă că”, „rază de speranță”, „schimbă jocul”, and „mai mult decât”.
- Use sentence case and Romanian diacritics. Do not end with sentence punctuation. A balanced closing quote is allowed only when the headline ends with a quoted proper name or event name.
- A source headline may stay unchanged when it already sounds natural and satisfies every rule.

Examples:
- Example source: Business CheckIn. Gustul copilăriei la borcan. Cum au transformat o tânără din Iași și mama ei vechile obiceiuri într-o afacere
  Example summary: Iosefina și mama ei fac conserve după rețetele familiei în mica lor afacere din Iași.
  Natural title: La Iași, Iosefina și mama ei fac conserve după rețetele familiei
- Example source: Locul spectaculos din România unde intri și nu mai ieși. Are 52 km
  Example summary: Peștera Vântului se află în Munții Apuseni și are 52 de kilometri de galerii.
  Natural title: Peștera Vântului are 52 de kilometri de galerii în Munții Apuseni
- Example source: Autostrada Sibiu–Pitești A1. Pe tronsonul 4 se așterne ultimul strat de asfalt
  Example summary: Lucrările au ajuns la ultimul strat de asfalt între Tigveni și Curtea de Argeș.
  Natural title: Ultimii metri de asfalt pe A1, între Tigveni și Curtea de Argeș
- Example source: INTERVIU Profesoara Carmen Ion: Acum 12 ani am aplicat ideea la o clasă pentru că voiam să îi fac pe elevi să citească mai ușor
  Example summary: Profesoara îi implică pe elevi în realizarea unor trailere de carte pentru a-i apropia de lectură.
  Natural title: Profesoara care îi convinge pe elevi să citească prin trailere de carte

Return a JSON object with a "titles" array. Include every input ID exactly once and no other IDs.

Input articles:
${JSON.stringify(articleInput, null, 2)}`;
}

export function normalizeNaturalTitlesResponse(
  provider: LlmProviderName,
  articles: ProcessedArticle[],
  payload: unknown
): NaturalTitle[] {
  const titles = (payload as Partial<NaturalTitlesResponse> | null)?.titles;
  const requestedIds = new Set<string>();
  for (const article of articles) {
    if (requestedIds.has(article.id)) {
      throw new LlmProviderError(
        provider,
        `generateNaturalTitles: duplicate requested article ID ${article.id}`
      );
    }
    requestedIds.add(article.id);
  }
  const diagnostics: string[] = [];
  const candidatesById = new Map<string, unknown[]>();

  if (!Array.isArray(titles)) {
    diagnostics.push('expected an object with a titles array');
  } else {
    for (const item of titles) {
      if (!item || typeof item !== 'object') {
        diagnostics.push(
          'every result must contain string id and title fields'
        );
        continue;
      }

      const candidate = item as Partial<NaturalTitle>;
      if (typeof candidate.id !== 'string') {
        diagnostics.push(
          'every result must contain string id and title fields'
        );
        continue;
      }
      if (!requestedIds.has(candidate.id)) {
        diagnostics.push(`unexpected article ID ${candidate.id}`);
        continue;
      }

      const candidates = candidatesById.get(candidate.id) || [];
      candidates.push(candidate.title);
      candidatesById.set(candidate.id, candidates);
    }
  }

  const resolvedById = new Map<string, string>();
  const unresolvedArticleIds: string[] = [];

  for (const article of articles) {
    const candidates = candidatesById.get(article.id) || [];
    let generatedError: string;

    if (candidates.length === 0) {
      generatedError = `missing article IDs ${article.id}`;
    } else if (candidates.length > 1) {
      generatedError = `duplicate article ID ${article.id}`;
    } else {
      const generated = normalizeAndValidateNaturalTitle(candidates[0]);
      if (generated.title !== undefined) {
        resolvedById.set(article.id, generated.title);
        continue;
      }
      generatedError = formatTitleValidationError(
        article.id,
        generated.error,
        candidates[0]
      );
    }

    // A source headline is a safe deterministic fallback only when it passes
    // exactly the same normalization and hard validation as model output.
    const source = normalizeAndValidateNaturalTitle(article.originalTitle);
    if (source.title !== undefined) {
      console.warn(
        `[llm] ${provider} natural title rejected for article ${article.id}; using validated source title: ${generatedError}`
      );
      resolvedById.set(article.id, source.title);
      continue;
    }

    unresolvedArticleIds.push(article.id);
    diagnostics.push(generatedError);
    diagnostics.push(
      `source title fallback rejected for article ID ${article.id}: ${source.error}; ${formatRejectedTitle(String(article.originalTitle || ''))}`
    );
  }

  const resolved = articles
    .filter((article) => resolvedById.has(article.id))
    .map((article) => ({
      id: article.id,
      title: resolvedById.get(article.id)!,
    }));

  if (unresolvedArticleIds.length > 0 || diagnostics.length > 0) {
    throw new NaturalTitlesPartialError(
      provider,
      resolved,
      unresolvedArticleIds,
      diagnostics
    );
  }

  return resolved;
}

type NaturalTitleValidationResult =
  | { title: string; error?: never }
  | { title?: never; error: string };

function normalizeAndValidateNaturalTitle(
  value: unknown
): NaturalTitleValidationResult {
  if (typeof value !== 'string') {
    return { error: 'title is not a string' };
  }

  // A final full stop is a harmless formatting slip from the model. Remove
  // it deterministically instead of failing the entire batch. Semantic
  // punctuation such as question/exclamation marks still goes through the
  // hard quality gate below.
  const title = value.trim().replace(/\.$/u, '').trimEnd();
  if (!title) {
    return { error: 'empty title' };
  }
  if (title.length > 110) {
    return { error: 'exceeds 110 characters' };
  }

  const qualityError = getNaturalTitleQualityError(title);
  if (qualityError) {
    return { error: `headline quality rule failed: ${qualityError}` };
  }

  return { title };
}

function formatTitleValidationError(
  articleId: string,
  error: string,
  rejectedValue: unknown
): string {
  const title = typeof rejectedValue === 'string' ? rejectedValue.trim() : '';
  if (error === 'exceeds 110 characters') {
    return `title for article ID ${articleId} exceeds 110 characters; ${formatRejectedTitle(title)}`;
  }
  if (error === 'empty title') {
    return `empty title for article ID ${articleId}`;
  }
  if (error === 'title is not a string') {
    return 'every result must contain string id and title fields';
  }
  return `headline quality rule failed for article ID ${articleId}: ${error.replace(/^headline quality rule failed: /, '')}; ${formatRejectedTitle(title)}`;
}

const FORBIDDEN_TITLE_PHRASES = [
  'business checkin',
  'doctor de bine',
  'români din lume',
] as const;

const INLINE_TERMINAL_QUOTE_PAIRS = [
  ['„', '”'],
  ['“', '”'],
  ['"', '"'],
] as const;

function hasBalancedInlineTerminalQuote(title: string): boolean {
  return INLINE_TERMINAL_QUOTE_PAIRS.some(([opening, closing]) => {
    if (!title.endsWith(closing)) return false;

    const closingIndex = title.length - closing.length;
    const openingIndex = title.lastIndexOf(opening, closingIndex - 1);

    // The opening quote must follow some unquoted headline text. A quote at
    // index zero is still the quote-hook pattern the editorial rules reject.
    return openingIndex > 0 && openingIndex + opening.length < closingIndex;
  });
}

function formatRejectedTitle(title: string): string {
  const characters = Array.from(title);
  const preview = characters.slice(0, 120).join('');
  const finalCharacter = characters.at(-1);
  const finalCodePoint = finalCharacter
    ? `U+${finalCharacter.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
    : 'none';

  return `rejectedTitle=${JSON.stringify(
    `${preview}${characters.length > 120 ? '…' : ''}`
  )}, finalCharacter=${JSON.stringify(finalCharacter || '')} (${finalCodePoint})`;
}

function getNaturalTitleQualityError(title: string): string | null {
  const lowerTitle = title.toLocaleLowerCase('ro-RO');
  const forbiddenPhrase = FORBIDDEN_TITLE_PHRASES.find((phrase) =>
    lowerTitle.includes(phrase)
  );
  if (forbiddenPhrase) {
    return `forbidden phrase “${forbiddenPhrase}”`;
  }

  if (
    /^(?:foto|video|live|exclusiv|interviu|grafic)\b/iu.test(title) ||
    /(?<!\p{L})(?:FOTO|VIDEO|LIVE|EXCLUSIV|INTERVIU|GRAFIC)(?!\p{L})/u.test(
      title
    )
  ) {
    return 'source format label';
  }
  if (
    /\p{Extended_Pictographic}/u.test(title) ||
    /\p{Regional_Indicator}{2}/u.test(title) ||
    /[#*0-9]\uFE0F?\u20E3/u.test(title)
  ) {
    return 'emoji';
  }
  if (/^["'„“”]/u.test(title)) {
    return 'quote hook';
  }
  if (/\p{P}$/u.test(title) && !hasBalancedInlineTerminalQuote(title)) {
    return 'terminal punctuation';
  }

  const letters = title.match(/\p{L}/gu)?.join('') || '';
  if (
    letters.length >= 4 &&
    letters === letters.toLocaleUpperCase('ro-RO')
  ) {
    return 'ALL CAPS';
  }

  return null;
}
