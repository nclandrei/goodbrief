import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import type { NewsletterDraft, ProcessedArticle, ArticleCategory } from "./types.js";

function getMondayOfISOWeek(weekId: string): Date {
  // weekId format: "2026-W03"
  const [yearStr, weekStr] = weekId.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  
  // Jan 4th is always in week 1
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7; // Convert Sunday (0) to 7
  
  // Monday of week 1
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day + 1);
  
  // Add weeks to get to target week's Monday
  const targetMonday = new Date(week1Monday);
  targetMonday.setDate(week1Monday.getDate() + (week - 1) * 7);
  
  return targetMonday;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const ROMANIAN_MONTHS_SHORT = [
  "ian", "feb", "mar", "apr", "mai", "iun",
  "iul", "aug", "sep", "oct", "nov", "dec"
];

function formatDateRomanian(date: Date): string {
  const day = date.getDate();
  const month = ROMANIAN_MONTHS_SHORT[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function getIssueNumber(issuesDir: string): number {
  const files = readdirSync(issuesDir).filter((f) => f.endsWith(".md"));
  return files.length + 1;
}

const CATEGORY_CONFIG: Record<ArticleCategory, { emoji: string; title: string }> = {
  "local-heroes": { emoji: "🌱", title: "Local Heroes" },
  "wins": { emoji: "🏆", title: "Wins" },
  "green-stuff": { emoji: "💚", title: "Green Stuff" },
  "quick-hits": { emoji: "✨", title: "Quick Hits" },
};

function groupByCategory(articles: ProcessedArticle[]): Map<ArticleCategory, ProcessedArticle[]> {
  const groups = new Map<ArticleCategory, ProcessedArticle[]>();
  for (const article of articles) {
    const category = article.category || "wins";
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)!.push(article);
  }
  return groups;
}

function generateMarkdown(
  articles: ProcessedArticle[],
  issueNumber: number,
  date: string,
  displayDate: string,
  intro: string
): string {
  const grouped = groupByCategory(articles);
  const categoryOrder: ArticleCategory[] = ["local-heroes", "wins", "green-stuff", "quick-hits"];

  const sections: string[] = [];

  for (const category of categoryOrder) {
    const categoryArticles = grouped.get(category);
    if (!categoryArticles || categoryArticles.length === 0) continue;

    const config = CATEGORY_CONFIG[category];
    sections.push(`## ${config.emoji} ${config.title}`);

    for (const article of categoryArticles) {
      sections.push(`### ${article.originalTitle}
${article.summary}

→ [Citește pe ${article.sourceName}](${article.url})`);
    }
  }

  return `---
title: "Good Brief #${issueNumber} · ${displayDate}"
date: ${date}
summary: "${intro}"
---

${sections.join("\n\n")}
`;
}

function parseArgs(): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--week' && args[i + 1]) {
      return args[i + 1];
    }
  }
  return null;
}

function getLatestDraftWeekId(draftsDir: string): string | null {
  const files = readdirSync(draftsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  
  if (files.length === 0) return null;
  return files[0].replace(".json", "");
}

async function main() {
  const projectRoot = join(import.meta.dirname!, "..");
  const issuesDir = join(projectRoot, "content", "issues");
  const draftsDir = join(projectRoot, "data", "drafts");

  // Use --week arg if provided, otherwise find latest draft
  let weekId = parseArgs();
  if (!weekId) {
    weekId = getLatestDraftWeekId(draftsDir);
    if (!weekId) {
      console.error("Error: No draft files found in data/drafts/");
      process.exit(1);
    }
  }

  const draftPath = join(draftsDir, `${weekId}.json`);
  console.log(`Reading draft for week ${weekId}...`);

  let draft: NewsletterDraft;
  try {
    const content = readFileSync(draftPath, "utf-8");
    draft = JSON.parse(content);
  } catch {
    console.error(`Error: Could not read draft file at ${draftPath}`);
    process.exit(1);
  }

  if (draft.selected.length === 0) {
    console.error("Error: No selected articles in draft");
    process.exit(1);
  }

  if (draft.selected.length < 10) {
    console.warn(`Warning: Only ${draft.selected.length} selected articles (expected 10)`);
  }

  const issueNumber = getIssueNumber(issuesDir);
  // Issue is sent on Monday of the NEXT week after the draft week
  const draftMonday = getMondayOfISOWeek(weekId);
  const sendMonday = new Date(draftMonday);
  sendMonday.setDate(draftMonday.getDate() + 7);
  const dateStr = formatDate(sendMonday);
  const displayDate = formatDateRomanian(sendMonday);
  const filename = `${dateStr}-issue.md`;
  const outputPath = join(issuesDir, filename);

  if (!draft.wrapperCopy) {
    console.error("Error: Draft is missing wrapperCopy");
    process.exit(1);
  }
  const summary = draft.wrapperCopy.shortSummary || draft.wrapperCopy.intro;
  const markdown = generateMarkdown(draft.selected, issueNumber, dateStr, displayDate, summary);

  writeFileSync(outputPath, markdown, "utf-8");
  console.log(`Published issue #${issueNumber} to ${outputPath}`);
}

main();
