/**
 * TP confirmation webhook handler.
 * Exposed as GET /confirm-tp?pair=XAUUSD&tf=H4&tp=1&signal_id=xxx
 *
 * Looks up the stored signal, marks the TP as hit, and posts
 * a public celebration message to make free members feel FOMO.
 */

import { getSignal, markTpHit } from '../db/subscribers.js';
import { formatTpHit } from '../signals/formatter.js';

/**
 * Process a TP confirmation request.
 * @param {{ pair: string, tf: string, tp: string|number, signal_id: string }} params
 * @param {import('grammy').Bot} bot
 * @returns {Promise<string>} Result message
 */
export async function confirmTp({ pair, tf, tp, signal_id }, bot) {
  const tpLevel = parseInt(tp, 10);
  if (![1, 2, 3].includes(tpLevel)) {
    throw new Error(`Invalid tp level: ${tp}. Must be 1, 2, or 3.`);
  }

  const signal = signal_id ? await getSignal(signal_id) : null;
  if (!signal) {
    throw new Error(`Signal not found: ${signal_id}`);
  }

  // Mark TP as hit in DB
  await markTpHit(signal_id, tpLevel);

  // Build the public celebratory post
  const tpPrice = signal[`tp${tpLevel}`];
  const enrichedSignal = {
    pair: signal.pair ?? pair,
    timeframe: signal.timeframe ?? tf,
    direction: signal.direction,
    entry: signal.entry,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3,
  };

  const message = formatTpHit(enrichedSignal, tpLevel);

  await bot.api.sendMessage(process.env.PUBLIC_CHANNEL_ID, message, {
    parse_mode: 'HTML',
  });

  return `TP${tpLevel} confirmed for ${signal.pair} ${signal.timeframe}. Posted to public channel.`;
}
