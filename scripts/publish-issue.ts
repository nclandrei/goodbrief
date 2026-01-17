import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import type { NewsletterDraft, ProcessedArticle, ArticleCategory } from "./types.js";

function getISOWeekId(date: Date): string {
  const tempDate = new Date(date.getTime());
  tempDate.setHours(0, 0, 0, 0);
  tempDate.setDate(tempDate.getDate() + 3 - ((tempDate.getDay() + 6) % 7));
  const week1 = new Date(tempDate.getFullYear(), 0, 4);
  const weekNumber = Math.round(
    ((tempDate.getTime() - week1.getTime()) / 86400000 -
      3 +
      ((week1.getDay() + 6) % 7)) /
      7 +
      1
  );
  return `${tempDate.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
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

async function main() {
  const projectRoot = join(import.meta.dirname!, "..");
  const issuesDir = join(projectRoot, "content", "issues");
  const draftsDir = join(projectRoot, "data", "drafts");

  const now = new Date();
  const weekId = getISOWeekId(now);
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
  const monday = getMondayOfWeek(now);
  const dateStr = formatDate(monday);
  const displayDate = formatDateRomanian(monday);
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
