import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();

test('recover-week restores optional diagnostics and runs both validation gates', () => {
  const script = readFileSync(
    join(REPO_ROOT, 'scripts', 'recover-week.sh'),
    'utf-8'
  );

  assert.match(script, /--run-id/);
  assert.match(script, /gh run download/);
  assert.match(script, /pipeline-diagnostics-\$WEEK-/);
  assert.match(script, /BASH_SOURCE\[0\]/);
  assert.doesNotMatch(script, /git rev-parse --show-toplevel/);
  assert.match(script, /git lfs smudge/);
  assert.doesNotMatch(script, /git lfs pull/);
  assert.match(script, /validate-draft -- "\$\{VALIDATION_ARGS\[@\]\}"/);
  assert.match(script, /validate-draft-freshness/);
  assert.ok(
    script.indexOf('validate-draft -- "${VALIDATION_ARGS[@]}"') <
      script.indexOf('validate-draft-freshness -- "${VALIDATION_ARGS[@]}"'),
    'same-week validation should run before archive freshness validation'
  );
});
