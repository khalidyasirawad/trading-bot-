/**
 * Signal-only cron scheduler (subscriptions disabled).
 *
 * Schedule (UTC):
 *   07:00 daily        → AI trading news digest → PUBLIC
 *   09:30 daily        → VIP teaser → PUBLIC
 *   10:00 daily        → Full VIP signal → VIP channel
 *   Mon+Thu 08:00      → Direction-only signal → PUBLIC
 *   Tue+Fri 10:00      → Promo post → PUBLIC
 */

import cron from 'node-cron';
import crypto from 'crypto';
import { fetchPublicSignal, fetchVipSignal, isActionableSignal } from './signals/fetcher.js';
import { formatPublicSignal, formatVipSignal, formatVipTeaser, formatNoSignal } from './signals/formatter.js';
import { applyWatermark } from './signals/antiLeak.js';
import { generateNewsDigest } from './content/newsDigest.js';
import { generatePromoPost } from './content/promoPost.js';

// ─── Jobs ─────────────────────────────────────────────────────────────────────

async function jobPublicSignal(bot) {
  console.log('[cron] Running: public signal job');
  try {
    const result = await fetchPublicSignal('XAUUSD', 'H1');

    if (!isActionableSignal(result)) {
      console.log(`[cron] Public signal skipped — ${result.signal.direction} / ${result.signal.confidence}`);
      return;
    }

    await bot.api.sendMessage(process.env.PUBLIC_CHANNEL_ID, formatPublicSignal(result), {
      parse_mode: 'HTML',
    });
    console.log('[cron] Public signal posted');
  } catch (err) {
    console.error('[cron] Public signal failed:', err.message);
  }
}

async function jobVipSignal(bot) {
  console.log('[cron] Running: VIP signal job');
  try {
    const result = await fetchVipSignal('XAUUSD', 'H1');

    if (!isActionableSignal(result)) {
      console.log(`[cron] VIP signal skipped — ${result.signal.direction} / ${result.signal.confidence}`);
      await bot.api.sendMessage(process.env.VIP_CHANNEL_ID, formatNoSignal(result), {
        parse_mode: 'HTML',
        protect_content: true,
      });
      return;
    }

    const signalId = `sig_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const text = applyWatermark(formatVipSignal(result, signalId), `channel_${process.env.VIP_CHANNEL_ID}`);

    await bot.api.sendMessage(process.env.VIP_CHANNEL_ID, text, {
      parse_mode: 'HTML',
      protect_content: true,
    });
    console.log(`[cron] VIP signal posted — ${signalId}`);
  } catch (err) {
    console.error('[cron] VIP signal failed:', err.message);
  }
}

async function jobNewsDigest(bot) {
  console.log('[cron] Running: news digest job');
  try {
    const text = await generateNewsDigest();
    await bot.api.sendMessage(process.env.PUBLIC_CHANNEL_ID, text, { parse_mode: 'HTML' });
    console.log('[cron] News digest posted');
  } catch (err) {
    console.error('[cron] News digest failed:', err.message);
  }
}

async function jobVipTeaser(bot) {
  console.log('[cron] Running: VIP teaser job');
  try {
    await bot.api.sendMessage(process.env.PUBLIC_CHANNEL_ID, formatVipTeaser('H1'), {
      parse_mode: 'HTML',
    });
    console.log('[cron] VIP teaser posted');
  } catch (err) {
    console.error('[cron] VIP teaser failed:', err.message);
  }
}

async function jobPromoPost(bot) {
  console.log('[cron] Running: promo post job');
  try {
    const { caption, imageBuffer } = await generatePromoPost();
    if (imageBuffer) {
      await bot.api.sendPhoto(
        process.env.PUBLIC_CHANNEL_ID,
        new Blob([imageBuffer], { type: 'image/jpeg' }),
        { caption, parse_mode: 'HTML' }
      );
    } else {
      await bot.api.sendMessage(process.env.PUBLIC_CHANNEL_ID, caption, { parse_mode: 'HTML' });
    }
    console.log('[cron] Promo post published');
  } catch (err) {
    console.error('[cron] Promo post failed:', err.message);
  }
}

// ─── Register all jobs ────────────────────────────────────────────────────────

export function startScheduler(bot) {
  const jobs = [
    cron.schedule('0 7 * * *',   () => jobNewsDigest(bot),   { timezone: 'UTC' }),
    cron.schedule('30 9 * * *',  () => jobVipTeaser(bot),    { timezone: 'UTC' }),
    cron.schedule('0 10 * * *',  () => jobVipSignal(bot),    { timezone: 'UTC' }),
    cron.schedule('0 8 * * 1,4', () => jobPublicSignal(bot), { timezone: 'UTC' }),
    cron.schedule('0 10 * * 2,5',() => jobPromoPost(bot),    { timezone: 'UTC' }),
  ];

  console.log('[scheduler] 5 signal jobs registered');

  return {
    stop: () => jobs.forEach(j => j.stop()),
    runPublicSignal: () => jobPublicSignal(bot),
    runVipSignal:    () => jobVipSignal(bot),
    runNewsDigest:   () => jobNewsDigest(bot),
    runPromoPost:    () => jobPromoPost(bot),
  };
}
