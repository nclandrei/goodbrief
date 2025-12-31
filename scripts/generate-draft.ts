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
    let text = result.response
      .text()
      .replace(/```json\n?|\n?```/g, '')
      .trim();

    // Fix common JSON issues: trailing commas, truncated responses
    text = text
      .replace(/,\s*]/g, ']')
      .replace(/,\s*}/g, '}');

    // If JSON appears truncated, try to fix it
    const openBrackets = (text.match(/\[/g) || []).length;
    const closeBrackets = (text.match(/]/g) || []).length;
    if (openBrackets > closeBrackets) {
      text += ']'.repeat(openBrackets - closeBrackets);
      if (!text.endsWith('}')) text += '}';
    }

    const parsed = JSON.parse(text) as {
      clusters: number[][];
      unique: number[];
    };

    const clusterMap = new Map<string, RawArticle[]>();
    const seenIndices = new Set<number>();

    parsed.clusters.forEach((cluster, idx) => {
      const clusterId = `cluster-${idx}`;
      const uniqueArticles = cluster
        .filter((i) => !seenIndices.has(i) && articles[i])
        .map((i) => {
          seenIndices.add(i);
          return articles[i];
        });
      if (uniqueArticles.length > 0) {
        clusterMap.set(clusterId, uniqueArticles);
      }
    });

    parsed.unique.forEach((idx) => {
      if (!seenIndices.has(idx) && articles[idx]) {
        seenIndices.add(idx);
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
  impact: number;
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

3. IMPACT SCORE (0-100) - How much does this story matter to our readers?
   This combines importance (significance) with relevance (how much our audience cares).
   Our audience: educated Romanians aged 20-30 who care about their communities, progress, and meaningful change.
   
   HIGH IMPACT (80-100):
   - Local community wins (new parks, hospitals, infrastructure in Romania)
   - Romanian achievements and innovations
   - Health/science breakthroughs that affect people's lives
   - Environmental progress in Romania or globally significant
   
   MEDIUM IMPACT (60-80):
   - Regional success stories
   - International news with clear Romanian relevance
   - Cultural/educational achievements
   
   LOW IMPACT (40-60):
   - Nice but distant stories (international feel-good with no Romanian connection)
   - Entertainment news, even if positive
   
   VERY LOW IMPACT (0-40):
   - Celebrity gossip, sports trivia
   - Stories that don't affect our readers' world
   
   Ask yourself: "Would a 25-year-old in Cluj/București share this with friends because it matters?"

4. CATEGORY (alege EXACT un singur string din lista de mai jos):

   REGULI GENERALE:
   - Gândește-te la TEMA principală a știrii, nu la lungime.
   - Verifică în ordine: green-stuff → local-heroes → wins → quick-hits.
   - Alege prima categorie care se potrivește clar.

   a) "green-stuff"
      - Mediu, sustenabilitate, natură, climă, animale.
      - Exemple: "Primăria plantează 10.000 de copaci", "Un sat trece pe energie solară"
      - Dacă tema principală e ecologică, alege "green-stuff" chiar dacă apare și un erou local.

   b) "local-heroes"
      - Povești centrate pe OAMENI sau grupuri mici care fac bine direct în comunitate.
      - Accentul e pe persoană/grup ca erou, NU pe eveniment mare sau instituție.
      - Exemple: "O profesoară strânge bani pentru rechizite", "Voluntari renovează un spital"
      - NU folosi pentru: festivaluri, târguri, proiecte mari de infrastructură, premii/recorduri.

   c) "wins"
      - Reușite, premii, recorduri, realizări notabile (comunitate, oraș, țară, internațional).
      - Include aici: evenimente culturale (festivaluri, expoziții, patrimoniu), infrastructură nouă.
      - Exemple: "Festival de film câștigă premiu", "Cluj deschide parc nou", "Săptămâna Haferland celebrează tradițiile săsești"

   d) "quick-hits"
      - Vești bune de IMPACT MIC sau FOARTE LOCAL / DE NIȘĂ.
      - Exemple: "Un bistro oferă cafea gratis studenților", "Un liceu își modernizează laboratorul"
      - Folosește doar dacă nu se potrivește clar la categoriile de mai sus.

Return ONLY valid JSON array: [{"id": "...", "summary": "...", "positivity": N, "impact": N, "category": "..."}, ...]

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

  // Step 4: Build processed articles (with deduplication by ID)
  const scoreMap = new Map(allScores.map((s) => [s.id, s]));
  const now = new Date().toISOString();
  const seenIds = new Set<string>();

  const processed: ProcessedArticle[] = representatives
    .map((raw) => {
      // Skip duplicates
      if (seenIds.has(raw.id)) return null;
      seenIds.add(raw.id);

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
        impact: score.impact,
        category: score.category,
        publishedAt: raw.publishedAt,
        processedAt: now,
      };
    })
    .filter((p): p is ProcessedArticle => p !== null);

  // Step 5: Filter and rank
  const positive = processed.filter((p) => p.positivity >= 40);
  const discarded = processed.length - positive.length;

  positive.sort((a, b) => {
    const scoreA = a.positivity * 0.6 + a.impact * 0.4;
    const scoreB = b.positivity * 0.6 + b.impact * 0.4;
    return scoreB - scoreA;
  });

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
