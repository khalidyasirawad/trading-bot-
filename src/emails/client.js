/**
 * Resend.com email client wrapper.
 * Free tier: 3,000 emails/month, 100/day.
 */

import { Resend } from 'resend';

let _resend = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const FROM = () => process.env.FROM_EMAIL ?? 'noreply@yourdomain.com';

/**
 * Send a single email.
 * @param {{ to: string, subject: string, html: string }} options
 */
export async function sendEmail({ to, subject, html }) {
  const { data, error } = await getResend().emails.send({
    from: FROM(),
    to,
    subject,
    html,
  });

  if (error) {
    console.error('[email] Send failed:', error);
    throw new Error(`Email send failed: ${error.message}`);
  }

  console.log(`[email] Sent "${subject}" to ${to} — id: ${data.id}`);
  return data;
}

/**
 * Send a bulk email to multiple addresses sequentially.
 * Stays within Resend free-tier rate limits.
 */
export async function sendBulkEmail(recipients, { subject, html }) {
  const results = [];
  for (const to of recipients) {
    try {
      const result = await sendEmail({ to, subject, html });
      results.push({ to, success: true, id: result.id });
    } catch (err) {
      console.error(`[email] Failed for ${to}:`, err.message);
      results.push({ to, success: false, error: err.message });
    }
    // Small delay to avoid hitting Resend rate limits
    await new Promise(r => setTimeout(r, 150));
  }
  return results;
}
