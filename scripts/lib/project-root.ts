import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export function resolveProjectRoot(importMetaUrl: string, levelsUp: number = 1): string {
  const override = process.env.GOODBRIEF_ROOT_DIR?.trim();
  if (override) {
    return override;
  }

  const start = dirname(fileURLToPath(importMetaUrl));
  return resolve(start, ...Array.from({ length: levelsUp }, () => '..'));
}
