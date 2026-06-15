/**
 * Daily expiry job — runs at 00:00 UTC.
 * Kicks expired members and sends expiry/renewal emails.
 */

import {
  getExpiredSubscribers,
  getSubscribersExpiringSoon,
  deactivateSubscriber,
} from '../db/subscribers.js';
import { kickMember } from './manager.js';
import { sendEmail } from '../emails/client.js';
import {
  expiryFinalSubject,
  expiryFinalHtml,
  expiryWarningSubject,
  expiryWarningHtml,
} from '../emails/templates/expiry.js';
import { renewalEmailSubject, renewalEmailHtml } from '../emails/templates/renewal.js';

const RENEW_LINK = process.env.PAYMENT_LINK ?? 'https://your-payment-link.com';

/**
 * Process all expired subscribers: kick from channel + send expiry email.
 * @param {import('grammy').Bot} bot
 */
export async function processExpiredSubscribers(bot) {
  const expired = await getExpiredSubscribers();
  console.log(`[expiry] Processing ${expired.length} expired subscriber(s)`);

  for (const sub of expired) {
    try {
      // Kick from VIP channel if we have their Telegram ID
      if (sub.telegram_id) {
        await kickMember(bot, sub.telegram_id);
      } else {
        console.warn(`[expiry] No telegram_id for ${sub.email}, skipping kick`);
      }

      // Mark as inactive in DB
      await deactivateSubscriber(sub.email);

      // Send expiry email
      await sendEmail({
        to: sub.email,
        subject: expiryFinalSubject(),
        html: expiryFinalHtml({ renewLink: RENEW_LINK }),
      });

      console.log(`[expiry] Processed expired subscriber: ${sub.email}`);
    } catch (err) {
      console.error(`[expiry] Error processing ${sub.email}:`, err.message);
    }
  }

  return expired.length;
}

/**
 * Send 3-day warning emails to subscribers expiring soon.
 */
export async function sendExpiryWarnings() {
  const expiringSoon = await getSubscribersExpiringSoon(3);
  console.log(`[expiry] Sending warnings to ${expiringSoon.length} subscriber(s) expiring in 3 days`);

  for (const sub of expiringSoon) {
    try {
      await sendEmail({
        to: sub.email,
        subject: expiryWarningSubject(),
        html: expiryWarningHtml({
          expiresAt: new Date(sub.expires_at),
          renewLink: RENEW_LINK,
        }),
      });
      console.log(`[expiry] Warning sent to ${sub.email}`);
    } catch (err) {
      console.error(`[expiry] Warning email failed for ${sub.email}:`, err.message);
    }
  }

  return expiringSoon.length;
}

/**
 * Send renewal reminder to a single subscriber (manual trigger or targeted campaign).
 * @param {string} email
 */
export async function sendRenewalReminder(email) {
  await sendEmail({
    to: email,
    subject: renewalEmailSubject(),
    html: renewalEmailHtml({ renewLink: RENEW_LINK }),
  });
}
