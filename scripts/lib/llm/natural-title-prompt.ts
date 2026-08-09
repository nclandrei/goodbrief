import type { ProcessedArticle } from '../../types.js';
import type { LlmProviderName } from './provider.js';
import { LlmProviderError } from './provider.js';

export interface NaturalTitle {
  id: string;
  title: string;
}

export interface NaturalTitlesResponse {
  titles: NaturalTitle[];
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
          title: { type: 'string' },
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
- Use sentence case and Romanian diacritics. Do not end with punctuation.
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
  if (!Array.isArray(titles)) {
    throw new LlmProviderError(
      provider,
      'generateNaturalTitles: expected an object with a titles array'
    );
  }

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
  const byId = new Map<string, string>();

  for (const item of titles) {
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') {
      throw new LlmProviderError(
        provider,
        'generateNaturalTitles: every result must contain string id and title fields'
      );
    }

    const title = item.title.trim();
    if (!requestedIds.has(item.id)) {
      throw new LlmProviderError(
        provider,
        `generateNaturalTitles: unexpected article ID ${item.id}`
      );
    }
    if (byId.has(item.id)) {
      throw new LlmProviderError(
        provider,
        `generateNaturalTitles: duplicate article ID ${item.id}`
      );
    }
    if (!title) {
      throw new LlmProviderError(
        provider,
        `generateNaturalTitles: empty title for article ID ${item.id}`
      );
    }
    if (title.length > 110) {
      throw new LlmProviderError(
        provider,
        `generateNaturalTitles: title for article ID ${item.id} exceeds 110 characters`
      );
    }
    const qualityError = getNaturalTitleQualityError(title);
    if (qualityError) {
      throw new LlmProviderError(
        provider,
        `generateNaturalTitles: headline quality rule failed for article ID ${item.id}: ${qualityError}`
      );
    }
    byId.set(item.id, title);
  }

  const missingIds = articles
    .map((article) => article.id)
    .filter((id) => !byId.has(id));
  if (missingIds.length > 0) {
    throw new LlmProviderError(
      provider,
      `generateNaturalTitles: missing article IDs ${missingIds.join(', ')}`
    );
  }

  return articles.map((article) => ({
    id: article.id,
    title: byId.get(article.id)!,
  }));
}

const FORBIDDEN_TITLE_PHRASES = [
  'business checkin',
  'doctor de bine',
  'români din lume',
  'spectaculos',
  'incredibil',
  'de succes',
  'fără precedent',
  'cucerește',
  'gustul copilăriei',
  'scrie istorie',
  'pune românia pe hartă',
  'un pas important',
  'un nou capitol',
  'o dovadă că',
  'rază de speranță',
  'schimbă jocul',
  'mai mult decât',
  'nu doar',
  'viitor mai bun',
  'povestea care',
  'cum a reușit',
] as const;

function getNaturalTitleQualityError(title: string): string | null {
  const lowerTitle = title.toLocaleLowerCase('ro-RO');
  const forbiddenPhrase = FORBIDDEN_TITLE_PHRASES.find((phrase) =>
    lowerTitle.includes(phrase)
  );
  if (forbiddenPhrase) {
    return `forbidden phrase “${forbiddenPhrase}”`;
  }

  if (/^(?:foto|video|live|exclusiv|interviu|grafic)\b/iu.test(title)) {
    return 'source format label';
  }
  if (/\p{Extended_Pictographic}/u.test(title)) {
    return 'emoji';
  }
  if (/[.!?;:]$/u.test(title)) {
    return 'terminal punctuation';
  }
  if (/^["'„“”]|["'„“”]$/u.test(title)) {
    return 'quote hook';
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
