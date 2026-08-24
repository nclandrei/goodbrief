import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKSPACE_ROOT, runTypeScriptScript } from './helpers.js';
import {
  getExpectedDeliveryWeek,
  getExpectedPreparationWeek,
  getNewsletterDeliveryAt,
  getSchedulableNewsletterDeliveryAt,
  resolveAutomatedNewsletterPreparation,
} from '../scripts/lib/newsletter-schedule.js';

test('workflow prepares multiple times and delegates the exact 09:00 delivery to Resend', () => {
  const workflow = readFileSync(
    join(WORKSPACE_ROOT, '.github', 'workflows', 'send-newsletter.yml'),
    'utf-8'
  );

  for (const cron of ['17 20 * * 0', '17 23 * * 0', '17 6 * * 1']) {
    assert.match(
      workflow,
      new RegExp(
        `cron: ['"]${cron.replace(/\*/g, '\\*')}['"]\\s*\\n\\s*timezone: ['"]Europe/Bucharest['"]`
      )
    );
  }
  assert.match(workflow, /--schedule-at \$\{\{ steps\.schedule\.outputs\.scheduled_at \}\}/);
  assert.match(workflow, /group: send-newsletter-production/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /Pin the approved draft snapshot/);
  assert.match(workflow, /hold-newsletter-delivery\.ts/);
  assert.match(workflow, /PINNED_DRAFT_BLOB/);
  assert.doesNotMatch(workflow, /LATEST_DRAFT/);
  assert.doesNotMatch(workflow, /Publish issue to website|npm run publish-issue/);
  assert.doesNotMatch(workflow, /cron: ['"](?:0 9|17 3) \* \* 1['"]/);
});

test('website publication waits for a matching sent Resend broadcast', () => {
  const workflow = readFileSync(
    join(WORKSPACE_ROOT, '.github', 'workflows', 'publish-newsletter.yml'),
    'utf-8'
  );

  assert.match(workflow, /cron: ['"]30 9 \* \* 1['"]\s*\n\s*timezone: ['"]Europe\/Bucharest['"]/);
  assert.match(workflow, /cron: ['"]30 10 \* \* 1['"]\s*\n\s*timezone: ['"]Europe\/Bucharest['"]/);
  assert.match(workflow, /verify-newsletter-delivery\.ts/);
  assert.match(
    workflow,
    /if: steps\.delivery\.outputs\.ready_to_publish == 'true'/
  );
  assert.match(workflow, /npm run publish-issue/);
  assert.match(workflow, /record-newsletter-published\.ts/);
  assert.match(workflow, /ALLOW_PENDING_EVENT/);
  assert.match(workflow, /TZ=Europe\/Bucharest date \+%H%M/);
  assert.match(workflow, /\[ "\$local_time" -lt 1030 \]/);
  assert.match(workflow, /PINNED_DRAFT_BLOB/);
  assert.match(workflow, /Open a GitHub incident if email alerting failed/);
});

test('delivery is Monday at 09:00 Bucharest time in winter and summer', () => {
  assert.equal(
    getNewsletterDeliveryAt('2026-W02').toISOString(),
    '2026-01-12T07:00:00.000Z'
  );
  assert.equal(
    getNewsletterDeliveryAt('2026-W28').toISOString(),
    '2026-07-13T06:00:00.000Z'
  );
});

test('delivery follows Bucharest DST at both annual transitions', () => {
  assert.equal(
    getNewsletterDeliveryAt('2026-W12').toISOString(),
    '2026-03-23T07:00:00.000Z'
  );
  assert.equal(
    getNewsletterDeliveryAt('2026-W13').toISOString(),
    '2026-03-30T06:00:00.000Z'
  );
  assert.equal(
    getNewsletterDeliveryAt('2026-W42').toISOString(),
    '2026-10-19T06:00:00.000Z'
  );
  assert.equal(
    getNewsletterDeliveryAt('2026-W43').toISOString(),
    '2026-10-26T07:00:00.000Z'
  );
});

test('delivery date crosses the ISO year boundary safely', () => {
  assert.equal(
    getNewsletterDeliveryAt('2026-W53').toISOString(),
    '2027-01-04T07:00:00.000Z'
  );
  assert.throws(() => getNewsletterDeliveryAt('2025-W53'), /Invalid ISO week/);
});

test('automated preparation chooses one exact edition on Sunday and delayed Monday', () => {
  const sunday = new Date('2026-08-23T17:17:00.000Z');
  const mondayBeforeCutoff = new Date('2026-08-24T02:00:00.000Z');

  assert.equal(getExpectedPreparationWeek(sunday), '2026-W34');
  assert.equal(getExpectedPreparationWeek(mondayBeforeCutoff), '2026-W34');
  assert.deepEqual(resolveAutomatedNewsletterPreparation(sunday), {
    weekId: '2026-W34',
    scheduledAt: '2026-08-24T06:00:00.000Z',
  });
  assert.throws(
    () => getExpectedPreparationWeek(new Date('2026-08-25T06:00:00.000Z')),
    /only on Sunday or Monday/
  );
});

test('Monday verification chooses the preceding ISO week', () => {
  assert.equal(
    getExpectedDeliveryWeek(new Date('2026-08-24T07:30:00.000Z')),
    '2026-W34'
  );
  assert.throws(
    () => getExpectedDeliveryWeek(new Date('2026-08-25T07:30:00.000Z')),
    /only on Monday/
  );
});

test('scheduled automation permits exactly 15 minutes of lead and fails below it', () => {
  assert.equal(
    getSchedulableNewsletterDeliveryAt(
      '2026-W28',
      new Date('2026-07-13T05:45:00.000Z')
    ),
    '2026-07-13T06:00:00.000Z'
  );
  assert.throws(
    () =>
      getSchedulableNewsletterDeliveryAt(
        '2026-W28',
        new Date('2026-07-13T05:45:00.001Z')
      ),
    /less than 15 minutes away or has already passed/
  );
});

test('schedule resolver requires manual runs to name the exact week', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-schedule-resolver-'));
  const outputPath = join(tempRoot, 'output.txt');
  await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'resolve-newsletter-schedule.ts'),
    ['--phase', 'prepare', '--week', '2026-W34'],
    {
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GOODBRIEF_SCHEDULE_NOW: '2026-08-23T17:17:00.000Z',
      GITHUB_OUTPUT: outputPath,
    }
  );
  const output = readFileSync(outputPath, 'utf-8');
  assert.match(output, /week_id=2026-W34/);
  assert.match(output, /scheduled_at=2026-08-24T06:00:00.000Z/);

  await assert.rejects(
    runTypeScriptScript(
      join(WORKSPACE_ROOT, 'scripts', 'resolve-newsletter-schedule.ts'),
      ['--phase', 'prepare', '--week', ''],
      {
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GOODBRIEF_SCHEDULE_NOW: '2026-08-23T17:17:00.000Z',
      }
    ),
    /require an explicit --week/
  );
});

test('verification resolver maps a scheduled Monday run to the prior ISO week', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'goodbrief-verify-resolver-'));
  const outputPath = join(tempRoot, 'output.txt');
  await runTypeScriptScript(
    join(WORKSPACE_ROOT, 'scripts', 'resolve-newsletter-schedule.ts'),
    ['--phase', 'verify', '--week', ''],
    {
      GITHUB_EVENT_NAME: 'schedule',
      GOODBRIEF_SCHEDULE_NOW: '2026-08-24T07:45:00.000Z',
      GITHUB_OUTPUT: outputPath,
    }
  );

  const output = readFileSync(outputPath, 'utf-8');
  assert.match(output, /week_id=2026-W34/);
  assert.match(output, /scheduled_at=2026-08-24T06:00:00.000Z/);
});
