import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Resend } from 'resend';
import { getNewsletterDeliverySha256 } from './newsletter-email.js';

export const NEWSLETTER_FROM = 'Good Brief <buna@goodbrief.ro>';
export const NEWSLETTER_REPLY_TO = ['hello@goodbrief.ro'];
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type NewsletterBroadcastStatus =
  | 'draft'
  | 'scheduled'
  | 'queued'
  | 'sent'
  | 'canceled';

export interface NewsletterRemoteBroadcast {
  id: string;
  name: string;
  segmentId: string | null;
  from: string | null;
  replyTo: string[];
  subject: string | null;
  html: string | null;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface NewsletterBroadcastContent {
  name: string;
  segmentId: string;
  from: string;
  replyTo: string[];
  subject: string;
  html: string;
}

export interface NewsletterBroadcastGateway {
  list(): Promise<NewsletterRemoteBroadcast[]>;
  get(id: string): Promise<NewsletterRemoteBroadcast | null>;
  create(content: NewsletterBroadcastContent): Promise<{ id: string }>;
  update(id: string, content: NewsletterBroadcastContent): Promise<void>;
  schedule(id: string, scheduledAt: string): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface NewsletterDeliveryManifest {
  version: 1;
  weekId: string;
  broadcastName: string;
  broadcastId: string;
  deliverySha256: string;
  segmentId: string;
  scheduledAt: string;
  remoteStatus: NewsletterBroadcastStatus;
  createdAt: string;
  reconciledAt: string;
  sentAt?: string;
  publishedAt?: string;
}

export interface DesiredNewsletterDelivery extends NewsletterBroadcastContent {
  weekId: string;
  deliverySha256: string;
  scheduledAt: string;
}

export interface ReconcileNewsletterDeliveryOptions {
  desired: DesiredNewsletterDelivery;
  gateway: NewsletterBroadcastGateway;
  manifest?: NewsletterDeliveryManifest;
  now?: Date;
  sleep?: (milliseconds: number) => Promise<void>;
  allowMutations?: boolean;
}

export interface VerifyNewsletterDeliveryOptions {
  desired: DesiredNewsletterDelivery;
  gateway: NewsletterBroadcastGateway;
  manifest: NewsletterDeliveryManifest;
  allowPending: boolean;
  now?: Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface HoldNewsletterDeliveryOptions {
  gateway: NewsletterBroadcastGateway;
  manifest: NewsletterDeliveryManifest;
  now?: Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface ResendErrorShape {
  message?: string;
  name?: string;
  statusCode?: number;
}

interface ResendResponse<T> {
  data: T | null;
  error: ResendErrorShape | null;
}

interface ResendBroadcastShape {
  id: string;
  name: string;
  segment_id: string | null;
  from?: string | null;
  reply_to?: string[] | null;
  subject?: string | null;
  html?: string | null;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
}

interface ResendBroadcastListShape {
  data: ResendBroadcastShape[];
  has_more: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeRemoteBroadcast(
  broadcast: ResendBroadcastShape
): NewsletterRemoteBroadcast {
  return {
    id: broadcast.id,
    name: broadcast.name,
    segmentId: broadcast.segment_id,
    from: broadcast.from ?? null,
    replyTo: broadcast.reply_to || [],
    subject: broadcast.subject ?? null,
    html: broadcast.html ?? null,
    status: broadcast.status,
    scheduledAt: broadcast.scheduled_at,
    sentAt: broadcast.sent_at,
    createdAt: broadcast.created_at,
  };
}

function isNotFound(error: ResendErrorShape): boolean {
  return (
    error.statusCode === 404 ||
    error.name === 'not_found' ||
    error.name === 'not_found_error'
  );
}

function assertResponse<T>(
  response: ResendResponse<T>,
  operation: string
): T {
  if (response.error || !response.data) {
    const detail = response.error?.message || response.error?.name || 'unknown error';
    throw new Error(`Resend ${operation} failed: ${detail}`);
  }
  return response.data;
}

export class ResendNewsletterBroadcastGateway
  implements NewsletterBroadcastGateway
{
  private readonly resend: Resend;
  private readonly requestTimeoutMs: number;

  constructor(apiKey: string, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    this.resend = new Resend(apiKey);
    this.requestTimeoutMs = requestTimeoutMs;
  }

  private async timed<T>(operation: string, promise: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Resend ${operation} timed out`)),
            this.requestTimeoutMs
          );
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  async list(): Promise<NewsletterRemoteBroadcast[]> {
    const broadcasts: NewsletterRemoteBroadcast[] = [];
    let after: string | undefined;

    for (let page = 0; page < 20; page += 1) {
      const response = (await this.timed(
        'list broadcasts',
        this.resend.broadcasts.list({ limit: 100, ...(after ? { after } : {}) })
      )) as unknown as ResendResponse<ResendBroadcastListShape>;
      const data = assertResponse(response, 'list broadcasts');
      broadcasts.push(...data.data.map(normalizeRemoteBroadcast));

      if (!data.has_more || data.data.length === 0) {
        return broadcasts;
      }
      after = data.data[data.data.length - 1].id;
    }

    throw new Error('Resend broadcast listing exceeded the pagination safety limit');
  }

  async get(id: string): Promise<NewsletterRemoteBroadcast | null> {
    const response = (await this.timed(
      `get broadcast ${id}`,
      this.resend.broadcasts.get(id)
    )) as unknown as ResendResponse<ResendBroadcastShape>;
    if (response.error) {
      if (isNotFound(response.error)) {
        return null;
      }
      assertResponse(response, `get broadcast ${id}`);
    }
    return normalizeRemoteBroadcast(
      assertResponse(response, `get broadcast ${id}`)
    );
  }

  async create(content: NewsletterBroadcastContent): Promise<{ id: string }> {
    const response = (await this.timed(
      'create broadcast',
      this.resend.broadcasts.create({
        name: content.name,
        segmentId: content.segmentId,
        from: content.from,
        replyTo: content.replyTo,
        subject: content.subject,
        html: content.html,
      })
    )) as unknown as ResendResponse<{ id: string }>;
    return assertResponse(response, 'create broadcast');
  }

  async update(id: string, content: NewsletterBroadcastContent): Promise<void> {
    const response = (await this.timed(
      `update broadcast ${id}`,
      this.resend.broadcasts.update(id, {
        name: content.name,
        segmentId: content.segmentId,
        from: content.from,
        replyTo: content.replyTo,
        subject: content.subject,
        html: content.html,
      })
    )) as unknown as ResendResponse<{ id: string }>;
    assertResponse(response, `update broadcast ${id}`);
  }

  async schedule(id: string, scheduledAt: string): Promise<void> {
    const response = (await this.timed(
      `schedule broadcast ${id}`,
      this.resend.broadcasts.send(id, { scheduledAt })
    )) as unknown as ResendResponse<{ id: string }>;
    assertResponse(response, `schedule broadcast ${id}`);
  }

  async cancel(id: string): Promise<void> {
    const response = (await this.timed(
      `cancel broadcast ${id}`,
      this.resend.broadcasts.cancel(id)
    )) as unknown as ResendResponse<{ id: string }>;
    assertResponse(response, `cancel broadcast ${id}`);
  }
}

export function getNewsletterBroadcastName(weekId: string): string {
  return `goodbrief-prod-${weekId}`;
}

export function createDesiredNewsletterDelivery(options: {
  weekId: string;
  segmentId: string;
  scheduledAt: string;
  subject: string;
  html: string;
  deliverySha256: string;
}): DesiredNewsletterDelivery {
  const calculatedHash = getNewsletterDeliverySha256(
    options.subject,
    options.html
  );
  if (calculatedHash !== options.deliverySha256) {
    throw new Error(
      `Approved delivery hash mismatch for ${options.weekId}; refusing to construct a broadcast.`
    );
  }

  return {
    ...options,
    name: getNewsletterBroadcastName(options.weekId),
    from: NEWSLETTER_FROM,
    replyTo: NEWSLETTER_REPLY_TO,
  };
}

function normalizeIsoTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
}

function equalStringArrays(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function getRemoteDeliverySha256(
  remote: NewsletterRemoteBroadcast
): string | null {
  if (!remote.subject || !remote.html) {
    return null;
  }
  return getNewsletterDeliverySha256(remote.subject, remote.html);
}

function contentMatches(
  remote: NewsletterRemoteBroadcast,
  desired: DesiredNewsletterDelivery
): boolean {
  return (
    remote.name === desired.name &&
    remote.segmentId === desired.segmentId &&
    remote.from === desired.from &&
    equalStringArrays(remote.replyTo, desired.replyTo) &&
    getRemoteDeliverySha256(remote) === desired.deliverySha256
  );
}

function scheduleMatches(
  remote: NewsletterRemoteBroadcast,
  desired: DesiredNewsletterDelivery
): boolean {
  return normalizeIsoTimestamp(remote.scheduledAt) === desired.scheduledAt;
}

function assertValidSentAt(
  remote: NewsletterRemoteBroadcast,
  desired: DesiredNewsletterDelivery
): string {
  const sentAt = normalizeIsoTimestamp(remote.sentAt);
  if (!sentAt || Number.isNaN(new Date(sentAt).getTime())) {
    throw new Error(
      `Resend marks broadcast ${remote.id} sent without a valid sent_at timestamp.`
    );
  }
  if (new Date(sentAt).getTime() < new Date(desired.scheduledAt).getTime()) {
    throw new Error(
      `Resend marks broadcast ${remote.id} sent at ${sentAt}, before its approved ${desired.scheduledAt} delivery time.`
    );
  }
  return sentAt;
}

function normalizeStatus(status: string): NewsletterBroadcastStatus {
  if (
    status === 'draft' ||
    status === 'scheduled' ||
    status === 'queued' ||
    status === 'sent' ||
    status === 'canceled'
  ) {
    return status;
  }
  throw new Error(`Unsupported Resend broadcast status: ${status}`);
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function retryRead<T>(
  operation: string,
  read: () => Promise<T>,
  sleep: (milliseconds: number) => Promise<void>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await sleep(250 * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(`${operation} failed after 3 attempts: ${getErrorMessage(lastError)}`);
}

async function findByStableName(
  gateway: NewsletterBroadcastGateway,
  name: string,
  sleep: (milliseconds: number) => Promise<void>
): Promise<NewsletterRemoteBroadcast | null> {
  const broadcasts = await retryRead('List Resend broadcasts', () => gateway.list(), sleep);
  const matches = broadcasts.filter((broadcast) => broadcast.name === name);
  if (matches.length > 1) {
    throw new Error(
      `Found ${matches.length} Resend broadcasts named ${name}; refusing to guess which one is authoritative.`
    );
  }
  return matches[0] || null;
}

async function getRemote(
  gateway: NewsletterBroadcastGateway,
  id: string,
  sleep: (milliseconds: number) => Promise<void>
): Promise<NewsletterRemoteBroadcast | null> {
  return retryRead(`Get Resend broadcast ${id}`, () => gateway.get(id), sleep);
}

async function requireRemote(
  gateway: NewsletterBroadcastGateway,
  id: string,
  sleep: (milliseconds: number) => Promise<void>
): Promise<NewsletterRemoteBroadcast> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const remote = await getRemote(gateway, id, sleep);
    if (remote) {
      return remote;
    }
    if (attempt < 3) {
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Resend broadcast ${id} does not exist`);
}

async function waitForRemoteState(
  gateway: NewsletterBroadcastGateway,
  id: string,
  description: string,
  predicate: (remote: NewsletterRemoteBroadcast) => boolean,
  sleep: (milliseconds: number) => Promise<void>
): Promise<NewsletterRemoteBroadcast> {
  let lastStatus = 'missing';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const remote = await getRemote(gateway, id, sleep);
    if (remote) {
      lastStatus = remote.status;
      if (predicate(remote)) {
        return remote;
      }
    }
    if (attempt < 5) {
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
  throw new Error(
    `Resend broadcast ${id} did not reach ${description}; last status: ${lastStatus}.`
  );
}

async function reconcileAfterCreateFailure(
  gateway: NewsletterBroadcastGateway,
  desired: DesiredNewsletterDelivery,
  originalError: unknown,
  sleep: (milliseconds: number) => Promise<void>
): Promise<NewsletterRemoteBroadcast> {
  const adopted = await findByStableName(gateway, desired.name, sleep);
  if (!adopted) {
    throw new Error(
      `Broadcast creation had an ambiguous failure and no ${desired.name} broadcast could be reconciled. Refusing a blind retry: ${getErrorMessage(originalError)}`
    );
  }
  return requireRemote(gateway, adopted.id, sleep);
}

async function cancelScheduledBroadcast(
  gateway: NewsletterBroadcastGateway,
  remote: NewsletterRemoteBroadcast,
  sleep: (milliseconds: number) => Promise<void>
): Promise<NewsletterRemoteBroadcast> {
  try {
    await gateway.cancel(remote.id);
  } catch (firstError) {
    try {
      return await waitForRemoteState(
        gateway,
        remote.id,
        'draft after cancellation',
        (candidate) => candidate.status === 'draft',
        sleep
      );
    } catch {
      throw new Error(
        `Could not confirm cancellation of broadcast ${remote.id}. The request may still be in flight, so it will not be retried in this run: ${getErrorMessage(firstError)}`
      );
    }
  }

  return waitForRemoteState(
    gateway,
    remote.id,
    'draft after cancellation',
    (candidate) => candidate.status === 'draft',
    sleep
  );
}

async function updateDraftBroadcast(
  gateway: NewsletterBroadcastGateway,
  remote: NewsletterRemoteBroadcast,
  desired: DesiredNewsletterDelivery,
  sleep: (milliseconds: number) => Promise<void>
): Promise<NewsletterRemoteBroadcast> {
  try {
    await gateway.update(remote.id, desired);
  } catch (firstError) {
    try {
      return await waitForRemoteState(
        gateway,
        remote.id,
        'the approved draft content',
        (candidate) =>
          candidate.status === 'draft' && contentMatches(candidate, desired),
        sleep
      );
    } catch {
      throw new Error(
        `Could not confirm the update for broadcast ${remote.id}. The request may still be in flight, so it will not be retried in this run: ${getErrorMessage(firstError)}`
      );
    }
  }

  return waitForRemoteState(
    gateway,
    remote.id,
    'the approved draft content',
    (candidate) =>
      candidate.status === 'draft' && contentMatches(candidate, desired),
    sleep
  );
}

async function scheduleDraftBroadcast(
  gateway: NewsletterBroadcastGateway,
  remote: NewsletterRemoteBroadcast,
  desired: DesiredNewsletterDelivery,
  sleep: (milliseconds: number) => Promise<void>
): Promise<NewsletterRemoteBroadcast> {
  try {
    await gateway.schedule(remote.id, desired.scheduledAt);
  } catch (firstError) {
    try {
      return await waitForRemoteState(
        gateway,
        remote.id,
        `scheduled at ${desired.scheduledAt}`,
        (candidate) =>
          candidate.status === 'scheduled' && scheduleMatches(candidate, desired),
        sleep
      );
    } catch {
      throw new Error(
        `Could not confirm scheduling for broadcast ${remote.id}. The request may still be in flight, so it will not be retried in this run: ${getErrorMessage(firstError)}`
      );
    }
  }

  return waitForRemoteState(
    gateway,
    remote.id,
    `scheduled at ${desired.scheduledAt}`,
    (candidate) =>
      candidate.status === 'scheduled' && scheduleMatches(candidate, desired),
    sleep
  );
}

function assertManifestIdentity(
  manifest: NewsletterDeliveryManifest,
  desired: DesiredNewsletterDelivery
): void {
  if (
    manifest.version !== 1 ||
    manifest.weekId !== desired.weekId ||
    manifest.broadcastName !== desired.name ||
    manifest.segmentId !== desired.segmentId ||
    manifest.scheduledAt !== desired.scheduledAt
  ) {
    throw new Error(
      `Delivery manifest identity does not match ${desired.weekId}; refusing to reuse it.`
    );
  }
}

function buildManifest(
  desired: DesiredNewsletterDelivery,
  remote: NewsletterRemoteBroadcast,
  now: Date,
  previous?: NewsletterDeliveryManifest
): NewsletterDeliveryManifest {
  const status = normalizeStatus(remote.status);
  return {
    version: 1,
    weekId: desired.weekId,
    broadcastName: desired.name,
    broadcastId: remote.id,
    deliverySha256: desired.deliverySha256,
    segmentId: desired.segmentId,
    scheduledAt: desired.scheduledAt,
    remoteStatus: status,
    createdAt: previous?.createdAt || remote.createdAt || now.toISOString(),
    reconciledAt: now.toISOString(),
    ...(remote.sentAt
      ? { sentAt: normalizeIsoTimestamp(remote.sentAt) || remote.sentAt }
      : {}),
    ...(previous?.publishedAt ? { publishedAt: previous.publishedAt } : {}),
  };
}

export async function reconcileNewsletterDelivery(
  options: ReconcileNewsletterDeliveryOptions
): Promise<NewsletterDeliveryManifest> {
  const {
    desired,
    gateway,
    manifest,
    now = new Date(),
    sleep = defaultSleep,
    allowMutations = true,
  } = options;
  if (manifest) {
    assertManifestIdentity(manifest, desired);
  }

  // A persisted provider ID is authoritative. Never replace it after a 404 or
  // an inconsistent list response: the original request may still exist and a
  // new broadcast could deliver the same edition twice.
  let remote = manifest
    ? await requireRemote(gateway, manifest.broadcastId, sleep)
    : null;

  if (remote && remote.name !== desired.name) {
    throw new Error(
      `Manifest broadcast ${remote.id} is named ${remote.name}, expected ${desired.name}.`
    );
  }

  if (manifest) {
    const uniqueNamedBroadcast = await findByStableName(
      gateway,
      desired.name,
      sleep
    );
    if (!uniqueNamedBroadcast) {
      throw new Error(
        `Manifest broadcast ${manifest.broadcastId} exists but is absent from the Resend broadcast list; refusing to mutate uncertain provider state.`
      );
    }
    if (uniqueNamedBroadcast.id !== manifest.broadcastId) {
      throw new Error(
        `Manifest points to ${manifest.broadcastId}, but ${desired.name} resolves to ${uniqueNamedBroadcast.id}; refusing duplicate delivery risk.`
      );
    }
  }

  if (!manifest && !remote) {
    remote = await findByStableName(gateway, desired.name, sleep);
    if (remote) {
      remote = await requireRemote(gateway, remote.id, sleep);
    }
  }

  if (!remote) {
    if (!allowMutations) {
      throw new Error(
        `No existing ${desired.name} broadcast is available and the 15-minute mutation cutoff has passed.`
      );
    }
    try {
      const created = await gateway.create(desired);
      remote = await requireRemote(gateway, created.id, sleep);
    } catch (error) {
      remote = await reconcileAfterCreateFailure(gateway, desired, error, sleep);
    }
  }

  if (remote.name !== desired.name) {
    throw new Error(
      `Resolved broadcast ${remote.id} is named ${remote.name}, expected ${desired.name}.`
    );
  }

  let status = normalizeStatus(remote.status);
  if (status === 'sent' || status === 'queued') {
    if (!contentMatches(remote, desired) || !scheduleMatches(remote, desired)) {
      throw new Error(
        `Broadcast ${remote.id} is already ${status} with content or timing that differs from the approved ${desired.weekId} edition; it cannot be changed safely.`
      );
    }
    if (status === 'sent') {
      assertValidSentAt(remote, desired);
    }
    return buildManifest(desired, remote, now, manifest);
  }

  if (status === 'canceled') {
    throw new Error(
      `Broadcast ${remote.id} is canceled and cannot be reused. Resolve it in Resend before retrying.`
    );
  }

  if (status === 'scheduled') {
    if (contentMatches(remote, desired) && scheduleMatches(remote, desired)) {
      return buildManifest(desired, remote, now, manifest);
    }
    if (!allowMutations) {
      throw new Error(
        `Broadcast ${remote.id} differs from the approved delivery, but the 15-minute mutation cutoff has passed.`
      );
    }
    remote = await cancelScheduledBroadcast(gateway, remote, sleep);
    status = normalizeStatus(remote.status);
  }

  if (status !== 'draft') {
    throw new Error(
      `Broadcast ${remote.id} must be a draft before scheduling, got ${status}.`
    );
  }

  if (!allowMutations) {
    throw new Error(
      `Broadcast ${remote.id} still requires a provider mutation, but the 15-minute cutoff has passed.`
    );
  }

  if (!contentMatches(remote, desired)) {
    remote = await updateDraftBroadcast(gateway, remote, desired, sleep);
  }
  remote = await scheduleDraftBroadcast(gateway, remote, desired, sleep);

  if (!contentMatches(remote, desired)) {
    throw new Error(
      `Scheduled broadcast ${remote.id} does not match the approved delivery hash.`
    );
  }
  return buildManifest(desired, remote, now, manifest);
}

export async function verifyNewsletterDelivery(
  options: VerifyNewsletterDeliveryOptions
): Promise<{ readyToPublish: boolean; manifest: NewsletterDeliveryManifest }> {
  const {
    desired,
    gateway,
    manifest,
    allowPending,
    now = new Date(),
    sleep = defaultSleep,
  } = options;
  assertManifestIdentity(manifest, desired);

  if (
    manifest.deliverySha256 !== desired.deliverySha256 ||
    manifest.segmentId !== desired.segmentId ||
    manifest.scheduledAt !== desired.scheduledAt
  ) {
    throw new Error(
      `Delivery manifest for ${desired.weekId} does not match the currently approved newsletter.`
    );
  }

  const remote = await requireRemote(gateway, manifest.broadcastId, sleep);
  if (
    remote.name !== desired.name ||
    !contentMatches(remote, desired) ||
    !scheduleMatches(remote, desired)
  ) {
    throw new Error(
      `Resend broadcast ${manifest.broadcastId} no longer matches the approved ${desired.weekId} delivery.`
    );
  }

  const status = normalizeStatus(remote.status);
  const updatedManifest = buildManifest(desired, remote, now, manifest);
  if (status === 'sent') {
    assertValidSentAt(remote, desired);
    return { readyToPublish: true, manifest: updatedManifest };
  }

  if (allowPending && (status === 'scheduled' || status === 'queued')) {
    return { readyToPublish: false, manifest: updatedManifest };
  }

  throw new Error(
    `Newsletter ${desired.weekId} is not confirmed sent in Resend. Current status: ${status}.`
  );
}

/** Cancel a scheduled snapshot when its source draft changed during a run. */
export async function holdNewsletterDelivery(
  options: HoldNewsletterDeliveryOptions
): Promise<NewsletterDeliveryManifest> {
  const {
    gateway,
    manifest,
    now = new Date(),
    sleep = defaultSleep,
  } = options;
  if (manifest.version !== 1) {
    throw new Error(`Unsupported delivery manifest version for ${manifest.weekId}.`);
  }

  let remote = await requireRemote(gateway, manifest.broadcastId, sleep);
  if (remote.name !== manifest.broadcastName) {
    throw new Error(
      `Manifest broadcast ${remote.id} is named ${remote.name}, expected ${manifest.broadcastName}.`
    );
  }
  const uniqueNamedBroadcast = await findByStableName(
    gateway,
    manifest.broadcastName,
    sleep
  );
  if (!uniqueNamedBroadcast || uniqueNamedBroadcast.id !== remote.id) {
    throw new Error(
      `Could not prove ${remote.id} is the unique ${manifest.broadcastName} broadcast before placing it on hold.`
    );
  }

  const status = normalizeStatus(remote.status);
  if (status === 'scheduled') {
    remote = await cancelScheduledBroadcast(gateway, remote, sleep);
  } else if (status !== 'draft') {
    throw new Error(
      `Cannot place broadcast ${remote.id} on hold because it is already ${status}.`
    );
  }

  return {
    ...manifest,
    remoteStatus: 'draft',
    reconciledAt: now.toISOString(),
  };
}

export function getNewsletterDeliveryManifestPath(
  rootDir: string,
  weekId: string
): string {
  return join(rootDir, 'data', 'deliveries', `${weekId}.json`);
}

export function loadNewsletterDeliveryManifest(
  rootDir: string,
  weekId: string
): NewsletterDeliveryManifest | undefined {
  const manifestPath = getNewsletterDeliveryManifestPath(rootDir, weekId);
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  return JSON.parse(
    readFileSync(manifestPath, 'utf-8')
  ) as NewsletterDeliveryManifest;
}

export function saveNewsletterDeliveryManifest(
  rootDir: string,
  manifest: NewsletterDeliveryManifest
): string {
  const manifestPath = getNewsletterDeliveryManifestPath(rootDir, manifest.weekId);
  mkdirSync(dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8'
  );
  renameSync(temporaryPath, manifestPath);
  return manifestPath;
}
