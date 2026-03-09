export type IssueValidationSource =
  | 'legacy-backfill'
  | 'validation-pipeline';

export interface IssueFrontmatterInput {
  title: string;
  date: string;
  summary: string;
  validated: boolean;
  validationSource: IssueValidationSource;
  validatedAt: string;
}

export interface IssueValidationMetadata {
  validated: boolean;
  validationSource: IssueValidationSource;
  validatedAt: string;
}

const FRONTMATTER_START = '---\n';
const FRONTMATTER_END = '\n---\n';

function stringifyYamlValue(value: string | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return JSON.stringify(value);
}

export function renderIssueFrontmatter(input: IssueFrontmatterInput): string {
  return [
    '---',
    `title: ${stringifyYamlValue(input.title)}`,
    `date: ${input.date}`,
    `summary: ${stringifyYamlValue(input.summary)}`,
    `validated: ${stringifyYamlValue(input.validated)}`,
    `validationSource: ${stringifyYamlValue(input.validationSource)}`,
    `validatedAt: ${stringifyYamlValue(input.validatedAt)}`,
    '---',
  ].join('\n');
}

export function upsertIssueValidationFrontmatter(
  markdown: string,
  metadata: IssueValidationMetadata
): string {
  if (!markdown.startsWith(FRONTMATTER_START)) {
    throw new Error('Issue markdown is missing frontmatter');
  }

  const endIndex = markdown.indexOf(FRONTMATTER_END, FRONTMATTER_START.length);
  if (endIndex === -1) {
    throw new Error('Issue markdown has unterminated frontmatter');
  }

  const frontmatter = markdown
    .slice(FRONTMATTER_START.length, endIndex)
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('validated:') &&
        !line.startsWith('validationSource:') &&
        !line.startsWith('validatedAt:')
    );
  const body = markdown.slice(endIndex + FRONTMATTER_END.length);
  const summaryIndex = frontmatter.findIndex((line) => line.startsWith('summary:'));
  const insertionIndex = summaryIndex === -1 ? frontmatter.length : summaryIndex + 1;

  frontmatter.splice(
    insertionIndex,
    0,
    `validated: ${stringifyYamlValue(metadata.validated)}`,
    `validationSource: ${stringifyYamlValue(metadata.validationSource)}`,
    `validatedAt: ${stringifyYamlValue(metadata.validatedAt)}`
  );

  return `${FRONTMATTER_START}${frontmatter.join('\n')}${FRONTMATTER_END}${body}`;
}
