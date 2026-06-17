/**
 * Twelve Data API client — fetches OHLCV candles and calculates all technical
 * indicators locally from the raw candle data.
 *
 * ONE API credit per setup (only /time_series is called).
 * Old approach: 7 endpoints × 8 setups = 56 credits → constant 429s on free tier.
 * New approach: 1 endpoint × 8 setups = 8 credits → fits within 8 credits/minute.
 *
 * Supported timeframes:
 *   Scalp  → M1 (1min), M5 (5min), M10 (5min candles / 10-min horizon)
 *   Swing  → M15 (15min), H1 (1h), H4 (4h), D1 (1day)
 */

const BASE_URL = 'https://api.twelvedata.com';

const SYMBOL_MAP = { XAUUSD: 'XAU/USD', BTCUSD: 'BTC/USD' };
const TF_MAP = {
  M1: '1min', M5: '5min', M10: '5min',
  M15: '15min', H1: '1h', H4: '4h', D1: '1day',
};

// 300 candles: enough for EMA200 warm-up (200 periods + 100 buffer)
const OUTPUTSIZE = 300;

// How many recent candles to expose in the returned object
const CANDLE_EXPOSE = {
  M1: 60, M5: 50, M10: 50,
  M15: 30, H1: 30, H4: 30, D1: 30,
};

