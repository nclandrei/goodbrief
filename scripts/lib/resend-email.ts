import { createHash } from 'node:crypto';
import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponse,
  CreateEmailResponseSuccess,
  ErrorResponse,
} from 'resend';

export type ResendEmailSend = (
  payload: CreateEmailOptions,
  options?: CreateEmailRequestOptions
) => Promise<CreateEmailResponse>;

export interface ResendEmailRetryOptions {
  idempotencyKey: string;
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void> | void;
  now?: () => number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_JITTER_RATIO = 0.2;

const TERMINAL_ERROR_NAMES = new Set([
  'daily_quota_exceeded',
  'invalid_access',
  'invalid_api_key',
  'invalid_attachment',
  'invalid_from_address',
  'invalid_idempotency_key',
  'invalid_idempotent_request',
  'invalid_parameter',
  'invalid_region',
  'method_not_allowed',
  'missing_api_key',
  'missing_required_field',
  'monthly_quota_exceeded',
  'not_found',
  'restricted_api_key',
  'security_error',
  'validation_error',
]);

export class ResendEmailDeliveryError extends Error {
  readonly resendError: ErrorResponse;

  constructor(error: ErrorResponse) {
    super(
      `Resend email delivery failed (${error.name}, status ${error.statusCode ?? 'network'}): ${error.message}`
    );
    this.name = 'ResendEmailDeliveryError';
    this.resendError = error;
  }
}

function canonicalize(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { type: 'Buffer', data: value.toString('base64') };
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function buildResendEmailIdempotencyKey(
  scope: string,
  payload: CreateEmailOptions
): string {
  const safeScope = scope.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const digest = createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
  return `goodbrief-${safeScope}-${digest}`;
}

export function isRetryableResendError(error: ErrorResponse): boolean {
  if (TERMINAL_ERROR_NAMES.has(error.name)) {
    return false;
  }
  if (
    error.name === 'concurrent_idempotent_requests' ||
    error.name === 'internal_server_error' ||
    error.name === 'rate_limit_exceeded'
  ) {
    return true;
  }
  if (error.statusCode === null) {
    return true;
  }
  return (
    error.statusCode === 408 ||
    error.statusCode === 425 ||
    error.statusCode === 429 ||
    error.statusCode >= 500
  );
}

function getRetryAfterMs(
  headers: Record<string, string> | null,
  now: () => number
): number | null {
  const raw = Object.entries(headers || {}).find(
    ([name]) => name.toLowerCase() === 'retry-after'
  )?.[1];
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const retryAt = Date.parse(raw);
  return Number.isNaN(retryAt) ? null : Math.max(0, retryAt - now());
}

export async function sendResendEmailWithRetry(
  send: ResendEmailSend,
  payload: CreateEmailOptions,
  options: ResendEmailRetryOptions
): Promise<CreateEmailResponseSuccess> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const random = options.random ?? Math.random;
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const now = options.now ?? Date.now;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('Resend maxAttempts must be a positive integer');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: CreateEmailResponse;
    try {
      response = await send(payload, {
        idempotencyKey: options.idempotencyKey,
      });
    } catch (error) {
      response = {
        data: null,
        error: {
          name: 'application_error',
          statusCode: null,
          message: error instanceof Error ? error.message : String(error),
        },
        headers: null,
      };
    }

    if (!response.error) {
      return response.data;
    }

    const shouldRetry = isRetryableResendError(response.error);
    if (!shouldRetry || attempt === maxAttempts) {
      throw new ResendEmailDeliveryError(response.error);
    }

    const exponentialDelay = Math.min(
      initialDelayMs * 2 ** (attempt - 1),
      maxDelayMs
    );
    const jitterFactor =
      1 - jitterRatio + random() * jitterRatio * 2;
    const jitteredDelay = Math.max(0, Math.round(exponentialDelay * jitterFactor));
    const retryAfterMs = getRetryAfterMs(response.headers, now);
    const delayMs = Math.max(jitteredDelay, retryAfterMs ?? 0);

    console.warn(
      `Resend attempt ${attempt}/${maxAttempts} failed with ${response.error.name} ` +
        `(status ${response.error.statusCode ?? 'network'}); retrying in ${delayMs}ms...`
    );
    await sleep(delayMs);
  }

  throw new Error('Unreachable Resend retry state');
}
