/**
 * 24/7 live signal monitor — scans all swing pairs every 20 minutes.
 *
 * HIGH confidence  → posts immediately to VIP channel (auto)
 * MEDIUM confidence → sends suggestion to admin DM for review
 *
 * Rate-limit budget (Twelve Data free tier = 800 credits/day):
 *   8 setups × 3 scans/hour × 24h = 576 credits/day for monitoring
 *   ~15 credits/day for scheduled posts
 *   Total: ~591/day — well within the 800/day limit.
 *
 * Deduplication: same pair+timeframe+direction+entry is silenced for 4 hours
 * to prevent spamming the same setup on every scan cycle.
 */

import crypto from 'crypto';
import { scanAllSignals } from './scanner.js';
import { isActionableSignal } from './fetcher.js';
import { formatVipSignal } from './formatter.js';
import { applyWatermark } from './antiLeak.js';
import { sleep } from './marketData.js';

const SCAN_INTERVAL_MS = 20 * 60 * 1000;  // 20 minutes
const DEDUP_WINDOW_MS  =  4 * 60 * 60 * 1000; // 4 hours

// In-memory dedup store: signalKey → timestamp last alerted
const seen = new Map();

function signalKey(pair, tf, direction, entry, dec) {
  const rounded = Number(entry).toFixed(dec);
  return `${pair}_${tf}_${direction}_${rounded}`;
}

function wasSeen(key) {
  const ts = seen.get(key);
  return ts != null && Date.now() - ts < DEDUP_WINDOW_MS;
}

function markSeen(key) {
  seen.set(key, Date.now());
  // Prune stale entries
  for (const [k, ts] of seen) {
    if (Date.now() - ts > DEDUP_WINDOW_MS) seen.delete(k);
  }
}

// ─── Format admin DM for a MEDIUM signal ─────────────────────────────────────

function formatMediumAlert(result) {
  const { pair, signal, indicators } = result;
  const dec  = pair === 'BTCUSD' ? 0 : 2;
  const pairEmoji = pair === 'XAUUSD' ? '🥇' : '₿';
  const dirEmoji  = signal.direction === 'LONG' ? '🟢' : '🔴';

  const factorCount = signal.missingFactors?.length
    ? 4 - signal.missingFactors.length
    : '3';

  const missing = signal.missingFactors?.length
    ? `\n⚠️ <b>Missing:</b> <i>${signal.missingFactors.join(', ')}</i>`
    : '';

  const f = (v, d = dec) => v != null ? Number(v).toFixed(d) : 'N/A';

  return [
    `⚡ <b>MEDIUM SIGNAL — Your Review Needed</b>`,
    '',
    `${pairEmoji} <b>${pair}</b> · ${signal.timeframe}  ${dirEmoji} <b>${signal.direction}</b>`,
    `${factorCount}/4 factors aligned`,
    '',
    `📥 Entry:  <code>${f(signal.entry)}</code>`,
    `🛑 Stop:   <code>${f(signal.stopLoss)}</code>`,
    `🎯 TP1: <code>${f(signal.takeProfit1)}</code>  TP2: <code>${f(signal.takeProfit2)}</code>  TP3: <code>${f(signal.takeProfit3)}</code>`,
    `⚖️ R:R: ${signal.riskReward}`,
    '',
    `RSI: <code>${f(indicators?.rsi14?.value, 1)}</code>  MACD hist: <code>${f(indicators?.macd?.histogram, 3)}</code>`,
    `EMA50: <code>${f(indicators?.ma50?.value)}</code> ${indicators?.ma50?.relation ?? ''}  EMA200: <code>${f(indicators?.ma200?.value)}</code> ${indicators?.ma200?.relation ?? ''}`,
    missing,
    '',
    `<i>${signal.reasoning}</i>`,
    '',
    `▶️ To post to VIP: <code>/signal ${pair} ${signal.timeframe} force</code>`,
    `▶️ To ignore: just skip this message`,
  ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n');
}

// ─── One scan cycle ───────────────────────────────────────────────────────────

async function runOneCycle(bot) {
  console.log('[monitor] Scanning swing setups…');
  const rows = await scanAllSignals();

  for (const row of rows) {
    if (!row.result) continue;

    const { pair, timeframe, result } = row;
    const sig = result.signal;

    if (sig.direction === 'WAIT') continue;

    const dec = pair === 'BTCUSD' ? 0 : 2;
    const key = signalKey(pair, timeframe, sig.direction, sig.entry, dec);

    if (wasSeen(key)) continue;
    markSeen(key);

    if (sig.confidence === 'HIGH') {
      // Auto-post to VIP channel
      const signalId = `sig_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const text = applyWatermark(formatVipSignal(result, signalId), `monitor_${signalId}`);

      try {
        await bot.api.sendMessage(process.env.VIP_CHANNEL_ID, text, {
          parse_mode: 'HTML',
          protect_content: true,
        });
        console.log(`[monitor] HIGH signal posted → VIP: ${pair} ${timeframe} ${sig.direction} (${signalId})`);
      } catch (err) {
        console.error(`[monitor] Failed to post HIGH signal to VIP channel (${process.env.VIP_CHANNEL_ID}): ${err.message}`);
      }

      // Notify admin regardless of VIP post success
      try {
        await bot.api.sendMessage(
          process.env.ADMIN_TELEGRAM_ID,
          `🔥 <b>HIGH signal AUTO-POSTED to VIP</b>\n${pair} ${timeframe} · ${sig.direction}\nEntry: <code>${Number(sig.entry).toFixed(dec)}</code> | <code>${signalId}</code>`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        console.error(`[monitor] Failed to notify admin (ID: ${process.env.ADMIN_TELEGRAM_ID}): ${err.message}`);
      }

    } else if (sig.confidence === 'MEDIUM') {
      try {
        await bot.api.sendMessage(
          process.env.ADMIN_TELEGRAM_ID,
          formatMediumAlert(result),
          { parse_mode: 'HTML' }
        );
        console.log(`[monitor] MEDIUM signal → admin DM: ${pair} ${timeframe} ${sig.direction}`);
      } catch (err) {
        console.error(`[monitor] Failed to DM admin (ID: ${process.env.ADMIN_TELEGRAM_ID}): ${err.message}`);
      }
    }

    await sleep(500); // small gap between Telegram sends
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the 24/7 live signal monitor.
 * Runs immediately on start, then every 20 minutes.
 *
 * @param {import('grammy').Bot} bot
 * @returns {{ stop: () => void }}
 */
export function startLiveMonitor(bot) {
  console.log('[monitor] 24/7 live monitor started — scanning every 20 min (HIGH → VIP auto-post, MEDIUM → admin DM)');

  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      try {
        await runOneCycle(bot);
      } catch (err) {
        console.error('[monitor] Scan error:', err.message);
      }
      if (!stopped) await sleep(SCAN_INTERVAL_MS);
    }
  };

  loop(); // fire immediately, don't await (runs in background)

  return {
    stop: () => { stopped = true; },
  };
}
