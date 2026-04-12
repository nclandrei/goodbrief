import { readFileSync, writeFileSync, existsSync } from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { RawArticle } from '../types.js';
import type { ArticleScore, GeminiOptions, GeminiCache } from './types.js';

export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

function getArticleScoreSchema(includeReasoning: boolean) {
  const properties: Record<string, any> = {
    id: { type: 'string', description: 'Article ID' },
    summary: { type: 'string', description: 'Romanian summary 2-3 sentences' },
    positivity: { type: 'integer', description: 'Positivity score 0-100' },
    impact: {
      type: 'integer',
      description: 'Structural impact score 0-100 based on how significant the story is in Romania',
    },
    feltImpact: {
      type: 'integer',
      description: 'How directly a 20-30 year old Romanian would feel or care about this story soon',
    },
    certainty: {
      type: 'integer',
      description: 'How concrete and already real the positive outcome is, from speculative to already happening',
    },
    humanCloseness: {
      type: 'integer',
      description: 'How much the story is centered on people, communities, or tangible daily-life effects',
    },
    bureaucraticDistance: {
      type: 'integer',
      description: 'How much the story is a bureaucratic, policy, funding, or institutional process story',
    },
    promoRisk: {
      type: 'integer',
      description: 'How much the story reads like startup PR, a grant announcement, a call for applications, or promotional copy',
    },
    romaniaRelevant: { type: 'boolean', description: 'Is the article about Romania' },
    category: {
      type: 'string',
      enum: ['local-heroes', 'wins', 'green-stuff', 'quick-hits'],
      description: 'Article category',
    },
  };

  const required = [
    'id',
    'summary',
    'positivity',
    'impact',
    'feltImpact',
    'certainty',
    'humanCloseness',
    'bureaucraticDistance',
    'promoRisk',
    'romaniaRelevant',
    'category',
  ];

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

export function formatArticlesForScoring(articles: RawArticle[]): string {
  return articles
    .map(
      (a) =>
        `ID: ${a.id}\nTitle: ${a.title}\nContent: ${a.summary.slice(0, 300)}`
    )
    .join('\n\n---\n\n');
}

export function getScoringPrompt(articlesText: string, includeReasoning: boolean): string {
  return getPrompt(articlesText, includeReasoning);
}

export { getArticleScoreSchema, withDefaultSignals };

function getPrompt(articlesText: string, includeReasoning: boolean): string {
  const reasoningInstruction = includeReasoning
    ? `\n\n11. REASONING (2-3 sentences):
   Explain your scores briefly, especially whether the story is concrete or speculative, and whether it feels human or bureaucratic.`
    : '';

  const returnFormat = includeReasoning
    ? 'Return ONLY valid JSON array: [{"id": "...", "summary": "...", "positivity": N, "impact": N, "feltImpact": N, "certainty": N, "humanCloseness": N, "bureaucraticDistance": N, "promoRisk": N, "romaniaRelevant": true/false, "category": "...", "reasoning": "..."}, ...]'
    : 'Return ONLY valid JSON array: [{"id": "...", "summary": "...", "positivity": N, "impact": N, "feltImpact": N, "certainty": N, "humanCloseness": N, "bureaucraticDistance": N, "promoRisk": N, "romaniaRelevant": true/false, "category": "..."}, ...]';

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
   This is STRUCTURAL IMPACT: how significant the story is in Romania if it becomes real.
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
   
   Ask yourself: "How big is this for Romania if it is real?"

4. FELT IMPACT SCORE (0-100) - How directly would a 25-year-old in Cluj/București feel, care about, or share this soon?
   HIGH FELT IMPACT (80-100):
   - Tangible community improvements, everyday-life effects, people helped directly, visible local progress
   - Stories readers can imagine in real life, not just in a ministry slide deck

   LOW FELT IMPACT (0-40):
   - Distant institutional process updates
   - Abstract funding or strategy announcements without near-term lived effect

5. CERTAINTY SCORE (0-100) - How real and already underway is the positive outcome?
   HIGH CERTAINTY (80-100):
   - Already launched, already built, already started, already delivered
   - Concrete results with evidence on the ground

   MEDIUM CERTAINTY (50-80):
   - Officially approved or contract signed, but effects are still ahead

   LOW CERTAINTY (0-50):
   - Could happen, may receive funds, call for applications, plan, proposal, political promise

6. HUMAN CLOSENESS SCORE (0-100) - How centered is the story on people, communities, or daily life?
   HIGH HUMAN CLOSENESS (80-100):
   - Local heroes, volunteers, schools, neighborhoods, patients, families, community initiatives

   LOW HUMAN CLOSENESS (0-40):
   - Ministries, funding mechanisms, market moves, executive appointments, investor or policy process stories

7. BUREAUCRATIC DISTANCE SCORE (0-100) - How bureaucratic, institutional, or process-heavy is the story?
   HIGH BUREAUCRATIC DISTANCE (80-100):
   - Calls for projects, grant schemes, strategies, ministerial statements, policy processes, funding allocations not yet felt

   LOW BUREAUCRATIC DISTANCE (0-20):
   - Direct, tangible outcomes already visible to people

8. PROMO RISK SCORE (0-100) - How much does the story feel like PR, a grant announcement, or promotional copy?
   HIGH PROMO RISK (80-100):
   - Startup funding PR, executive hire PR, brand partnership news, “inscrieri deschise”, generic grant or call-for-applications copy

   LOW PROMO RISK (0-20):
   - Independent reporting on concrete outcomes that matter in public life

9. ROMANIA RELEVANCE (true/false):
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

10. CATEGORY (alege EXACT un singur string din lista de mai jos):

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

function withDefaultSignals(score: ArticleScore): ArticleScore {
  const defaultsByCategory = {
    'green-stuff': {
      feltImpact: 75,
      certainty: 78,
      humanCloseness: 70,
      bureaucraticDistance: 24,
      promoRisk: 12,
    },
    'local-heroes': {
      feltImpact: 82,
      certainty: 80,
      humanCloseness: 88,
      bureaucraticDistance: 12,
      promoRisk: 10,
    },
    wins: {
      feltImpact: 58,
      certainty: 66,
      humanCloseness: 42,
      bureaucraticDistance: 36,
      promoRisk: 22,
    },
    'quick-hits': {
      feltImpact: 62,
      certainty: 72,
      humanCloseness: 60,
      bureaucraticDistance: 28,
      promoRisk: 16,
    },
  } as const;

  const defaults = defaultsByCategory[score.category];

  return {
    ...score,
    feltImpact: score.feltImpact ?? defaults.feltImpact,
    certainty: score.certainty ?? defaults.certainty,
    humanCloseness: score.humanCloseness ?? defaults.humanCloseness,
    bureaucraticDistance: score.bureaucraticDistance ?? defaults.bureaucraticDistance,
    promoRisk: score.promoRisk ?? defaults.promoRisk,
  };
}

export class GeminiQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiQuotaError';
  }
}

