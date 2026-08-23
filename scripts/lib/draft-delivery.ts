import type { NewsletterDraft } from '../types.js';
import { buildNewsletterEmail } from './newsletter-email.js';
import { compareWeekIds, isLegacyValidationWeek } from './newsletter-week.js';
import { MIN_SENDABLE_ARTICLE_COUNT } from './newsletter-policy.js';

const DELIVERY_LOCK_START_WEEK = '2026-W34';

function requiresDeliveryLock(weekId: string): boolean {
  return compareWeekIds(weekId, DELIVERY_LOCK_START_WEEK) >= 0;
}

export function lockDraftForDelivery(
  draft: NewsletterDraft,
  approvedAt: string
): string {
  const { deliverySha256 } = buildNewsletterEmail(draft);
  const previousLock = draft.deliveryLock;
  const keepTestRecord = previousLock?.testedSha256 === deliverySha256;

  draft.deliveryLock = {
    version: 1,
    approvedSha256: deliverySha256,
    approvedAt,
    ...(keepTestRecord && previousLock
      ? {
          testedSha256: previousLock.testedSha256,
          testedAt: previousLock.testedAt,
          testMessageId: previousLock.testMessageId,
        }
      : {}),
  };

  return deliverySha256;
}

export function recordDraftTestDelivery(
  draft: NewsletterDraft,
  testedAt: string,
  testMessageId: string
): string {
  const { deliverySha256 } = buildNewsletterEmail(draft);
  if (draft.deliveryLock?.approvedSha256 !== deliverySha256) {
    throw new Error(
      `Draft ${draft.weekId} changed after its delivery approval; approve it again before recording a test send.`
    );
  }

  draft.deliveryLock = {
    ...draft.deliveryLock,
    testedSha256: deliverySha256,
    testedAt,
    testMessageId,
  };

  return deliverySha256;
}

export function assertDraftDeliveryLocked(
  draft: NewsletterDraft,
  action: string
): void {
  if (!requiresDeliveryLock(draft.weekId)) {
    return;
  }

  const lock = draft.deliveryLock;
  if (!lock || lock.version !== 1 || !lock.approvedSha256) {
    throw new Error(
      `Draft ${draft.weekId} is missing its approved delivery content lock for ${action}. Approve the final draft again.`
    );
  }

  const { deliverySha256 } = buildNewsletterEmail(draft);
  if (deliverySha256 !== lock.approvedSha256) {
    throw new Error(
      `Draft ${draft.weekId} changed after its delivery approval; approve it again before ${action}.`
    );
  }

  if (lock.testedSha256 && lock.testedSha256 !== deliverySha256) {
    throw new Error(
      `Draft ${draft.weekId} no longer matches its recorded test delivery for ${action}. Send and commit a new test first.`
    );
  }
}

export function assertDraftValidated(draft: NewsletterDraft, action: string): void {
  if (draft.validation?.status === 'passed') {
    if (isLegacyValidationWeek(draft.weekId)) {
      return;
    }

    if (draft.validation.approvalSource !== 'validation-pipeline' && draft.validation.approvalSource !== 'editor-review') {
      const approvalSource = draft.validation.approvalSource || 'missing';
      throw new Error(
        `Draft ${draft.weekId} is not validated for ${action}. Expected validation-pipeline or editor-review approval for post-W10 drafts, got ${approvalSource}.`
      );
    }

    if (draft.selected.length < MIN_SENDABLE_ARTICLE_COUNT) {
      throw new Error(
        `Draft ${draft.weekId} is not ready for ${action}. Expected a minimum ${MIN_SENDABLE_ARTICLE_COUNT} articles, got ${draft.selected.length}.`
      );
    }

    assertDraftDeliveryLocked(draft, action);
    return;
  }

  const status = draft.validation?.status || 'missing';
  throw new Error(
    `Draft ${draft.weekId} is not validated for ${action}. Current validation status: ${status}.`
  );
}
