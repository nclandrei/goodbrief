import type { ProcessedArticle } from '../../types.js';
import type { DraftValidation } from '../../types.js';
import type { WrapperCopy } from '../../../emails/utils/generate-copy.js';
import type { HistoricalArticle } from '../historical-articles.js';
import { getRankingScore } from '../ranking.js';
import {
  isBureaucraticStory,
  isCommunityCentered,
  isGreenPreferred,
} from '../editorial-balance.js';

export interface RefinePromptInput {
  weekId: string;
  selected: ProcessedArticle[];
  reserves: ProcessedArticle[];
  wrapperCopy: WrapperCopy;
  validation: DraftValidation;
  previousArticles: HistoricalArticle[];
  lookbackLabel: string;
}

function formatSignal(value: number | undefined): string {
  return typeof value === 'number' ? String(value) : 'n/a';
}

function getEditorialTags(article: ProcessedArticle): string[] {
  const tags: string[] = [];
  if (isCommunityCentered(article)) tags.push('community');
  if (isGreenPreferred(article)) tags.push('green');
  if (isBureaucraticStory(article)) tags.push('bureaucratic-risk');
  return tags;
}

export const refineResponseSchema = {
  type: 'object',
  properties: {
    selectedIds: {
      type: 'array',
      items: { type: 'string' },
    },
    intro: { type: 'string' },
    shortSummary: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['selectedIds', 'intro', 'shortSummary', 'reasoning'],
};

export function buildRefinePrompt(input: RefinePromptInput): string {
  const {
    weekId,
    selected,
    reserves,
    wrapperCopy,
    validation,
    previousArticles,
    lookbackLabel,
  } = input;

  const allArticles = [...selected, ...reserves];
  const articleById = new Map(allArticles.map((article) => [article.id, article]));
  const validationById = new Map(
    validation.flagged.map((flag) => [flag.candidateId, flag])
  );

  const articleList = allArticles
    .map((article, index) => {
      const flag = validationById.get(article.id);
      const adjustedScore =
        Math.round(
          (getRankingScore(article) - (flag?.penaltyApplied || 0)) * 10
        ) / 10;
      const tags = getEditorialTags(article);
      const validationNote = flag
        ? `\n   Same-week validation: ${flag.verdict.toUpperCase()} — ${flag.reason}`
        : '';
      const signalLine =
        `pos:${article.positivity} structural:${article.impact} felt:${formatSignal(article.feltImpact)} ` +
        `certainty:${formatSignal(article.certainty)} human:${formatSignal(article.humanCloseness)} ` +
        `bureau:${formatSignal(article.bureaucraticDistance)} promo:${formatSignal(article.promoRisk)} ` +
        `adjusted:${adjustedScore}`;

      return `${index + 1}. [ID: ${article.id}] [${article.category}] [${tags.join(', ') || 'no-tags'}] (${signalLine}) "${article.originalTitle}"\n   Summary: ${article.summary}${validationNote}`;
    })
    .join('\n\n');

  const previousWeeksContext =
    previousArticles.length > 0
      ? `\n\nPREVIOUSLY PUBLISHED (${lookbackLabel} - DO NOT SELECT similar stories):
${previousArticles
  .slice(0, 20)
  .map((article, index) => `${index + 1}. "${article.title}"`)
  .join('\n')}
${previousArticles.length > 20 ? `... and ${previousArticles.length - 20} more` : ''}`
      : '';

  const validationContext =
    validation.flagged.length > 0
      ? `\n\nSAME-WEEK VALIDATION FLAGS:
${validation.flagged
  .map((flag, index) => {
    const articleTitle =
      articleById.get(flag.candidateId)?.originalTitle || flag.candidateId;
    return `${index + 1}. [${flag.verdict.toUpperCase()}] [ID: ${flag.candidateId}] "${articleTitle}"
   Reason: ${flag.reason}`;
  })
  .join('\n')}

IMPORTANT VALIDATION RULES:
- STRONG flags should stay out of selected by default.
- BORDERLINE flags may stay only if alternatives are clearly weaker.
- If a flagged story survives, make sure the rest of the selection is still strong enough to justify it.`
      : '';

  return `You are reviewing a Good Brief newsletter draft for week ${weekId}.

IMPORTANT: All text output (intro, shortSummary, reasoning) MUST be in Romanian. This is a Romanian newsletter.
${previousWeeksContext}
${validationContext}

CURRENT SELECTION (top 10):
${selected
  .map(
    (article, index) => `${index + 1}. [ID: ${article.id}] "${article.originalTitle}"`
  )
  .join('\n')}

CURRENT INTRO (in Romanian):
"${wrapperCopy.intro}"

CURRENT SHORT SUMMARY (in Romanian):
"${wrapperCopy.shortSummary}"

ALL AVAILABLE ARTICLES (selected + reserves):
${articleList}

REVIEW CRITERIA:
1. Story variety: Avoid duplicate stories or very similar topics. Look for redundant coverage.
2. NO REPEATS: Do NOT select articles similar to previously published stories (see list above)
3. Category balance: Aim for mix of wins, local-heroes, green-stuff, quick-hits
4. Impact vs fluff: Prefer substantive stories over feel-good fluff
5. Recency: Prefer more recent stories when quality is similar
6. Intro quality: Should be warm, engaging, capture the week's essence (IN ROMANIAN)
7. Avoid promotional content or sponsored articles (marked with "(P)")
8. Respect same-week validation flags: strong flags should normally be excluded; borderline flags need a clear editorial reason to stay
9. Source diversity: do not let one niche source family dominate the issue
10. Concrete over speculative: prefer stories that are already happening over promises, calls for applications, or funding announcements
11. Human closeness: prefer stories readers can feel in communities, schools, neighborhoods, hospitals, or daily life over ministry/process stories
12. Preserve the balanced shape: keep at least two clearly community-centered stories and at least one green story when strong options exist
13. Do not swap in a grant, funding call, pilot program, or ministerial announcement just because it sounds more substantial; only keep those if they are concrete and clearly stronger than tangible alternatives

TASK:
- Review the current selection critically
- If you find issues (duplicates, weak stories, imbalance, REPEATS from previous weeks), swap articles from reserves
- If the intro could be sharper or better reflect the final selection, improve it (KEEP IT IN ROMANIAN)
- Return 9-12 article IDs in your preferred order

Return JSON with:
- selectedIds: array of 9-12 article IDs in display order
- intro: the intro IN ROMANIAN
- shortSummary: the short summary IN ROMANIAN
- reasoning: brief explanation of what you changed and why (or "No changes needed")`;
}
