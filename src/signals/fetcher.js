/**
 * Signal fetcher — pulls live market data from Twelve Data, then runs the
 * algorithmic signal engine.  No LLM involved.
 *
 * Public API (unchanged):
 *   fetchSignal(pair, timeframe)           → fresh market data + signal
 *   fetchSignalFromData(pair, tf, md)      → signal from pre-fetched data (scanner)
 *   fetchPublicSignal / fetchVipSignal / fetchManualSignal  → aliases
 *   isActionableSignal(result)             → boolean
 */

import { fetchMarketData } from './marketData.js';
import { generateSignal }  from './engine.js';

export const SCALP_TFS = new Set(['M1', 'M5', 'M10']);
export const SWING_TFS = new Set(['M15', 'H1', 'H4', 'D1']);
export const ALL_TFS   = [...SCALP_TFS, ...SWING_TFS];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch live market data from Twelve Data and generate a signal.
 * Used for individual /signal commands.
 *
 * @param {'XAUUSD'|'BTCUSD'} pair
 * @param {'M1'|'M5'|'M10'|'M15'|'H1'|'H4'|'D1'} timeframe
 * @returns {Promise<object>}  Full signal object with top-level `pair` field
 */
export async function fetchSignal(pair = 'XAUUSD', timeframe = 'H4') {
  const md     = await fetchMarketData(pair, timeframe);
  const result = generateSignal(md, pair, timeframe);

  const errs = Object.entries(md.errors).filter(([, v]) => v);
  if (errs.length > 0) {
    console.warn(`[fetcher] ${pair} ${timeframe} partial data:`, errs.map(([k, v]) => `${k}: ${v}`).join(', '));
  }

  return { pair, ...result };
}

/**
 * Generate a signal from pre-fetched market data.
 * Used by the scanner which pre-fetches data sequentially.
 *
 * @param {'XAUUSD'|'BTCUSD'} pair
 * @param {'M1'|'M5'|'M10'|'M15'|'H1'|'H4'|'D1'} timeframe
 * @param {object|null} md  Pre-fetched result from fetchMarketData(), or null to re-fetch
 */
export async function fetchSignalFromData(pair, timeframe, md = null) {
  const data   = md ?? await fetchMarketData(pair, timeframe);
  const result = generateSignal(data, pair, timeframe);
  return { pair, ...result };
}

// Aliases used by scheduler and admin commands
export const fetchPublicSignal = fetchSignal;
export const fetchVipSignal    = fetchSignal;
export const fetchManualSignal = fetchSignal;

/**
 * Returns true when a signal meets the HIGH-confidence actionable threshold.
 */
export function isActionableSignal(result) {
  return result.signal.direction !== 'WAIT' && result.signal.confidence === 'HIGH';
}
