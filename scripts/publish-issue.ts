import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { NewsletterDraft, ProcessedArticle, ArticleCategory } from './types.js';
import { assertDraftValidated } from './lib/draft-delivery.js';
import { renderIssueFrontmatter } from './lib/issue-frontmatter.js';
import { getIssuePublicationInfo } from './lib/newsletter-week.js';
import { resolveProjectRoot } from './lib/project-root.js';

function getIssueNumber(issuesDir: string): number {
  const files = readdirSync(issuesDir).filter((f) => f.endsWith('.md'));
  return files.length + 1;
}

const CATEGORY_CONFIG: Record<ArticleCategory, { emoji: string; title: string }> = {
  'local-heroes': { emoji: '🌱', title: 'Local Heroes' },
  wins: { emoji: '🏆', title: 'Wins' },
  'green-stuff': { emoji: '💚', title: 'Green Stuff' },
  'quick-hits': { emoji: '✨', title: 'Quick Hits' },
};

function groupByCategory(articles: ProcessedArticle[]): Map<ArticleCategory, ProcessedArticle[]> {
  const groups = new Map<ArticleCategory, ProcessedArticle[]>();
  for (const article of articles) {
    const category = article.category || 'wins';
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
  intro: string,
  validatedAt: string
): string {
  const grouped = groupByCategory(articles);
  const categoryOrder: ArticleCategory[] = ['local-heroes', 'wins', 'green-stuff', 'quick-hits'];

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

  const frontmatter = renderIssueFrontmatter({
    title: `Good Brief #${issueNumber} · ${displayDate}`,
    date,
    summary: intro,
    validated: true,
    validationSource: 'validation-pipeline',
    validatedAt,
  });

  return `${frontmatter}

${sections.join('\n\n')}
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
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  
  if (files.length === 0) return null;
  return files[0].replace('.json', '');
}

async function main() {
  const projectRoot = resolveProjectRoot(import.meta.url);
  const issuesDir = join(projectRoot, 'content', 'issues');
  const draftsDir = join(projectRoot, 'data', 'drafts');

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

  try {
    assertDraftValidated(draft, "issue publishing");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (draft.selected.length < 10) {
    console.warn(`Warning: Only ${draft.selected.length} selected articles (expected 10)`);
  }

  const issueNumber = getIssueNumber(issuesDir);
  const issueInfo = getIssuePublicationInfo(projectRoot, weekId);

  if (existsSync(issueInfo.outputPath)) {
    console.log(`Issue already exists at ${issueInfo.outputPath}, skipping publish.`);
    return;
  }

  if (!draft.wrapperCopy) {
    console.error("Error: Draft is missing wrapperCopy");
    process.exit(1);
  }
  const summary = draft.wrapperCopy.shortSummary || draft.wrapperCopy.intro;
  const validatedAt = draft.validation?.checkedAt || draft.validation?.generatedAt;
  if (!validatedAt) {
    console.error('Error: Draft is missing validation timestamp');
    process.exit(1);
  }

  const markdown = generateMarkdown(
    draft.selected,
    issueNumber,
    issueInfo.date,
    issueInfo.displayDate,
    summary,
    validatedAt
  );

  writeFileSync(issueInfo.outputPath, markdown, 'utf-8');
  console.log(`Published issue #${issueNumber} to ${issueInfo.outputPath}`);
}

main();
