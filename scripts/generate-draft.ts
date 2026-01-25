import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type {
  ProcessedArticle,
  WeeklyBuffer,
  NewsletterDraft,
  WrapperCopy,
} from './types.js';
import { deduplicateArticles } from './lib/deduplication.js';
import { processArticleBatch, createGeminiModel } from './lib/gemini.js';
import type { ArticleScore } from './lib/types.js';
import { generateWrapperCopy } from '../emails/utils/generate-copy.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const model = createGeminiModel(GEMINI_API_KEY, false);

function getISOWeekId(date: Date = new Date()): string {
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

interface RefinementResult {
  selectedIds: string[];
  intro: string;
  shortSummary: string;
  reasoning: string;
}

async function refineDraft(
  selected: ProcessedArticle[],
  reserves: ProcessedArticle[],
  wrapperCopy: WrapperCopy,
  weekId: string
): Promise<{ selected: ProcessedArticle[]; reserves: ProcessedArticle[]; wrapperCopy: WrapperCopy }> {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!);

  const refinementSchema = {
    type: 'object',
    properties: {
      selectedIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered list of 10 article IDs for the final selection',
      },
      intro: { type: 'string', description: 'Refined intro paragraph (2-3 sentences)' },
      shortSummary: { type: 'string', description: 'Refined short summary (60-80 chars)' },
      reasoning: { type: 'string', description: 'Brief explanation of changes made' },
    },
    required: ['selectedIds', 'intro', 'shortSummary', 'reasoning'],
  };

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: refinementSchema,
    } as any,
  });

  const allArticles = [...selected, ...reserves];
  const articleList = allArticles
    .map((a, i) => `${i + 1}. [ID: ${a.id}] [${a.category}] (pos:${a.positivity}, impact:${a.impact}) "${a.originalTitle}"\n   Summary: ${a.summary}`)
    .join('\n\n');

  const prompt = `You are reviewing a Good Brief newsletter draft for week ${weekId}.

CURRENT SELECTION (top 10):
${selected.map((a, i) => `${i + 1}. [ID: ${a.id}] "${a.originalTitle}"`).join('\n')}

CURRENT INTRO:
"${wrapperCopy.intro}"

CURRENT SHORT SUMMARY:
"${wrapperCopy.shortSummary}"

ALL AVAILABLE ARTICLES (selected + reserves):
${articleList}

REVIEW CRITERIA:
1. Story variety: Avoid duplicate stories or very similar topics. Look for redundant coverage.
2. Category balance: Aim for mix of wins, local-heroes, green-stuff, quick-hits
3. Impact vs fluff: Prefer substantive stories over feel-good fluff
4. Recency: Prefer more recent stories when quality is similar
5. Intro quality: Should be warm, engaging, capture the week's essence
6. Avoid promotional content or sponsored articles (marked with "(P)")

TASK:
- Review the current selection critically
- If you find issues (duplicates, weak stories, imbalance), swap articles from reserves
- If the intro could be sharper or better reflect the final selection, improve it
- Return 9-12 article IDs in your preferred order

Return JSON with:
- selectedIds: array of 9-12 article IDs in display order
- intro: the intro (improved if needed, keep original if good)
- shortSummary: the short summary (improved if needed)
- reasoning: brief explanation of what you changed and why (or "No changes needed")`;

  console.log('Reviewing draft for improvements...');
  const result = await model.generateContent(prompt);
  const content = result.response.text();

  if (!content) {
    console.log('No refinement response, keeping original draft');
    return { selected, reserves, wrapperCopy };
  }

  try {
    const refinement = JSON.parse(content) as RefinementResult;
    console.log(`✓ Review complete: ${refinement.reasoning}`);

    if (refinement.selectedIds.length < 9 || refinement.selectedIds.length > 12) {
      console.log(`Warning: Expected 9-12 articles, got ${refinement.selectedIds.length}. Keeping original.`);
      return { selected, reserves, wrapperCopy };
    }

    const articleMap = new Map(allArticles.map((a) => [a.id, a]));
    const newSelected: ProcessedArticle[] = [];
    const usedIds = new Set<string>();

    for (const id of refinement.selectedIds) {
      const article = articleMap.get(id);
      if (article && !usedIds.has(id)) {
        newSelected.push(article);
        usedIds.add(id);
      }
    }

    if (newSelected.length < 9 || newSelected.length > 12) {
      console.log(`Warning: Could only find ${newSelected.length} valid articles. Keeping original.`);
      return { selected, reserves, wrapperCopy };
    }

    const newReserves = allArticles.filter((a) => !usedIds.has(a.id));

    const newWrapperCopy: WrapperCopy = {
      ...wrapperCopy,
      intro: refinement.intro,
      shortSummary: refinement.shortSummary,
    };

    return { selected: newSelected, reserves: newReserves, wrapperCopy: newWrapperCopy };
  } catch (error) {
    console.log('Failed to parse refinement response, keeping original draft');
    return { selected, reserves, wrapperCopy };
  }
}

