import { execFile } from 'child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ARCHIVE_GATE_FIXTURE = join(
  WORKSPACE_ROOT,
  'tests',
  'fixtures',
  'archive-gate'
);

export function getIsoWeekId(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7 + 1
  );
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

export function createTempProjectFromFixture(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-archive-gate-'));
  cpSync(join(ARCHIVE_GATE_FIXTURE, 'content'), join(tempRoot, 'content'), {
    recursive: true,
  });
  cpSync(join(ARCHIVE_GATE_FIXTURE, 'data'), join(tempRoot, 'data'), {
    recursive: true,
  });
  cpSync(join(ARCHIVE_GATE_FIXTURE, 'mocks'), join(tempRoot, 'mocks'), {
    recursive: true,
  });
  cpSync(join(ARCHIVE_GATE_FIXTURE, 'raw-articles.json'), join(tempRoot, 'raw-articles.json'));
  mkdirSync(join(tempRoot, 'data', 'raw'), { recursive: true });
  return tempRoot;
}

export function seedRawWeek(tempRoot: string, weekId: string): void {
  const rawArticles = JSON.parse(
    readFileSync(join(tempRoot, 'raw-articles.json'), 'utf-8')
  );

  writeFileSync(
    join(tempRoot, 'data', 'raw', `${weekId}.json`),
    JSON.stringify(
      {
        weekId,
        articles: rawArticles,
        lastUpdated: '2026-03-07T10:00:00.000Z',
      },
      null,
      2
    ),
    'utf-8'
  );
}

export async function runTypeScriptScript(
  scriptPath: string,
  args: string[],
  env: Record<string, string | undefined>
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, ['--import', 'tsx', scriptPath, ...args], {
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      ...env,
    },
  });
}
