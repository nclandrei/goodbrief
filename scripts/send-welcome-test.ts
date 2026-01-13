#!/usr/bin/env npx tsx

import 'dotenv/config';
import { Resend } from 'resend';
import { render } from '@react-email/components';
import { Welcome } from '../emails/welcome.js';

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  const testEmail = process.env.TEST_EMAIL;

  if (!apiKey) {
    console.error('Error: RESEND_API_KEY environment variable is required');
    process.exit(1);
  }

  if (!testEmail) {
    console.error('Error: TEST_EMAIL environment variable is required');
    process.exit(1);
  }

  const resend = new Resend(apiKey);
  const html = await render(Welcome());

  console.log(`Sending welcome email to ${testEmail}...`);

  const { data, error } = await resend.emails.send({
    from: 'Good Brief <buna@goodbrief.ro>',
    replyTo: 'contact@goodbrief.ro',
    to: testEmail,
    subject: '[TEST] Bine ai venit la Good Brief! 🎉',
    html,
  });

  if (error) {
    console.error('Error sending email:', error);
    process.exit(1);
  }

  console.log('✓ Welcome email sent! ID:', data?.id);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
