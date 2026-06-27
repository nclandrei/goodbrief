import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();

test('recover-week runs the draft freshness archive gate', () => {
  const script = readFileSync(
    join(REPO_ROOT, 'scripts', 'recover-week.sh'),
    'utf-8'
  );

  assert.match(script, /validate-draft-freshness/);
  assert.doesNotMatch(
    script,
    /npm run --silent validate-draft -- --week "\$WEEK" --llm claude-cli/
  );
});
