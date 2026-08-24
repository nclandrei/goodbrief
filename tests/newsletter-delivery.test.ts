import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDesiredNewsletterDelivery,
  getNewsletterBroadcastName,
  holdNewsletterDelivery,
  reconcileNewsletterDelivery,
  verifyNewsletterDelivery,
  type DesiredNewsletterDelivery,
  type NewsletterBroadcastContent,
  type NewsletterBroadcastGateway,
  type NewsletterDeliveryManifest,
  type NewsletterRemoteBroadcast,
} from '../scripts/lib/newsletter-delivery.js';
import { getNewsletterDeliverySha256 } from '../scripts/lib/newsletter-email.js';

class FakeGateway implements NewsletterBroadcastGateway {
  readonly broadcasts = new Map<string, NewsletterRemoteBroadcast>();
  readonly calls: string[] = [];
  failCreateAfterEffect = false;
  failScheduleAfterEffect = false;
  transientNullGets = 0;
  staleReadsAfterSchedule = 0;
  private staleScheduledSnapshot?: NewsletterRemoteBroadcast;
  private nextId = 1;

  async list(): Promise<NewsletterRemoteBroadcast[]> {
    this.calls.push('list');
    return [...this.broadcasts.values()].map((item) => structuredClone(item));
  }

  async get(id: string): Promise<NewsletterRemoteBroadcast | null> {
    this.calls.push(`get:${id}`);
    if (this.transientNullGets > 0) {
      this.transientNullGets -= 1;
      return null;
    }
    if (this.staleReadsAfterSchedule > 0 && this.staleScheduledSnapshot?.id === id) {
      this.staleReadsAfterSchedule -= 1;
      return structuredClone(this.staleScheduledSnapshot);
    }
    const item = this.broadcasts.get(id);
    return item ? structuredClone(item) : null;
  }

  async create(content: NewsletterBroadcastContent): Promise<{ id: string }> {
    this.calls.push('create');
    const id = `broadcast-${this.nextId++}`;
    this.broadcasts.set(id, {
      id,
      name: content.name,
      segmentId: content.segmentId,
      from: content.from,
      replyTo: [...content.replyTo],
      subject: content.subject,
      html: content.html,
      status: 'draft',
      scheduledAt: null,
      sentAt: null,
      createdAt: '2026-08-23T17:17:00.000Z',
    });
    if (this.failCreateAfterEffect) {
      this.failCreateAfterEffect = false;
      throw new Error('socket closed after create');
    }
    return { id };
  }

  async update(id: string, content: NewsletterBroadcastContent): Promise<void> {
    this.calls.push(`update:${id}`);
    const item = this.require(id);
    Object.assign(item, {
      name: content.name,
      segmentId: content.segmentId,
      from: content.from,
      replyTo: [...content.replyTo],
      subject: content.subject,
      html: content.html,
    });
  }

  async schedule(id: string, scheduledAt: string): Promise<void> {
    this.calls.push(`schedule:${id}`);
    const item = this.require(id);
    this.staleScheduledSnapshot = structuredClone(item);
    item.status = 'scheduled';
    item.scheduledAt = scheduledAt;
    if (this.failScheduleAfterEffect) {
      this.failScheduleAfterEffect = false;
      throw new Error('socket closed after schedule');
    }
  }

  async cancel(id: string): Promise<void> {
    this.calls.push(`cancel:${id}`);
    const item = this.require(id);
    if (item.status !== 'scheduled') {
      throw new Error(`cannot cancel ${item.status}`);
    }
    item.status = 'draft';
    item.scheduledAt = null;
  }

  private require(id: string): NewsletterRemoteBroadcast {
    const item = this.broadcasts.get(id);
    if (!item) {
      throw new Error(`missing ${id}`);
    }
    return item;
  }
}

function desired(
  html = '<p>Approved newsletter</p>',
  segmentId = 'segment-1'
): DesiredNewsletterDelivery {
  const subject = 'Good Brief test';
  return createDesiredNewsletterDelivery({
    weekId: '2026-W34',
    segmentId,
    scheduledAt: '2026-08-24T06:00:00.000Z',
    subject,
    html,
    deliverySha256: getNewsletterDeliverySha256(subject, html),
  });
}

