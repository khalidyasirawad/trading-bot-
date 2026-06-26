/**
 * 24/7 live signal monitor.
 *
 * Every 45 minutes:
 *  1. Checks all open signals for TP/SL hits → announces to PUBLIC channel
 *  2. Scans 23 setups across all pairs:
 *       XAUUSD + BTCUSD × M15/H1/H4/D1 (8 setups)
 *       EURUSD/GBPUSD/USDJPY/USDCHF/AUDUSD × H1/H4/D1 (15 setups)
 *     HIGH confidence  → auto-posts to VIP + stores in signal cache for MT4 EA
 *     MEDIUM confidence → DMs admin for manual review + stores in signal cache
 *
 * Deduplication: a pair/timeframe/direction combo won't be re-posted while
 * an existing signal for that combo is still OPEN (not yet hit SL or TP3).
 *
 * API budget: 23 credits × 32 scans/day = 736 credits/day (limit: 800/day)
 */

import crypto from 'crypto';
import { scanAllPairs } from './scanner.js';
import { isActionableSignal } from './fetcher.js';
import { formatVipSignal, formatTpHitPublic } from './formatter.js';
import { applyWatermark } from './antiLeak.js';
import { sleep } from './marketData.js';
import { PAIR_DEC } from './engine.js';
import { updateSignal } from './latestSignals.js';
import {
  nextNumber, register, markTpHit,
  hasOpenSignal, getOpenSignals, pruneStale,
} from './signalStore.js';

const SCAN_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes

// ─── TP / SL checker ─────────────────────────────────────────────────────────

/**
 * Check all open signals against the latest scan rows.
 * Uses each row's current candle high/low to detect TP/SL crosses.
 * Posts announcements to the PUBLIC channel when levels are hit.
 */
async function checkTpHits(bot, rows) {
  const openSignals = getOpenSignals();
  if (openSignals.length === 0) return;

  // Build a lookup: pair → current candle high/low from the scan
  const priceMap = {};
  for (const row of rows) {
    if (!row.result?.price) continue;
    const { current, high, low } = row.result.price;
    if (!priceMap[row.pair]) {
      priceMap[row.pair] = { current, high, low };
    }
  }

  for (const sig of openSignals) {
    const price = priceMap[sig.pair];
    if (!price) continue;

    const { high, low } = price;
    const long = sig.direction === 'LONG';

    // Check SL first (conservative)
    if ((long && low != null && low <= sig.stopLoss) ||
        (!long && high != null && high >= sig.stopLoss)) {
      if (markTpHit(sig.signalId, 'SL')) {
        console.log(`[monitor] Signal #${sig.number} SL hit — ${sig.pair} ${sig.timeframe}`);
        await postTpAnnouncement(bot, sig, 'SL');
      }
      continue; // signal is now closed
    }

    // Check TPs in order (TP3 first so we don't double-announce)
    const tpLevels = ['TP3', 'TP2', 'TP1'];
    for (const level of tpLevels) {
      const tpPrice = sig[level.toLowerCase()];
      if (tpPrice == null) continue;
      if (sig.tpsHit.has(level)) continue; // already announced

      const hit = long ? (high != null && high >= tpPrice) : (low != null && low <= tpPrice);
      if (hit) {
        if (markTpHit(sig.signalId, level)) {
          console.log(`[monitor] Signal #${sig.number} ${level} hit — ${sig.pair} ${sig.timeframe}`);
          await postTpAnnouncement(bot, sig, level);
        }
        break; // announce highest TP hit this cycle; lower ones get caught next cycle
      }
    }
  }
}

