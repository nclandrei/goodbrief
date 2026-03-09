import type { NewsletterDraft } from '../types.js';
import { isLegacyValidationWeek } from './newsletter-week.js';

export function assertDraftValidated(draft: NewsletterDraft, action: string): void {
  if (draft.validation?.status === 'passed') {
    if (isLegacyValidationWeek(draft.weekId)) {
      return;
    }

    if (draft.validation.approvalSource === 'validation-pipeline') {
      return;
    }

    const approvalSource = draft.validation.approvalSource || 'missing';
    throw new Error(
      `Draft ${draft.weekId} is not validated for ${action}. Expected validation-pipeline approval for post-W10 drafts, got ${approvalSource}.`
    );
  }

  const status = draft.validation?.status || 'missing';
  throw new Error(
    `Draft ${draft.weekId} is not validated for ${action}. Current validation status: ${status}.`
  );
}
