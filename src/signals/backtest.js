/**
 * Walk-forward backtester — reuses the 300 OHLCV candles already fetched
 * from Twelve Data. Zero additional API credits consumed.
 *
 * Strategy:
 *   For each historical bar (starting after EMA200 warmup), build a mock
 *   market snapshot from candles[0..i], run the signal engine, then look
 *   ahead 30 bars to record whether SL or TP1/2/3 was hit first.
 *
 * SL takes priority within a candle (conservative — if low <= SL the trade
 * is stopped even if high also reached TP).
 */

import { fetchMarketData, calcRSI, calcMACD, latestEMA, calcATR, calcBBands } from './marketData.js';
import { generateSignal } from './engine.js';

const WARMUP    = 220; // min bars before engine has enough data (EMA200 needs 200+)
const LOOKAHEAD = 30;  // bars to search for SL/TP outcome
const SKIP      = 5;   // bars to skip after a signal (avoid clustering)

// ─── Build a mock market-data snapshot from a historical candle slice ─────────

function buildMockMd(oldest, i) {
  const slice  = oldest.slice(0, i + 1);
  const closes = slice.map(c => c.close).filter(v => v != null);
  const price  = slice[slice.length - 1]; // most recent candle in the slice

  // newest-first window for engine's candleMomentum() check
  const displayCandles = slice.slice(-30).reverse();

  return {
    price,
    candles:  displayCandles,
    rawOldest: slice,
    rsi14:  calcRSI(closes, 14, 5),
    macd:   calcMACD(closes),
    ma50:   latestEMA(closes, 50),
    ma200:  latestEMA(closes, 200),
    atr14:  calcATR(slice, 14),
    bbands: calcBBands(closes, 20),
    errors: {},
  };
}

// ─── Determine trade outcome from future candles ──────────────────────────────

function resolveOutcome(oldest, signalIndex, direction, entry, sl, tp1, tp2, tp3) {
  const end = Math.min(signalIndex + LOOKAHEAD, oldest.length - 1);
  for (let j = signalIndex + 1; j <= end; j++) {
    const c = oldest[j];
    if (direction === 'LONG') {
      if (c.low  != null && c.low  <= sl)  return { outcome: 'SL',  exitPrice: sl };
      if (tp3 != null && c.high != null && c.high >= tp3) return { outcome: 'TP3', exitPrice: tp3 };
      if (tp2 != null && c.high != null && c.high >= tp2) return { outcome: 'TP2', exitPrice: tp2 };
      if (tp1 != null && c.high != null && c.high >= tp1) return { outcome: 'TP1', exitPrice: tp1 };
    } else {
      if (c.high != null && c.high >= sl)  return { outcome: 'SL',  exitPrice: sl };
      if (tp3 != null && c.low  != null && c.low  <= tp3) return { outcome: 'TP3', exitPrice: tp3 };
      if (tp2 != null && c.low  != null && c.low  <= tp2) return { outcome: 'TP2', exitPrice: tp2 };
      if (tp1 != null && c.low  != null && c.low  <= tp1) return { outcome: 'TP1', exitPrice: tp1 };
    }
  }
  return { outcome: 'OPEN', exitPrice: null };
}

// ─── Main backtest runner ─────────────────────────────────────────────────────

/**
 * Run a walk-forward backtest on one pair/timeframe.
 * Uses 1 API credit (reuses candles from a single fetchMarketData call).
 *
 * @param {'XAUUSD'|'BTCUSD'} pair
 * @param {'H1'|'H4'|'M15'|'D1'} timeframe
 * @returns {Promise<{trades: Array, candleCount: number, timeframeDays: number}>}
 */
export async function runBacktest(pair, timeframe) {
  const md     = await fetchMarketData(pair, timeframe);
  const oldest = md.rawOldest; // oldest → newest, full 300 candles

  const trades = [];
  let i = WARMUP;

  while (i <= oldest.length - LOOKAHEAD - 1) {
    const mockMd = buildMockMd(oldest, i);
    const result = generateSignal(mockMd, pair, timeframe);
    const sig    = result.signal;

    if (sig.direction !== 'WAIT' && sig.confidence === 'HIGH') {
      const { outcome, exitPrice } = resolveOutcome(
        oldest, i,
        sig.direction, sig.entry,
        sig.stopLoss, sig.takeProfit1, sig.takeProfit2, sig.takeProfit3,
      );

      const pnl = exitPrice != null
        ? (sig.direction === 'LONG' ? exitPrice - sig.entry : sig.entry - exitPrice)
        : null;

      trades.push({
        datetime:  oldest[i].datetime,
        pair,
        timeframe,
        direction: sig.direction,
        entry:     sig.entry,
        sl:        sig.stopLoss,
        tp1:       sig.takeProfit1,
        tp2:       sig.takeProfit2,
        tp3:       sig.takeProfit3,
        outcome,
        exitPrice,
        pnl,
      });

      i += SKIP; // skip forward to avoid signal clustering
    } else {
      i++;
    }
  }

  // Estimate time window from first to last candle
  const msPerCandle = {
    M1: 60_000, M5: 300_000, M10: 600_000,
    M15: 900_000, H1: 3_600_000, H4: 14_400_000, D1: 86_400_000,
  };
  const ms      = (msPerCandle[timeframe] ?? 3_600_000) * oldest.length;
  const days    = Math.round(ms / 86_400_000);

  return { trades, candleCount: oldest.length, timeframeDays: days };
}

// ─── Stats helper ─────────────────────────────────────────────────────────────

export function summariseBacktest(trades, pair) {
  const dec = pair === 'BTCUSD' ? 0 : 2;
  const resolved = trades.filter(t => t.outcome !== 'OPEN');
  const wins  = resolved.filter(t => t.outcome !== 'SL');
  const losses= resolved.filter(t => t.outcome === 'SL');
  const tp3s  = resolved.filter(t => t.outcome === 'TP3').length;
  const tp2s  = resolved.filter(t => t.outcome === 'TP2').length;
  const tp1s  = resolved.filter(t => t.outcome === 'TP1').length;

  const winRate = resolved.length > 0 ? (wins.length / resolved.length * 100).toFixed(1) : '—';

  const pnlValues = resolved.map(t => t.pnl).filter(v => v != null);
  const totalPnl  = pnlValues.reduce((s, v) => s + v, 0);
  const bestWin   = wins.length  ? Math.max(...wins.map(t => t.pnl ?? 0))  : null;
  const worstLoss = losses.length ? Math.min(...losses.map(t => t.pnl ?? 0)) : null;

  return {
    total: trades.length, resolved: resolved.length,
    wins: wins.length, losses: losses.length,
    tp1s, tp2s, tp3s,
    winRate,
    totalPnl: +totalPnl.toFixed(dec),
    bestWin:  bestWin  != null ? +bestWin.toFixed(dec)   : null,
    worstLoss: worstLoss != null ? +worstLoss.toFixed(dec) : null,
  };
}
