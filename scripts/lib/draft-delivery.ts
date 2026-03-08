import type { NewsletterDraft } from '../types.js';

export function assertDraftValidated(draft: NewsletterDraft, action: string): void {
  if (draft.validation?.status === 'passed') {
    return;
  }

  const status = draft.validation?.status || 'missing';
  throw new Error(
    `Draft ${draft.weekId} is not validated for ${action}. Current validation status: ${status}.`
  );
}
