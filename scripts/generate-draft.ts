import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
  RawArticle,
  ProcessedArticle,
  WeeklyBuffer,
  NewsletterDraft,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: '	gemini-2.5-flash-lite',
});

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

async function clusterArticles(
  articles: RawArticle[]
): Promise<Map<string, RawArticle[]>> {
  const articlesText = articles
    .map((a, i) => `${i}: "${a.title}" - "${a.summary.slice(0, 200)}"`)
    .join('\n');

  const prompt = `Here are news articles from Romanian sources this week.
Group them by the same underlying story/event. Articles about the same event should be in the same cluster.
Return ONLY valid JSON, no markdown: { "clusters": [[0,5,12], [3,8], ...], "unique": [1,2,4,...] }

Articles:
${articlesText}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response
      .text()
      .replace(/```json\n?|\n?```/g, '')
      .trim();
    const parsed = JSON.parse(text) as {
      clusters: number[][];
      unique: number[];
    };

    const clusterMap = new Map<string, RawArticle[]>();

    parsed.clusters.forEach((cluster, idx) => {
      const clusterId = `cluster-${idx}`;
      clusterMap.set(
        clusterId,
        cluster.map((i) => articles[i]).filter(Boolean)
      );
    });

    parsed.unique.forEach((idx) => {
      if (articles[idx]) {
        clusterMap.set(`unique-${idx}`, [articles[idx]]);
      }
    });

    return clusterMap;
  } catch (error) {
    console.error('Clustering failed, treating all as unique:', error);
    const clusterMap = new Map<string, RawArticle[]>();
    articles.forEach((a, i) => clusterMap.set(`unique-${i}`, [a]));
    return clusterMap;
  }
}

interface ArticleScore {
  id: string;
  summary: string;
  positivity: number;
  category: 'local-heroes' | 'wins' | 'green-stuff' | 'quick-hits';
}

async function processArticleBatch(
  articles: RawArticle[]
): Promise<ArticleScore[]> {
  const articlesText = articles
    .map(
      (a) =>
        `ID: ${a.id}\nTitle: ${a.title}\nContent: ${a.summary.slice(0, 300)}`
    )
    .join('\n\n---\n\n');

  const prompt = `You are writing for Good Brief, a Romanian positive news newsletter for young educated Romanians (20-30).

VOICE & TONE:
- Sound like a smart friend sharing good news, NOT a news outlet
- Warm, calm, slightly witty – never cheesy or formal
- Use "tu" (informal), never "dumneavoastră"
- Romanian with occasional English sprinkles (max 1-2 English words per sentence)

For each article, provide:

1. SUMMARY (2-3 sentences in Romanian):
   - Start with the key fact (who did what)
   - Add context if needed (why it matters)
   - End with impact (what this means for people)
   - Avoid formal language ("potrivit surselor", "în cadrul", "menționăm că")
   - Example good: "Cluj-Napoca și-a redeschis parcul central după o renovare de 2 milioane de euro. Acum are piste de biciclete, spații de joacă noi și WiFi gratuit."
   - Example bad: "Potrivit surselor, autoritățile locale au finalizat lucrările de modernizare..."

2. POSITIVITY SCORE (0-100):
   - 80-100: Inspiring stories, community wins, innovation, good deeds
   - 60-80: Clear positive outcomes, achievements, progress
   - 40-60: Hopeful developments, mixed but positive
   - 0-40: Skip these (tragedy, crime, political conflict, scandals, celebrity gossip)

3. CATEGORY (one of):
   - "local-heroes": Inițiative locale, oameni care fac bine în comunități
   - "wins": Reușite, premii, recorduri, realizări notabile
   - "green-stuff": Mediu, sustenabilitate, natură
   - "quick-hits": Micro-vești bune (for shorter items)

Return ONLY valid JSON array: [{"id": "...", "summary": "...", "positivity": N, "category": "..."}, ...]

Articles:
${articlesText}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response
      .text()
      .replace(/```json\n?|\n?```/g, '')
      .trim();
    return JSON.parse(text) as ArticleScore[];
  } catch (error) {
    console.error('Batch processing failed:', error);
    return [];
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

  // Step 1: Cluster articles
  console.log('Clustering articles...');
  const clusters = await clusterArticles(buffer.articles);
  console.log(`Found ${clusters.size} unique stories`);

  // Step 2: Pick representative from each cluster and process
  const representatives: RawArticle[] = [];
  for (const articles of clusters.values()) {
    representatives.push(articles[0]);
  }

  // Step 3: Process in batches of 15
  const BATCH_SIZE = 15;
  const allScores: ArticleScore[] = [];

  for (let i = 0; i < representatives.length; i += BATCH_SIZE) {
    const batch = representatives.slice(i, i + BATCH_SIZE);
    console.log(
      `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(representatives.length / BATCH_SIZE)}...`
    );
    const scores = await processArticleBatch(batch);
    allScores.push(...scores);

    // Rate limiting: wait 1 second between batches
    if (i + BATCH_SIZE < representatives.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Step 4: Build processed articles
  const scoreMap = new Map(allScores.map((s) => [s.id, s]));
  const now = new Date().toISOString();

  const processed: ProcessedArticle[] = representatives
    .map((raw) => {
      const score = scoreMap.get(raw.id);
      if (!score) return null;
      return {
        id: raw.id,
        sourceId: raw.sourceId,
        sourceName: raw.sourceName,
        originalTitle: raw.title,
        url: raw.url,
        summary: score.summary,
        positivity: score.positivity,
        popularity: 50,
        category: score.category,
        publishedAt: raw.publishedAt,
        processedAt: now,
      };
    })
    .filter((p): p is ProcessedArticle => p !== null);

  // Step 5: Filter and rank
  const positive = processed.filter((p) => p.positivity >= 40);
  const discarded = processed.length - positive.length;

  positive.sort((a, b) => b.positivity - a.positivity);

  const draft: NewsletterDraft = {
    weekId,
    generatedAt: now,
    selected: positive.slice(0, 10),
    reserves: positive.slice(10, 30),
    discarded,
    totalProcessed: processed.length,
  };

  const draftPath = join(ROOT_DIR, 'data', 'drafts', `${weekId}.json`);
  writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf-8');

  console.log(`Draft saved to ${draftPath}`);
  console.log(
    `Selected: ${draft.selected.length}, Reserves: ${draft.reserves.length}, Discarded: ${discarded}`
  );
}

main().catch(console.error);