const noSleep = async () => {};

test('new delivery creates, schedules, verifies, and records one stable broadcast', async () => {
  const gateway = new FakeGateway();
  const manifest = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    now: new Date('2026-08-23T17:17:00.000Z'),
    sleep: noSleep,
  });

  assert.equal(manifest.broadcastName, getNewsletterBroadcastName('2026-W34'));
  assert.equal(manifest.remoteStatus, 'scheduled');
  assert.equal(manifest.scheduledAt, '2026-08-24T06:00:00.000Z');
  assert.equal(gateway.broadcasts.size, 1);
  assert.equal(gateway.calls.filter((call) => call === 'create').length, 1);
  assert.equal(
    gateway.calls.filter((call) => call.startsWith('schedule:')).length,
    1
  );
});

test('rerun is idempotent and never sends or creates another broadcast', async () => {
  const gateway = new FakeGateway();
  const first = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    sleep: noSleep,
  });
  gateway.calls.length = 0;

  const second = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    manifest: first,
    sleep: noSleep,
  });

  assert.equal(second.broadcastId, first.broadcastId);
  assert.equal(gateway.broadcasts.size, 1);
  assert.doesNotMatch(gateway.calls.join(','), /create|schedule|update|cancel/);
  assert.ok(gateway.calls.includes('list'));
});

test('a transient missing response for a persisted broadcast never creates a replacement', async () => {
  const gateway = new FakeGateway();
  const manifest = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    sleep: noSleep,
  });
  gateway.calls.length = 0;
  gateway.transientNullGets = 1;

  const reconciled = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    manifest,
    sleep: noSleep,
  });

  assert.equal(reconciled.broadcastId, manifest.broadcastId);
  assert.equal(gateway.broadcasts.size, 1);
  assert.doesNotMatch(gateway.calls.join(','), /create|schedule|update|cancel/);
  assert.ok(gateway.calls.includes('list'));
});

test('a permanently missing persisted broadcast fails closed', async () => {
  const gateway = new FakeGateway();
  const manifest = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    sleep: noSleep,
  });
  gateway.broadcasts.delete(manifest.broadcastId);
  gateway.calls.length = 0;

  await assert.rejects(
    reconcileNewsletterDelivery({
      desired: desired(),
      gateway,
      manifest,
      sleep: noSleep,
    }),
    /does not exist/
  );
  assert.doesNotMatch(gateway.calls.join(','), /list|create|schedule|update|cancel/);
});

test('after the cutoff, an already-correct schedule is verified without mutation', async () => {
  const gateway = new FakeGateway();
  const manifest = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    sleep: noSleep,
  });
  gateway.calls.length = 0;

  const reconciled = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    manifest,
    allowMutations: false,
    sleep: noSleep,
  });

  assert.equal(reconciled.broadcastId, manifest.broadcastId);
  assert.doesNotMatch(gateway.calls.join(','), /create|schedule|update|cancel/);
});

test('after the cutoff, missing or changed broadcasts fail without mutation', async () => {
  const missingGateway = new FakeGateway();
  await assert.rejects(
    reconcileNewsletterDelivery({
      desired: desired(),
      gateway: missingGateway,
      allowMutations: false,
      sleep: noSleep,
    }),
    /cutoff has passed/
  );
  assert.doesNotMatch(
    missingGateway.calls.join(','),
    /create|schedule|update|cancel/
  );

  const changedGateway = new FakeGateway();
  const manifest = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway: changedGateway,
    sleep: noSleep,
  });
  changedGateway.calls.length = 0;
  await assert.rejects(
    reconcileNewsletterDelivery({
      desired: desired('<p>Late change</p>'),
      gateway: changedGateway,
      manifest,
      allowMutations: false,
      sleep: noSleep,
    }),
    /cutoff has passed/
  );
  assert.doesNotMatch(
    changedGateway.calls.join(','),
    /create|schedule|update|cancel/
  );
});

