import { getCollection } from 'astro:content';

export async function getSortedIssues() {
  const issues = await getCollection('issues');
  return issues.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}