async function main() {
  const weekId = getISOWeekId();
  const rawPath = join(ROOT_DIR, 'data', 'raw', `${weekId}.json`);

  if (!existsSync(rawPath)) {
    console.error(`No raw data found for ${weekId}`);
    process.exit(1);
  }

  const buffer: WeeklyBuffer = JSON.parse(readFileSync(rawPath, 'utf-8'));
  console.log(`Processing ${buffer.articles.length} articles for ${weekId}`);

  console.log('Deduplicating articles...');
  const dedupResult = deduplicateArticles(buffer.articles);
  const representatives = dedupResult.outputArticles;
  console.log(
    `Deduplicated ${buffer.articles.length} articles to ${representatives.length} unique stories`
  );

  const BATCH_SIZE = 200;
  const allScores: ArticleScore[] = [];

  for (let i = 0; i < representatives.length; i += BATCH_SIZE) {
    const batch = representatives.slice(i, i + BATCH_SIZE);
    console.log(
      `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(representatives.length / BATCH_SIZE)}...`
    );
    const scores = await processArticleBatch(batch, model, false);
    allScores.push(...scores);

    if (i + BATCH_SIZE < representatives.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const scoreMap = new Map(allScores.map((s) => [s.id, s]));
  const now = new Date().toISOString();
  const seenIds = new Set<string>();

  const processed: ProcessedArticle[] = representatives
    .map((raw) => {
      if (seenIds.has(raw.id)) return null;
      seenIds.add(raw.id);

      const score = scoreMap.get(raw.id);
      if (!score) return null;
      if (!score.romaniaRelevant) return null;
      return {
        id: raw.id,
        sourceId: raw.sourceId,
        sourceName: raw.sourceName,
        originalTitle: raw.title,
        url: raw.url,
        summary: score.summary,
        positivity: score.positivity,
        impact: score.impact,
        category: score.category,
        publishedAt: raw.publishedAt,
        processedAt: now,
      };
    })
    .filter((p): p is ProcessedArticle => p !== null);

  const positive = processed.filter((p) => p.positivity >= 40);
  const discarded = processed.length - positive.length;

  positive.sort((a, b) => {
    const scoreA = a.positivity * 0.6 + a.impact * 0.4;
    const scoreB = b.positivity * 0.6 + b.impact * 0.4;
    return scoreB - scoreA;
  });

  const initialSelected = positive.slice(0, 10);
  const initialReserves = positive.slice(10, 30);

  console.log('Generating wrapper copy...');
  const initialWrapperCopy = await generateWrapperCopy(initialSelected, weekId);
  console.log('✓ Generated wrapper copy');

  console.log('\n--- Pass 2: Self-review ---');
  const refined = await refineDraft(initialSelected, initialReserves, initialWrapperCopy, weekId);

  const draft: NewsletterDraft = {
    weekId,
    generatedAt: now,
    selected: refined.selected,
    reserves: refined.reserves,
    discarded,
    totalProcessed: processed.length,
    wrapperCopy: refined.wrapperCopy,
  };

  const draftPath = join(ROOT_DIR, 'data', 'drafts', `${weekId}.json`);
  writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf-8');

  console.log(`\nDraft saved to ${draftPath}`);
  console.log(
    `Selected: ${draft.selected.length}, Reserves: ${draft.reserves.length}, Discarded: ${discarded}`
  );
}

main().catch(console.error);