const EMA_CONTEXT = {
  M1:  { ema50: '50-minute trend',  ema200: '3h20m trend'   },
  M5:  { ema50: '4h10m trend',      ema200: '16h40m trend'  },
  M10: { ema50: '4h10m trend',      ema200: '16h40m trend'  },
  M15: { ema50: '12h30m trend',     ema200: '2-day trend'   },
  H1:  { ema50: '50-hour trend',    ema200: '8-day trend'   },
  H4:  { ema50: '~8-day trend',     ema200: '33-day trend'  },
  D1:  { ema50: '50-day trend',     ema200: '200-day trend' },
};

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function tdGet(path, params, retries = 3) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('apikey', process.env.TWELVE_DATA_API_KEY);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (res.status === 429) {
      if (attempt < retries) {
        const wait = 15_000 * (attempt + 1); // 15s → 30s → 45s
        console.warn(`[marketData] 429 rate limit — waiting ${wait / 1000}s (attempt ${attempt + 1}/${retries})`);
        await sleep(wait);
        continue;
      }
      throw new Error(`HTTP 429 rate limit (${retries} retries exhausted)`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from Twelve Data`);
    const json = await res.json();
    if (json.status === 'error') throw new Error(`Twelve Data: ${json.message}`);
    return json;
  }
}

function safeFloat(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// ─── Local indicator calculations ─────────────────────────────────────────────
// All inputs are ordered oldest → newest.
// Functions are exported so backtest.js can reuse them without extra API calls.

// EMA series — returns array same length as input; pre-periods are null.
export function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    out[i] = alpha * values[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

export function latestEMA(closes, period) {
  const s = emaSeries(closes, period);
  return s[s.length - 1];
}

// RSI(14) — returns up to `count` values, newest first.
export function calcRSI(closes, period = 14, count = 5) {
  if (closes.length < period + 1) return [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;

  const rsis = [];
  const push = () => rsis.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  push();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    push();
  }
  // rsis is oldest-first; return newest-first slice
  return rsis.slice(-count).reverse();
}

// ATR(14) using Wilder's smoothing — candles must be oldest→newest.
export function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prev = candles[i - 1].close;
    if (high == null || low == null || prev == null) continue;
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

// MACD(12,26,9) — returns up to `count` values, newest first.
export function calcMACD(closes, fast = 12, slow = 26, sig = 9, count = 5) {
  if (closes.length < slow + sig) return [];
  const ema12 = emaSeries(closes, fast);
  const ema26 = emaSeries(closes, slow);
  const macdLine = closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null
  );
  // EMA9 of MACD line, skipping leading nulls
  const firstValid = macdLine.findIndex(v => v != null);
  const validMacd = macdLine.slice(firstValid);
  const sigRaw = emaSeries(validMacd, sig);
  // Re-align signal line back to full array length
  const sigLine = new Array(firstValid).fill(null).concat(sigRaw);

  const result = [];
  for (let i = closes.length - 1; i >= 0 && result.length < count; i--) {
    if (macdLine[i] != null && sigLine[i] != null) {
      result.push({ macd: macdLine[i], signal: sigLine[i], histogram: macdLine[i] - sigLine[i] });
    }
  }
  return result; // newest first
}

// Bollinger Bands(20,2)
export function calcBBands(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std };
}

// ─── Main fetch function ──────────────────────────────────────────────────────

/**
 * Fetch OHLCV candles from Twelve Data and compute all indicators locally.
 * Uses exactly 1 API credit per call.
 *
 * @param {'XAUUSD'|'BTCUSD'} pair
 * @param {'M1'|'M5'|'M10'|'M15'|'H1'|'H4'|'D1'} timeframe
 * @returns {Promise<object>}  Structured market snapshot; missing fields are null.
 */
export async function fetchMarketData(pair, timeframe) {
  const symbol   = SYMBOL_MAP[pair];
  const interval = TF_MAP[timeframe];

  if (!symbol)   throw new Error(`Unknown pair: ${pair}`);
  if (!interval) throw new Error(`Unknown timeframe: ${timeframe}`);
  if (!process.env.TWELVE_DATA_API_KEY) throw new Error('TWELVE_DATA_API_KEY not set');

  const tsJson = await tdGet('/time_series', { symbol, interval, outputsize: OUTPUTSIZE });

  const rawCandles = (tsJson.values ?? []).map(c => ({
    datetime: c.datetime,
    open:   safeFloat(c.open),
    high:   safeFloat(c.high),
    low:    safeFloat(c.low),
    close:  safeFloat(c.close),
    volume: c.volume ? safeFloat(c.volume) : null,
  }));

  // Twelve Data returns newest-first; reverse to oldest-first for indicator math
  const oldest = [...rawCandles].reverse();
  const closes = oldest.map(c => c.close).filter(v => v != null);

  const rsi14  = calcRSI(closes, 14, 5);
  const macd   = calcMACD(closes);
  const ma50   = latestEMA(closes, 50);
  const ma200  = latestEMA(closes, 200);
  const atr14  = calcATR(oldest, 14);
  const bbands = calcBBands(closes, 20);

  const exposeCount = CANDLE_EXPOSE[timeframe] ?? 30;
  const candles = rawCandles.slice(0, exposeCount); // newest-first for display

  return {
    symbol,
    interval,
    timeframe,
    fetchedAt: new Date().toISOString(),
    price:  candles[0] ?? null,
    candles,
    rawOldest: oldest,  // full 300-candle array oldest→newest, used by backtest.js
    rsi14,
    macd,
    ma50,
    ma200,
    bbands,
    atr14,
    errors: {
      timeSeries: rawCandles.length === 0 ? 'No candles returned'         : null,
      rsi:    rsi14.length === 0          ? 'Insufficient data for RSI'   : null,
      macd:   macd.length === 0           ? 'Insufficient data for MACD'  : null,
      ma50:   ma50 == null                ? 'Insufficient data for EMA50'  : null,
      ma200:  ma200 == null               ? 'Insufficient data for EMA200' : null,
      bbands: bbands == null              ? 'Insufficient data for BBands' : null,
      atr:    atr14 == null               ? 'Insufficient data for ATR'   : null,
    },
  };
}

// ─── Debug/display helper ─────────────────────────────────────────────────────

/**
 * Format a fetchMarketData() result into a compact plain-text block.
 * @param {object} md   Return value of fetchMarketData()
 * @param {string} pair e.g. 'XAUUSD'
 * @returns {string}
 */
export function formatMarketDataBlock(md, pair) {
  const dec = pair === 'BTCUSD' ? 0 : 2;
  const f = (n, d = dec) => (n == null ? 'N/A' : Number(n).toFixed(d));
  const tf = md.timeframe ?? md.interval;
  const emaCtx = EMA_CONTEXT[tf] ?? { ema50: '50-period trend', ema200: '200-period trend' };
  const intervalNote = tf === 'M10' ? 'M10 (5-min candles, 10-min scalping horizon)' : tf;

  const lines = [
    '━━━ LIVE MARKET DATA (Twelve Data API) ━━━━━━━━━━━━━━━━━━',
    `Asset: ${md.symbol} | Timeframe: ${intervalNote} | Fetched: ${md.fetchedAt}`,
    '',
  ];

  if (md.price) {
    const p = md.price;
    const change    = (p.close != null && p.open != null) ? (p.close - p.open).toFixed(dec) : 'N/A';
    const changePct = (p.close != null && p.open != null)
      ? (((p.close - p.open) / p.open) * 100).toFixed(2) + '%' : 'N/A';
    lines.push(
      'PRICE (latest candle):',
      `  Close: ${f(p.close)}   Open: ${f(p.open)}`,
      `  High:  ${f(p.high)}   Low:  ${f(p.low)}`,
      `  Change: ${change} (${changePct})`,
      p.volume != null ? `  Volume: ${p.volume}` : '',
      `  Datetime: ${p.datetime}`,
      '',
    );
  }

  const candleRows = ['M1', 'M5', 'M10'].includes(tf) ? 30 : 15;
  if (md.candles.length > 1) {
    lines.push(`RECENT CANDLES — ${tf} (newest → oldest):`);
    lines.push('  Datetime             Open       High       Low        Close');
    for (const c of md.candles.slice(0, candleRows)) {
      lines.push(
        `  ${c.datetime.padEnd(21)}` +
        f(c.open).padStart(10) + f(c.high).padStart(10) +
        f(c.low).padStart(10)  + f(c.close).padStart(10),
      );
    }
    lines.push('');
  }

  lines.push('TECHNICAL INDICATORS (calculated locally):');

  if (md.rsi14.length > 0) {
    const cur = md.rsi14[0], prev = md.rsi14[1];
    const trend = cur != null && prev != null ? (cur > prev ? 'trending UP' : 'trending DOWN') : '';
    const zone  = cur != null ? (cur >= 70 ? '→ OVERBOUGHT' : cur <= 30 ? '→ OVERSOLD' : '→ NEUTRAL') : '';
    const seq   = [f(cur, 2), prev != null ? f(prev, 2) : null].filter(Boolean).join(' → ');
    lines.push(`  RSI(14):    ${seq} ${trend} ${zone}`);
  } else {
    lines.push('  RSI(14):    N/A');
  }

  if (md.macd.length > 0) {
    const cur = md.macd[0], prev = md.macd[1];
    const expanding = cur?.histogram != null && prev?.histogram != null
      ? (Math.abs(cur.histogram) > Math.abs(prev.histogram) ? 'EXPANDING' : 'CONTRACTING') : '';
    const histDir = cur?.histogram != null ? (cur.histogram > 0 ? '(bullish)' : '(bearish)') : '';
    lines.push(`  MACD:       Line ${f(cur?.macd, 4)}  Signal ${f(cur?.signal, 4)}  Hist ${f(cur?.histogram, 4)} ${expanding} ${histDir}`);
    if (prev) lines.push(`  MACD prev:  Hist ${f(prev.histogram, 4)}`);
  } else {
    lines.push('  MACD:       N/A');
  }

  const close = md.price?.close;
  const ma50rel  = close != null && md.ma50  != null ? (close > md.ma50  ? '[ABOVE → bullish]' : '[BELOW → bearish]') : '';
  const ma200rel = close != null && md.ma200 != null ? (close > md.ma200 ? '[ABOVE → bullish]' : '[BELOW → bearish]') : '';
  lines.push(`  EMA(50):    ${f(md.ma50)}  [${emaCtx.ema50}]  ${ma50rel}`);
  lines.push(`  EMA(200):   ${f(md.ma200)}  [${emaCtx.ema200}]  ${ma200rel}`);

  if (md.bbands) {
    const { upper, middle, lower } = md.bbands;
    const bbPos = close != null && upper != null && lower != null
      ? (close > upper  ? '→ ABOVE upper band'
        : close < lower ? '→ BELOW lower band'
        : close > middle ? '→ upper half of range'
        : '→ lower half of range')
      : '';
    lines.push(`  BB(20):     Upper ${f(upper)}  Mid ${f(middle)}  Lower ${f(lower)}  ${bbPos}`);
  } else {
    lines.push('  BB(20):     N/A');
  }

  lines.push(`  ATR(14):    ${f(md.atr14, 2)}  [avg candle range — use for SL sizing]`);

  const errs = Object.entries(md.errors).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  if (errs.length > 0) lines.push('', `  ⚠ Data gaps: ${errs.join(' | ')}`);

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.filter(l => l !== undefined).join('\n');
}