test('an approved final edit cancels, updates, and reschedules the same broadcast', async () => {
  const gateway = new FakeGateway();
  const first = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    sleep: noSleep,
  });
  gateway.calls.length = 0;

  const changed = desired('<p>Approved final correction</p>');
  const second = await reconcileNewsletterDelivery({
    desired: changed,
    gateway,
    manifest: first,
    sleep: noSleep,
  });

  assert.equal(second.broadcastId, first.broadcastId);
  assert.equal(second.deliverySha256, changed.deliverySha256);
  assert.deepEqual(
    gateway.calls.filter((call) => /^(cancel|update|schedule):/.test(call)),
    [
      `cancel:${first.broadcastId}`,
      `update:${first.broadcastId}`,
      `schedule:${first.broadcastId}`,
    ]
  );
  assert.equal(gateway.broadcasts.size, 1);
});

test('a concurrent source change can place the scheduled snapshot on hold', async () => {
  const gateway = new FakeGateway();
  const manifest = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    sleep: noSleep,
  });
  gateway.calls.length = 0;

  const held = await holdNewsletterDelivery({
    gateway,
    manifest,
    sleep: noSleep,
  });

  assert.equal(held.broadcastId, manifest.broadcastId);
  assert.equal(held.remoteStatus, 'draft');
  assert.equal(gateway.broadcasts.get(manifest.broadcastId)!.status, 'draft');
  assert.equal(
    gateway.calls.filter((call) => call === `cancel:${manifest.broadcastId}`)
      .length,
    1
  );
});

test('queued or sent content cannot be replaced or duplicated', async () => {
  for (const status of ['queued', 'sent'] as const) {
    const gateway = new FakeGateway();
    const manifest = await reconcileNewsletterDelivery({
      desired: desired(),
      gateway,
      sleep: noSleep,
    });
    gateway.broadcasts.get(manifest.broadcastId)!.status = status;
    gateway.calls.length = 0;

    await assert.rejects(
      reconcileNewsletterDelivery({
        desired: desired('<p>Too late to edit</p>'),
        gateway,
        manifest,
        sleep: noSleep,
      }),
      new RegExp(`already ${status}`)
    );
    assert.doesNotMatch(gateway.calls.join(','), /create|schedule|update|cancel/);
  }
});

test('ambiguous create and schedule responses reconcile provider state without duplicates', async () => {
  const gateway = new FakeGateway();
  gateway.failCreateAfterEffect = true;
  gateway.failScheduleAfterEffect = true;

  const manifest = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    sleep: noSleep,
  });

  assert.equal(manifest.remoteStatus, 'scheduled');
  assert.equal(gateway.broadcasts.size, 1);
  assert.equal(gateway.calls.filter((call) => call === 'create').length, 1);
  assert.equal(
    gateway.calls.filter((call) => call.startsWith('schedule:')).length,
    1
  );
  assert.ok(gateway.calls.includes('list'));
});

test('provider state polling tolerates stale reads after scheduling', async () => {
  const gateway = new FakeGateway();
  gateway.staleReadsAfterSchedule = 2;

  const manifest = await reconcileNewsletterDelivery({
    desired: desired(),
    gateway,
    sleep: noSleep,
  });

  assert.equal(manifest.remoteStatus, 'scheduled');
  assert.equal(gateway.broadcasts.size, 1);
  assert.ok(
    gateway.calls.filter((call) => call === `get:${manifest.broadcastId}`).length >=
      3
  );
});

test('multiple broadcasts with the stable name fail closed', async () => {
  const gateway = new FakeGateway();
  const content = desired();
  await gateway.create(content);
  await gateway.create(content);
  gateway.calls.length = 0;

  await assert.rejects(
    reconcileNewsletterDelivery({
      desired: content,
      gateway,
      sleep: noSleep,
    }),
    /Found 2 Resend broadcasts/
  );
  assert.doesNotMatch(gateway.calls.join(','), /create|schedule|update|cancel/);
});

