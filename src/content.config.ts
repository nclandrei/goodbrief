import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const issues = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/issues' }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    summary: z.string(),
  }),
});

export const collections = { issues };
