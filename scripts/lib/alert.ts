import { Resend } from 'resend';

export interface AlertOptions {
  title: string;
  weekId?: string;
  reason: string;
  details?: string;
  actionItems: string[];
  workflowRunUrl?: string;
}

/**
 * Send an alert email when human intervention is required.
 * Only use for critical failures that won't self-recover.
 */
export async function sendAlert(options: AlertOptions): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const alertEmail = process.env.TEST_EMAIL;

  if (!apiKey || !alertEmail) {
    console.error('Cannot send alert: RESEND_API_KEY or TEST_EMAIL not set');
    console.error('Alert details:', options);
    return false;
  }

  const resend = new Resend(apiKey);
  const time = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });

  const actionList = options.actionItems
    .map((item, i) => `<li style="margin-bottom: 8px;">${item}</li>`)
    .join('\n');

  const workflowLink = options.workflowRunUrl
    ? `<p style="margin-top: 16px;"><a href="${options.workflowRunUrl}" style="color: #2563eb;">View workflow run →</a></p>`
    : '';

  const detailsSection = options.details
    ? `<pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; margin-top: 16px;">${escapeHtml(options.details)}</pre>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Alert - ${options.title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #dc2626; margin-bottom: 24px;">⚠️ ${options.title}</h1>

  ${options.weekId ? `<p><strong>Week:</strong> ${options.weekId}</p>` : ''}
  <p><strong>Time:</strong> ${time}</p>
  <p><strong>Reason:</strong> ${options.reason}</p>
  ${detailsSection}

  <h2 style="margin-top: 24px; font-size: 18px;">What to do</h2>
  <ol style="line-height: 1.8;">
    ${actionList}
  </ol>
  ${workflowLink}

  <hr style="margin-top: 32px; border: none; border-top: 1px solid #e5e7eb;">
  <p style="color: #666; font-size: 12px;">
    This alert was sent by the Good Brief pipeline.
  </p>
</body>
</html>
  `.trim();

  const subject = options.weekId
    ? `[ALERT] Good Brief ${options.weekId} - ${options.title}`
    : `[ALERT] Good Brief - ${options.title}`;

  console.log(`Sending alert: ${subject}`);

  const { error } = await resend.emails.send({
    from: 'Good Brief <buna@goodbrief.ro>',
    to: alertEmail,
    subject,
    html,
  });

  if (error) {
    console.error('Failed to send alert email:', error);
    return false;
  }

  console.log('✓ Alert email sent');
  return true;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