async function postTpAnnouncement(bot, sig, level) {
  const text = formatTpHitPublic(sig, level);
  try {
    await bot.api.sendMessage(process.env.PUBLIC_CHANNEL_ID, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error(`[monitor] Failed to post ${level} announcement to public channel: ${err.message}`);
  }
}

// ─── Admin MEDIUM alert ───────────────────────────────────────────────────────

function formatMediumAlert(result) {
  const { pair, signal, indicators } = result;
  const dec = PAIR_DEC[pair] ?? 5;
  const pairEmoji = pair === 'XAUUSD' ? '🥇' : pair === 'BTCUSD' ? '₿' : '💱';
  const dirEmoji  = signal.direction === 'LONG' ? '🟢' : '🔴';
  const factorCount = signal.missingFactors?.length ? 4 - signal.missingFactors.length : 3;
  const missing = signal.missingFactors?.length
    ? `\n⚠️ <b>Missing:</b> <i>${signal.missingFactors.join(', ')}</i>` : '';
  const f = (v, d = dec) => v != null ? Number(v).toFixed(d) : 'N/A';

  return [
    `⚡ <b>MEDIUM SIGNAL — Your Review Needed</b>`,
    '',
    `${pairEmoji} <b>${pair}</b> · ${signal.timeframe}  ${dirEmoji} <b>${signal.direction}</b>  (${factorCount}/4 factors)`,
    '',
    `📥 Entry:  <code>${f(signal.entry)}</code>`,
    `🛑 Stop:   <code>${f(signal.stopLoss)}</code>`,
    `🎯 TP1: <code>${f(signal.takeProfit1)}</code>  TP2: <code>${f(signal.takeProfit2)}</code>  TP3: <code>${f(signal.takeProfit3)}</code>`,
    `⚖️ R:R: ${signal.riskReward}`,
    '',
    `RSI: <code>${f(indicators?.rsi14?.value, 1)}</code>  MACD: <code>${f(indicators?.macd?.histogram, 3)}</code>`,
    `EMA50: <code>${f(indicators?.ma50?.value)}</code> ${indicators?.ma50?.relation ?? ''}  EMA200: <code>${f(indicators?.ma200?.value)}</code> ${indicators?.ma200?.relation ?? ''}`,
    missing,
    '',
    `<i>${signal.reasoning}</i>`,
    '',
    `▶️ Post to VIP: <code>/signal ${pair} ${signal.timeframe} force</code>`,
  ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n');
}

// ─── New signal posting ───────────────────────────────────────────────────────

async function handleHighSignal(bot, pair, timeframe, result) {
  const num      = nextNumber();
  const signalId = `sig_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const sig      = result.signal;
  const dec      = PAIR_DEC[pair] ?? 5;

  // Push to signal cache so MT4 EA can poll it immediately
  updateSignal(pair, {
    direction:   sig.direction,
    confidence:  sig.confidence,
    entry:       sig.entry,
    stopLoss:    sig.stopLoss,
    takeProfit1: sig.takeProfit1,
    takeProfit2: sig.takeProfit2,
    takeProfit3: sig.takeProfit3,
  });

  const text = applyWatermark(
    formatVipSignal(result, signalId, num),
    `monitor_${signalId}`
  );

  try {
    await bot.api.sendMessage(process.env.VIP_CHANNEL_ID, text, {
      parse_mode: 'HTML',
      protect_content: true,
    });

    // Register in store AFTER successful post
    register(signalId, {
      pair, timeframe,
      direction:  sig.direction,
      entry:      sig.entry,
      stopLoss:   sig.stopLoss,
      tp1:        sig.takeProfit1,
      tp2:        sig.takeProfit2,
      tp3:        sig.takeProfit3,
    });

    console.log(`[monitor] HIGH #${num} posted → VIP: ${pair} ${timeframe} ${sig.direction} (${signalId})`);
  } catch (err) {
    console.error(`[monitor] Failed to post HIGH to VIP channel (${process.env.VIP_CHANNEL_ID}): ${err.message}`);
  }

  // Notify admin regardless
  try {
    await bot.api.sendMessage(
      process.env.ADMIN_TELEGRAM_ID,
      `🔥 <b>HIGH signal #${String(num).padStart(4,'0')} AUTO-POSTED to VIP</b>\n` +
      `${pair} ${timeframe} · ${sig.direction}\n` +
      `Entry: <code>${Number(sig.entry).toFixed(dec)}</code> | ID: <code>${signalId}</code>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error(`[monitor] Failed to notify admin: ${err.message}`);
  }
}

async function handleMediumSignal(bot, result) {
  const sig = result.signal;

  // Push to signal cache so MT4 EA can act on MEDIUM signals too
  updateSignal(result.pair, {
    direction:   sig.direction,
    confidence:  sig.confidence,
    entry:       sig.entry,
    stopLoss:    sig.stopLoss,
    takeProfit1: sig.takeProfit1,
    takeProfit2: sig.takeProfit2,
    takeProfit3: sig.takeProfit3,
  });

  try {
    await bot.api.sendMessage(
      process.env.ADMIN_TELEGRAM_ID,
      formatMediumAlert(result),
      { parse_mode: 'HTML' }
    );
    console.log(`[monitor] MEDIUM → admin DM: ${result.pair} ${sig.timeframe} ${sig.direction}`);
  } catch (err) {
    console.error(`[monitor] Failed to DM admin (ID: ${process.env.ADMIN_TELEGRAM_ID}): ${err.message}`);
  }
}

// ─── Main scan cycle ──────────────────────────────────────────────────────────

async function runOneCycle(bot) {
  pruneStale();

  console.log('[monitor] Scanning all pairs (XAUUSD/BTCUSD/EURUSD/GBPUSD/USDJPY/USDCHF/AUDUSD)…');
  const rows = await scanAllPairs();

  // 1. Check open signals for TP/SL hits first
  await checkTpHits(bot, rows);

  // 2. Look for new signals
  for (const row of rows) {
    if (!row.result) continue;
    const { pair, timeframe, result } = row;
    const sig = result.signal;

    if (sig.direction === 'WAIT') continue;

    // Skip if we already have an open signal for this combo
    if (hasOpenSignal(pair, timeframe, sig.direction)) {
      console.log(`[monitor] Skipping ${pair} ${timeframe} ${sig.direction} — signal already open`);
      continue;
    }

    if (sig.confidence === 'HIGH') {
      await handleHighSignal(bot, pair, timeframe, result);
    } else if (sig.confidence === 'MEDIUM') {
      await handleMediumSignal(bot, result);
    }

    await sleep(500);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the 24/7 live signal monitor.
 * @param {import('grammy').Bot} bot
 * @returns {{ stop: () => void }}
 */
export function startLiveMonitor(bot) {
  console.log('[monitor] 24/7 live monitor started — scanning every 45 min (XAUUSD/BTCUSD/EURUSD/GBPUSD/USDJPY/USDCHF/AUDUSD)');
  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      try {
        await runOneCycle(bot);
      } catch (err) {
        console.error('[monitor] Cycle error:', err.message);
      }
      if (!stopped) await sleep(SCAN_INTERVAL_MS);
    }
  };

  loop();
  return { stop: () => { stopped = true; } };
}
