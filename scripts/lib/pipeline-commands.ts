import { spawn } from 'child_process';
import type { DraftPipelinePhase } from '../types.js';

export const PIPELINE_SCRIPT_BY_PHASE: Record<DraftPipelinePhase, string> = {
  prepare: 'pipeline:prepare',
  score: 'pipeline:score',
  'semantic-dedup': 'pipeline:semantic-dedup',
  'counter-signal-validate': 'pipeline:validate',
  select: 'pipeline:select',
  'wrapper-copy': 'pipeline:wrapper-copy',
  refine: 'pipeline:refine',
};

export const SATURDAY_PIPELINE_SCRIPTS = [
  PIPELINE_SCRIPT_BY_PHASE.prepare,
  PIPELINE_SCRIPT_BY_PHASE.score,
  PIPELINE_SCRIPT_BY_PHASE['semantic-dedup'],
  PIPELINE_SCRIPT_BY_PHASE['counter-signal-validate'],
  PIPELINE_SCRIPT_BY_PHASE.select,
  PIPELINE_SCRIPT_BY_PHASE['wrapper-copy'],
  PIPELINE_SCRIPT_BY_PHASE.refine,
] as const;

export const VERIFY_LOCAL_SCRIPTS = [
  ...SATURDAY_PIPELINE_SCRIPTS,
  'validate-draft',
  'validate-draft-freshness',
  'email:preview',
  'email:test',
  'notify-draft',
] as const;

interface RunScriptOptions {
  commandRootDir: string;
  dataRootDir: string;
  script: string;
  weekId: string;
}

function getArgsForScript(script: string, weekId: string): string[] {
  if (script === 'notify-draft') {
    return ['run', script, '--', weekId];
  }
  return ['run', script, '--', '--week', weekId];
}

export async function runNpmScript(options: RunScriptOptions): Promise<void> {
  const { commandRootDir, dataRootDir, script, weekId } = options;
  if (script === 'email:send' || script === 'publish-issue') {
    throw new Error(`Refusing to run forbidden command ${script}`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', getArgsForScript(script, weekId), {
      cwd: commandRootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        GOODBRIEF_ROOT_DIR: dataRootDir,
      },
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed: npm ${getArgsForScript(script, weekId).join(' ')}`));
      }
    });
    child.on('error', reject);
  });
}

export async function runScriptSequence(
  commandRootDir: string,
  dataRootDir: string,
  scripts: readonly string[],
  weekId: string
): Promise<void> {
  for (const script of scripts) {
    await runNpmScript({ commandRootDir, dataRootDir, script, weekId });
  }
}
