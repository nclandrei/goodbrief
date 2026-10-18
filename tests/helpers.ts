import { execFile } from 'child_process';
import { cpSync, mkdtempSync } from 'fs';
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

export function createTempProjectFromFixture(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-archive-gate-'));
  cpSync(join(ARCHIVE_GATE_FIXTURE, 'content'), join(tempRoot, 'content'), {
    recursive: true,
  });
  cpSync(join(ARCHIVE_GATE_FIXTURE, 'data'), join(tempRoot, 'data'), {
    recursive: true,
  });
  return tempRoot;
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
