import { readFileSync, writeFileSync, existsSync } from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { RawArticle } from '../types.js';
import type { ArticleScore, GeminiOptions, GeminiCache } from './types.js';

function getArticleScoreSchema(includeReasoning: boolean) {
  const properties: Record<string, any> = {
    id: { type: 'string', description: 'Article ID' },
    summary: { type: 'string', description: 'Romanian summary 2-3 sentences' },
    positivity: { type: 'integer', description: 'Positivity score 0-100' },
    impact: { type: 'integer', description: 'Impact score 0-100' },
    romaniaRelevant: { type: 'boolean', description: 'Is the article about Romania' },
    category: {
      type: 'string',
      enum: ['local-heroes', 'wins', 'green-stuff', 'quick-hits'],
      description: 'Article category',
    },
  };

  const required = ['id', 'summary', 'positivity', 'impact', 'romaniaRelevant', 'category'];

  if (includeReasoning) {
    properties.reasoning = {
      type: 'string',
      description: 'Brief explanation of positivity and impact scores (2-3 sentences)',
    };
    required.push('reasoning');
  }

  return {
    type: 'array',
    items: {
      type: 'object',
      properties,
      required,
    },
  };
}

function getPrompt(articlesText: string, includeReasoning: boolean): string {
  const reasoningInstruction = includeReasoning
    ? `\n\n7. REASONING (2-3 sentences):
   Explain your positivity and impact scores. Why is this article positive? Why does it matter to our readers?`
    : '';

  const returnFormat = includeReasoning
    ? 'Return ONLY valid JSON array: [{"id": "...", "summary": "...", "positivity": N, "impact": N, "romaniaRelevant": true/false, "category": "...", "reasoning": "..."}, ...]'
    : 'Return ONLY valid JSON array: [{"id": "...", "summary": "...", "positivity": N, "impact": N, "romaniaRelevant": true/false, "category": "..."}, ...]';

  return `You are writing for Good Brief, a Romanian positive news newsletter for young educated Romanians (20-30).

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

5. ROMANIA RELEVANCE (true/false):
   Set to TRUE only if the article is about:
   - Events happening IN Romania
   - Romanian people, companies, or organizations
   - Topics directly affecting Romania or Romanians
   - Romanian diaspora achievements abroad
   
   Set to FALSE if:
   - International news with NO Romanian connection (e.g., "Zelensky visits hospital in Ukraine")
   - Foreign celebrities, politicians, or events not involving Romania
   - Global stories that just happened to be reported by Romanian media
   
   IMPORTANT: Just because a Romanian news outlet reported the story does NOT make it Romania-relevant.

6. CATEGORY (alege EXACT un singur string din lista de mai jos):

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
${reasoningInstruction}

${returnFormat}

Articles:
${articlesText}`;
}

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

function loadCache(cachePath: string): GeminiCache {
  if (existsSync(cachePath)) {
    try {
      return JSON.parse(readFileSync(cachePath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveCache(cachePath: string, cache: GeminiCache): void {
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

export async function processArticleBatch(
  articles: RawArticle[],
  model: any,
  includeReasoning: boolean = false
): Promise<ArticleScore[]> {
  const articlesText = articles
    .map(
      (a) =>
        `ID: ${a.id}\nTitle: ${a.title}\nContent: ${a.summary.slice(0, 300)}`
    )
    .join('\n\n---\n\n');

  const prompt = getPrompt(articlesText, includeReasoning);

  try {
    return await callWithRetry(async () => {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      return JSON.parse(text) as ArticleScore[];
    });
  } catch (error) {
    console.error('Batch processing failed after retries:', error);
    return [];
  }
}

export async function processArticles(
  articles: RawArticle[],
  options: GeminiOptions,
  apiKey: string
): Promise<ArticleScore[]> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const schema = getArticleScoreSchema(options.includeReasoning);
  
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    } as any,
  });

  const cache = options.useCache ? loadCache(options.cachePath) : {};
  const results: ArticleScore[] = [];
  const uncachedArticles: RawArticle[] = [];
  const uncachedIndices: number[] = [];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    if (options.useCache && cache[article.id]) {
      const cached = cache[article.id];
      results.push({
        id: cached.id,
        summary: cached.summary,
        positivity: cached.positivity,
        impact: cached.impact,
        romaniaRelevant: cached.romaniaRelevant,
        category: cached.category,
        reasoning: cached.reasoning,
      });
    } else {
      uncachedArticles.push(article);
      uncachedIndices.push(i);
    }
  }

  if (uncachedArticles.length > 0) {
    console.log(`Processing ${uncachedArticles.length} uncached articles...`);
    const BATCH_SIZE = 200;

    for (let i = 0; i < uncachedArticles.length; i += BATCH_SIZE) {
      const batch = uncachedArticles.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uncachedArticles.length / BATCH_SIZE)}...`
      );
      const scores = await processArticleBatch(batch, model, options.includeReasoning);
      
      for (const score of scores) {
        results.push(score);
        
        if (options.useCache) {
          cache[score.id] = {
            ...score,
            cachedAt: new Date().toISOString(),
          };
        }
      }

      if (i + BATCH_SIZE < uncachedArticles.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (options.useCache) {
      saveCache(options.cachePath, cache);
    }
  } else if (options.useCache) {
    console.log('All articles found in cache');
  }

  return results;
}

export function createGeminiModel(apiKey: string, includeReasoning: boolean = false) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const schema = getArticleScoreSchema(includeReasoning);
  
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    } as any,
  });
}
