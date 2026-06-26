/**
 * Signal scanner — fetches all pair/timeframe combos, scores each result,
 * and returns a ranked list.
 *
 * Rate-limit strategy (Twelve Data free tier = 8 credits/minute):
 *   1. Market data is pre-fetched SEQUENTIALLY with a gap between setups.
 *   2. Signal engine runs in PARALLEL across all setups (no API calls — instant).
 *   This prevents 429 storms while keeping signal analysis fast.
 *
 * Swing scoring weights:
 *   HIGH confidence          +50 pts
 *   R:R at TP3 (×10)        e.g. 3:1 → +30 pts
 *   MACD crossover aligned   +10 pts
 *   EMA50 correct side        +8 pts
 *   EMA200 correct side       +8 pts
 *   Volume pressure aligned   +6 pts
 *   Macro sentiment aligned   +5 pts
 *   LIVE data freshness        +4 pts
 *
 * Scalp scoring weights (same structure, but 2:1 R:R already scores 20 pts):
 *   HIGH confidence          +50 pts
 *   R:R (×10)               e.g. 2:1 → +20 pts
 *   MACD histogram expanding +10 pts
 *   EMA50 correct side        +8 pts
 *   RSI not extreme against   +8 pts
 *   Volume aligned            +6 pts
 *   Macro aligned             +5 pts
 *   LIVE data                  +4 pts
 */

import { fetchMarketData, sleep } from './marketData.js';
import { fetchSignalFromData, SCALP_TFS, SWING_TFS } from './fetcher.js';

export const SWING_TIMEFRAMES = [...SWING_TFS]; // ['M15','H1','H4','D1']
export const SCALP_TIMEFRAMES = [...SCALP_TFS]; // ['M1','M5','M10']
const PAIRS       = ['XAUUSD', 'BTCUSD'];
const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD'];
const FOREX_TFS   = ['H1', 'H4', 'D1'];

// Gap between sequential market data fetches.
// Each setup now uses exactly 1 API credit (all indicators calculated locally).
// 8 setups × 1 credit = 8 total credits; free tier allows 8/min → 10s gap is safe.
const MARKET_DATA_GAP_MS = 10_000;

// ─── Scoring ──────────────────────────────────────────────────────────────────

function parseRR(rrString) {
  if (!rrString) return 0;
  const matches = rrString.match(/[\d.]+/g);
  if (!matches || matches.length < 2) return 0;
  const last = parseFloat(matches[matches.length - 1]);
  return isNaN(last) ? 0 : last;
}

export function scoreSignal(result) {
  let score = 0;
  const { signal, indicators, volume, macro, dataFreshness } = result;

  if (!signal || signal.direction === 'WAIT') return 0;
  if (signal.confidence === 'HIGH')   score += 50;
  else if (signal.confidence === 'MEDIUM') score += 15;
  else return 0;

  score += parseRR(signal.riskReward) * 10;

  const long = signal.direction === 'LONG';
  if (indicators?.macd?.crossover === (long ? 'BULLISH' : 'BEARISH')) score += 10;
  if (indicators?.ma50?.relation  === (long ? 'ABOVE'   : 'BELOW'))   score += 8;
  if (indicators?.ma200?.relation === (long ? 'ABOVE'   : 'BELOW'))   score += 8;
  if (volume?.pressure            === (long ? 'BUYING'  : 'SELLING')) score += 6;
  if (macro?.sentiment            === (long ? 'BULLISH' : 'BEARISH')) score += 5;
  if (dataFreshness === 'LIVE') score += 4;

  return score;
}

// ─── Core scan engine ─────────────────────────────────────────────────────────

/**
 * Pre-fetch market data sequentially (rate-limit safe), then run the
 * signal engine in parallel (no API calls — instant).
 *
 * @param {string[]} pairs
 * @param {string[]} timeframes
 * @returns {Promise<Array<{pair, timeframe, result, score, error}>>}  Sorted best-first
 */
async function runScan(pairs, timeframes, customTasks = null) {
  const tasks = customTasks
    ?? pairs.flatMap(p => timeframes.map(tf => ({ pair: p, timeframe: tf })));

  // ── Step 1: sequential market data fetch ──────────────────────────────────
  console.log(`[scanner] Pre-fetching market data for ${tasks.length} setups (sequential)…`);
  const mdMap = new Map();

  for (let i = 0; i < tasks.length; i++) {
    const { pair, timeframe } = tasks[i];
    const key = `${pair}_${timeframe}`;
    try {
      mdMap.set(key, await fetchMarketData(pair, timeframe));
      console.log(`[scanner] Market data OK: ${pair} ${timeframe}`);
    } catch (err) {
      console.warn(`[scanner] Market data failed: ${pair} ${timeframe} — ${err.message}`);
      mdMap.set(key, null);
    }
    if (i < tasks.length - 1) await sleep(MARKET_DATA_GAP_MS);
  }

  // ── Step 2: parallel signal engine (no API calls) ────────────────────────
  console.log(`[scanner] Computing signals for ${tasks.length} setups (Twelve Data engine)…`);
  const settled = await Promise.allSettled(
    tasks.map(({ pair, timeframe }) =>
      fetchSignalFromData(pair, timeframe, mdMap.get(`${pair}_${timeframe}`))
    )
  );

  // ── Step 3: score and sort ────────────────────────────────────────────────
  const rows = tasks.map(({ pair, timeframe }, i) => {
    const outcome = settled[i];
    if (outcome.status === 'rejected') {
      return { pair, timeframe, result: null, score: 0, error: outcome.reason?.message ?? 'unknown error' };
    }
    const result = outcome.value;
    const score  = scoreSignal(result);
    return { pair, timeframe, result, score, error: null };
  });

  return rows.sort((a, b) => b.score - a.score);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan all swing setups: XAUUSD + BTCUSD × M15/H1/H4/D1 (8 total).
 * @returns {Promise<Array>}
 */
export async function scanAllSignals() {
  return runScan(PAIRS, SWING_TIMEFRAMES);
}

/**
 * Scan all scalp setups: XAUUSD + BTCUSD × M1/M5/M10 (6 total).
 * @returns {Promise<Array>}
 */
export async function scanScalpSignals() {
  return runScan(PAIRS, SCALP_TIMEFRAMES);
}

/**
 * Scan all pairs for the 24/7 live monitor:
 *   XAUUSD + BTCUSD × M15/H1/H4/D1  (8 setups)
 *   EURUSD + GBPUSD + USDJPY + USDCHF + AUDUSD × H1/H4/D1  (15 setups)
 *   Total: 23 setups — at 45-min interval ≈ 736 credits/day (limit 800/day)
 * @returns {Promise<Array>}
 */
export async function scanAllPairs() {
  const tasks = [
    ...PAIRS.flatMap(p => SWING_TIMEFRAMES.map(tf => ({ pair: p, timeframe: tf }))),
    ...FOREX_PAIRS.flatMap(p => FOREX_TFS.map(tf => ({ pair: p, timeframe: tf }))),
  ];
  return runScan(null, null, tasks);
}
