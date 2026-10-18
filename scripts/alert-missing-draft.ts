#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Resend } from 'resend';

function getISOWeekId(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7 + 1
  );
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

async function main(): Promise<void> {
  const weekId = process.argv[2] || getISOWeekId();
  const reason = process.argv[3] || 'Draft not found';

  console.log(`\n⚠️ Good Brief Alert`);
  console.log(`Week: ${weekId}`);
  console.log(`Reason: ${reason}\n`);

  const apiKey = process.env.RESEND_API_KEY;
  const editorEmail = process.env.TEST_EMAIL;

  if (!apiKey) {
    console.error('Error: RESEND_API_KEY environment variable is required');
    process.exit(1);
  }

  if (!editorEmail) {
    console.error('Error: TEST_EMAIL environment variable is required');
    process.exit(1);
  }

  const resend = new Resend(apiKey);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Alert - ${weekId}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #dc2626;">⚠️ Newsletter Not Sent</h1>
  <p><strong>Week:</strong> ${weekId}</p>
  <p><strong>Reason:</strong> ${reason}</p>
  <p><strong>Time:</strong> ${new Date().toLocaleString('ro-RO')}</p>
  
  <h2 style="margin-top: 24px;">What happened?</h2>
  <p>The automated delivery-preparation workflow could not find the exact draft for this week.</p>
  
  <h2 style="margin-top: 24px;">What to do?</h2>
  <ol>
    <li>Check if the draft exists at <code>data/drafts/${weekId}.json</code></li>
    <li>Dacă lipsește ediția, reia evaluarea în Amp cu <code>npx tsx scripts/assess-news.ts init data/assessments/${weekId} data/raw/${weekId}.json</code> (doar pentru o evaluare nouă; reia evaluarea existentă fără să o suprascrii). Amp verifică sursele, selectează și scrie ediția independentă.</li>
    <li>După revizia editorului, transferă ediția exactă în draft și inspectează previzualizarea cu <code>npx tsx scripts/send-independent-proof.ts --week ${weekId} --materialize-draft --dry-run --output /tmp/goodbrief-${weekId}-proof.html</code>. Comanda refuză să suprascrie un draft existent; rezolvă explicit orice draft învechit.</li>
    <li>Doar după aprobarea explicită a acestei ediții pentru abonați, rulează <code>npm run approve-draft -- --week ${weekId}</code>, publică modificarea și reia manual workflow-ul <strong>Prepare Newsletter Delivery</strong> pentru <code>${weekId}</code>. Un proof sau un email de test nu înseamnă aprobare.</li>
  </ol>
  
  <hr style="margin-top: 32px; border: none; border-top: 1px solid #e5e7eb;">
  <p style="color: #666; font-size: 12px;">
    This alert was sent by the Good Brief delivery-preparation workflow.
  </p>
</body>
</html>
  `.trim();

  console.log('Sending alert email...');
  const { error } = await resend.emails.send({
    from: 'Good Brief <buna@goodbrief.ro>',
    to: editorEmail,
    subject: `[ALERT] Good Brief ${weekId} NOT sent - action required`,
    html,
  });

  if (error) {
    console.error('Error sending alert:', error);
    process.exit(1);
  }

  console.log('✓ Alert email sent');
  console.log('\n✨ Done!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