test('a manifest also fails closed when another stable-name broadcast exists', async () => {
  const gateway = new FakeGateway();
  const content = desired();
  const manifest = await reconcileNewsletterDelivery({
    desired: content,
    gateway,
    sleep: noSleep,
  });
  await gateway.create(content);
  gateway.calls.length = 0;

  await assert.rejects(
    reconcileNewsletterDelivery({
      desired: content,
      gateway,
      manifest,
      sleep: noSleep,
    }),
    /Found 2 Resend broadcasts/
  );
  assert.doesNotMatch(gateway.calls.join(','), /create|schedule|update|cancel/);
});

test('a manifest pins the subscriber segment and delivery time', async () => {
  const gateway = new FakeGateway();
  const content = desired();
  const manifest = await reconcileNewsletterDelivery({
    desired: content,
    gateway,
    sleep: noSleep,
  });
  gateway.calls.length = 0;

  await assert.rejects(
    reconcileNewsletterDelivery({
      desired: desired('<p>Approved newsletter</p>', 'segment-2'),
      gateway,
      manifest,
      sleep: noSleep,
    }),
    /manifest identity does not match/i
  );
  await assert.rejects(
    reconcileNewsletterDelivery({
      desired: {
        ...content,
        scheduledAt: '2026-08-24T07:00:00.000Z',
      },
      gateway,
      manifest,
      sleep: noSleep,
    }),
    /manifest identity does not match/i
  );
  assert.doesNotMatch(gateway.calls.join(','), /create|schedule|update|cancel/);
});

test('publication requires a matching provider broadcast confirmed sent', async () => {
  const gateway = new FakeGateway();
  const content = desired();
  const manifest = await reconcileNewsletterDelivery({
    desired: content,
    gateway,
    sleep: noSleep,
  });

  const pending = await verifyNewsletterDelivery({
    desired: content,
    gateway,
    manifest,
    allowPending: true,
    sleep: noSleep,
  });
  assert.equal(pending.readyToPublish, false);

  gateway.broadcasts.get(manifest.broadcastId)!.status = 'sent';
  gateway.broadcasts.get(manifest.broadcastId)!.sentAt =
    '2026-08-24T06:00:08.000Z';
  const sent = await verifyNewsletterDelivery({
    desired: content,
    gateway,
    manifest,
    allowPending: false,
    sleep: noSleep,
  });
  assert.equal(sent.readyToPublish, true);
  assert.equal(sent.manifest.remoteStatus, 'sent');
  assert.equal(sent.manifest.sentAt, '2026-08-24T06:00:08.000Z');
});

test('strict verification rejects pending and changed delivery state', async () => {
  const gateway = new FakeGateway();
  const content = desired();
  const manifest: NewsletterDeliveryManifest =
    await reconcileNewsletterDelivery({
      desired: content,
      gateway,
      sleep: noSleep,
    });

  await assert.rejects(
    verifyNewsletterDelivery({
      desired: content,
      gateway,
      manifest,
      allowPending: false,
      sleep: noSleep,
    }),
    /not confirmed sent/
  );

  gateway.broadcasts.get(manifest.broadcastId)!.html = '<p>Dashboard edit</p>';
  await assert.rejects(
    verifyNewsletterDelivery({
      desired: content,
      gateway,
      manifest,
      allowPending: true,
      sleep: noSleep,
    }),
    /no longer matches/
  );
});

test('sent verification requires a non-early provider timestamp', async () => {
  for (const sentAt of [null, '2026-08-24T05:59:59.000Z']) {
    const gateway = new FakeGateway();
    const content = desired();
    const manifest = await reconcileNewsletterDelivery({
      desired: content,
      gateway,
      sleep: noSleep,
    });
    const remote = gateway.broadcasts.get(manifest.broadcastId)!;
    remote.status = 'sent';
    remote.sentAt = sentAt;

    await assert.rejects(
      verifyNewsletterDelivery({
        desired: content,
        gateway,
        manifest,
        allowPending: false,
        sleep: noSleep,
      }),
      /sent (?:without a valid sent_at|at .* before its approved)/
    );
  }
});
