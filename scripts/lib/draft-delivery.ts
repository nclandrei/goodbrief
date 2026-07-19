import type { NewsletterDraft } from '../types.js';
import { isLegacyValidationWeek } from './newsletter-week.js';
import { MIN_SENDABLE_ARTICLE_COUNT } from './newsletter-policy.js';

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

    return;
  }

  const status = draft.validation?.status || 'missing';
  throw new Error(
    `Draft ${draft.weekId} is not validated for ${action}. Current validation status: ${status}.`
  );
}
