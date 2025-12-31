import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ProcessedArticle } from "../../scripts/types";

export interface WrapperCopy {
  greeting: string;
  intro: string;
  signOff: string;
}

const PROMPT_PREFIX = `You are the voice of Good Brief, a Romanian positive news newsletter.

Brand voice:
- Calm, warm, slightly witty – never cheesy
- A smart friend who curates "vești bune", not a formal news outlet
- Low-medium energy, "slow news / slow living" vibe
- Direct second person ("tu", "îți"), avoid formal words

Language rules:
- Romanian is primary, English sprinkled sparingly
- Max 1-2 English words per sentence
- Avoid: formal Romanian, corporate language, clickbait, "Dumneavoastră"

Generate wrapper copy for the newsletter email. Output valid JSON only.`;

export async function generateWrapperCopy(
  articles: ProcessedArticle[],
  weekId: string
): Promise<WrapperCopy> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

  const articleSummaries = articles
    .slice(0, 10)
    .map((a, i) => `${i + 1}. [${a.category}] ${a.originalTitle}: ${a.summary}`)
    .join("\n");

  const prompt = `${PROMPT_PREFIX}

Generate wrapper copy for Good Brief newsletter week ${weekId}.

This week's articles:
${articleSummaries}

Generate JSON with:
1. "greeting" - Variation on "Bună dimineața!" (can include 👋)
2. "intro" - 2-3 sentences themed to this week's stories, friendly and engaging
3. "signOff" - Fresh closing message (can include 🙏), warm but not cheesy

Example format:
{
  "greeting": "Bună dimineața! 👋",
  "intro": "Săptămâna asta avem de toate: de la un ONG care a salvat o pădure întreagă, până la un startup românesc care cucerește Europa. Grab your coffee și hai să vedem ce vești bune avem.",
  "signOff": "Thanks for reading! Sperăm că ți-am făcut ziua puțin mai bună. 🙏"
}

Return only the JSON object, no markdown code blocks.`;

  const result = await model.generateContent(prompt);
  const content = result.response.text();

  if (!content) {
    throw new Error("No response from Gemini");
  }

  try {
    const cleanedContent = content
      .replace(/```json\n?|\n?```/g, "")
      .trim();
    const parsed = JSON.parse(cleanedContent) as WrapperCopy;
    if (!parsed.greeting || !parsed.intro || !parsed.signOff) {
      throw new Error("Missing required fields in response");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse AI response: ${content}`);
  }
}
