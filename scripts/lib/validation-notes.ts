import type { CounterSignalFlag, NewsletterDraft, ProcessedArticle } from '../types.js';

export interface SelectedValidationNote {
  article: ProcessedArticle;
  flag: CounterSignalFlag;
  label: 'Atenție' | 'De revăzut';
}

function getFlagMap(
  draft: Pick<NewsletterDraft, 'validation'>
): Map<string, CounterSignalFlag> {
  return new Map(
    (draft.validation?.flagged || []).map((flag) => [flag.candidateId, flag])
  );
}

export function getSelectedValidationNotes(
  draft: NewsletterDraft
): SelectedValidationNote[] {
  const flagMap = getFlagMap(draft);

  return draft.selected.flatMap((article) => {
    const flag = flagMap.get(article.id);
    if (!flag) {
      return [];
    }

    return [
      {
        article,
        flag,
        label: flag.verdict === 'strong' ? 'De revăzut' : 'Atenție',
      },
    ];
  });
}

export function formatValidationNotesForConsole(
  draft: NewsletterDraft
): string | null {
  const notes = getSelectedValidationNotes(draft);
  if (notes.length === 0) {
    return null;
  }

  return [
    'Validation notes:',
    ...notes.map(
      (note) =>
        `- ${note.label}: "${note.article.originalTitle}" — ${note.flag.reason}`
    ),
  ].join('\n');
}

export function renderValidationNotesHtml(draft: NewsletterDraft): string {
  const notes = getSelectedValidationNotes(draft);
  if (notes.length === 0) {
    return '';
  }

  const brandAmber = '#92400e';
  const borderAmber = '#f59e0b';
  const bgAmber = '#fffbeb';
  const darkText = '#1f2937';

  return `
    <tr>
      <td style="padding: 0 24px 24px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${bgAmber}; border-left: 4px solid ${borderAmber}; border-radius: 6px;">
          <tr>
            <td style="padding: 16px 18px;">
              <p style="margin: 0 0 10px 0; font-size: 13px; font-weight: 700; color: ${brandAmber}; letter-spacing: 0.6px; text-transform: uppercase;">
                Validation notes
              </p>
              ${notes
                .map(
                  (note) => `
                <p style="margin: 0 0 10px 0; font-size: 14px; color: ${darkText}; line-height: 1.5;">
                  <strong>${note.label}:</strong> ${note.article.originalTitle}<br>
                  ${note.flag.reason}
                </p>
              `
                )
                .join('')}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `.trim();
}
