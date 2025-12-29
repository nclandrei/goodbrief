import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import type { NewsletterDraft, ProcessedArticle } from "./types.js";

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

function getIssueNumber(issuesDir: string): number {
  const files = readdirSync(issuesDir).filter((f) => f.endsWith(".md"));
  return files.length + 1;
}

function generateMarkdown(
  articles: ProcessedArticle[],
  issueNumber: number,
  date: string
): string {
  const articleSections = articles
    .map((article) => {
      return `## 🌟 ${article.originalTitle}
${article.summary}
[Citește mai mult →](${article.url}) · *${article.sourceName}*`;
    })
    .join("\n\n");

  return `---
title: "Good Brief #${issueNumber} - Ediția Săptămânală"
date: ${date}
summary: "Cele mai bune vești din România săptămâna aceasta."
---

Bun venit la **Good Brief**! Iată cele mai bune vești din România săptămâna aceasta.

${articleSections}

---

*Ai o poveste bună de împărtășit? Scrie-ne la hello@goodbrief.ro*
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
  } catch (error) {
    console.error(`Error: Could not read draft file at ${draftPath}`);
    process.exit(1);
  }

  if (draft.selected.length !== 10) {
    console.error(
      `Error: Expected 10 selected articles, got ${draft.selected.length}`
    );
    process.exit(1);
  }

  const issueNumber = getIssueNumber(issuesDir);
  const monday = getMondayOfWeek(now);
  const dateStr = formatDate(monday);
  const filename = `${dateStr}-issue.md`;
  const outputPath = join(issuesDir, filename);

  const markdown = generateMarkdown(draft.selected, issueNumber, dateStr);

  writeFileSync(outputPath, markdown, "utf-8");
  console.log(`Published issue #${issueNumber} to ${outputPath}`);
}

main();
