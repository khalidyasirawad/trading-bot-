/**
 * Stripe webhook handler for checkout.session.completed events.
 *
 * Expected Stripe checkout custom field: telegram_username
 * Set via Stripe Dashboard → Products → checkout_session.custom_fields
 */

import Stripe from 'stripe';
import { addSubscriber } from '../db/subscribers.js';
import { createVipInviteLink } from './manager.js';
import { sendEmail } from '../emails/client.js';
import { welcomeEmailSubject, welcomeEmailHtml } from '../emails/templates/welcome.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Verify and parse a raw Stripe webhook request.
 * @param {Buffer} rawBody  The raw request body (must be Buffer, not parsed JSON)
 * @param {string} signature  The Stripe-Signature header value
 * @returns {import('stripe').Stripe.Event}
 */
export function constructStripeEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

/**
 * Handle a checkout.session.completed event.
 * @param {import('stripe').Stripe.Checkout.Session} session
 * @param {import('grammy').Bot} bot
 */
export async function handleCheckoutCompleted(session, bot) {
  // Extract customer email
  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) {
    console.error('[stripe] No email in checkout session:', session.id);
    return;
  }

  // Extract telegram_username from custom_fields
  const telegramField = session.custom_fields?.find(
    f => f.key === 'telegram_username'
  );
  const telegramUsername = telegramField?.text?.value ?? telegramField?.dropdown?.value ?? '';

  if (!telegramUsername) {
    console.warn('[stripe] No telegram_username in session:', session.id);
  }

  // Calculate expiry: 30 days from now
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Save subscriber to DB
  await addSubscriber({
    email,
    telegramUsername: telegramUsername || email.split('@')[0],
    expiresAt,
  });

  console.log(`[stripe] New subscriber: ${email} (@${telegramUsername}), expires ${expiresAt.toISOString()}`);

  // Generate single-use invite link
  const inviteLink = await createVipInviteLink(bot);

  // Send welcome email with invite link
  await sendEmail({
    to: email,
    subject: welcomeEmailSubject(),
    html: welcomeEmailHtml({
      firstName: session.customer_details?.name?.split(' ')[0],
      inviteLink,
      expiresAt,
    }),
  });

  console.log(`[stripe] Welcome email sent to ${email} with invite link`);
}

/**
 * Express middleware-compatible webhook handler.
 * Mount at: app.post('/webhook/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler(bot))
 */
export function stripeWebhookHandler(bot) {
  return async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = constructStripeEvent(req.body, sig);
    } catch (err) {
      console.error('[stripe] Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed') {
        await handleCheckoutCompleted(event.data.object, bot);
      }
      // Add more event types here as needed
    } catch (err) {
      console.error('[stripe] Error handling event:', err);
      return res.status(500).send('Internal error handling webhook');
    }

    res.json({ received: true });
  };
}