function isQuotaError(error: unknown): boolean {
  const errorStr = String(error).toLowerCase();
  return (
    errorStr.includes('quota') ||
    errorStr.includes('rate limit') ||
    errorStr.includes('resource exhausted') ||
    errorStr.includes('429') ||
    errorStr.includes('403')
  );
}

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry quota errors - they won't recover
      if (isQuotaError(error)) {
        throw new GeminiQuotaError(lastError.message);
      }

      if (attempt < maxRetries - 1) {
        const baseDelay = Math.pow(2, attempt) * 2000;
        const jitter = baseDelay * (0.75 + Math.random() * 0.5); // ±25%
        console.log(
          `Attempt ${attempt + 1}/${maxRetries} failed (${lastError.message}), retrying in ${Math.round(jitter)}ms...`
        );
        await new Promise((r) => setTimeout(r, jitter));
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
  const mockPath = process.env.GOODBRIEF_GEMINI_SCORES_PATH;
  if (mockPath) {
    const parsed = JSON.parse(readFileSync(mockPath, 'utf-8')) as
      | ArticleScore[]
      | { scores?: ArticleScore[] };
    const scores = Array.isArray(parsed) ? parsed : parsed.scores || [];
    const scoresById = new Map(scores.map((score) => [score.id, score]));

    return articles
      .map((article) => scoresById.get(article.id))
      .map((score) => (score ? withDefaultSignals(score) : undefined))
      .filter((score): score is ArticleScore => score !== undefined);
  }

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
      return (JSON.parse(text) as ArticleScore[]).map(withDefaultSignals);
    });
  } catch (error) {
    // Re-throw quota errors so they can be handled by the caller
    if (error instanceof GeminiQuotaError) {
      throw error;
    }
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
    model: DEFAULT_GEMINI_MODEL,
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
        feltImpact: cached.feltImpact,
        certainty: cached.certainty,
        humanCloseness: cached.humanCloseness,
        bureaucraticDistance: cached.bureaucraticDistance,
        promoRisk: cached.promoRisk,
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
        const normalized = withDefaultSignals(score);
        results.push(normalized);
        
        if (options.useCache) {
          cache[normalized.id] = {
            ...normalized,
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
    model: DEFAULT_GEMINI_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    } as any,
  });
}
