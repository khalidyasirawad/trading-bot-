/**
 * Algorithmic signal engine — derives trade signals purely from Twelve Data
 * real-time indicators.  No LLM involved.
 *
 * Swing (M15/H1/H4/D1) — requires ALL 4 core factors:
 *   1. MACD histogram direction
 *   2. Price vs EMA50
 *   3. Price vs EMA200
 *   4. RSI in non-extreme zone for the direction
 *   → min R:R 3:1 | SL = 1.5× ATR or beyond recent swing
 *
 * Scalp (M1/M5/M10) — requires 4/4 core factors:
 *   1. MACD histogram expanding in direction
 *   2. Price vs EMA50
 *   3. RSI zone not against direction
 *   4. Recent candle momentum (price action confirmation)
 *   → min R:R 2:1 | SL = 1.0× ATR
 */

const SCALP_TFS = new Set(['M1', 'M5', 'M10']);
export const PAIR_DEC = {
  XAUUSD: 2,
  BTCUSD: 0,
  EURUSD: 5,
  GBPUSD: 5,
  USDJPY: 3,
  USDCHF: 5,
  AUDUSD: 5,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round(val, dec) {
  if (val == null || isNaN(val)) return null;
  const f = Math.pow(10, dec);
  return Math.round(val * f) / f;
}

function rsiSignal(rsi) {
  if (rsi == null) return 'UNAVAILABLE';
  if (rsi >= 70) return 'OVERBOUGHT';
  if (rsi <= 30) return 'OVERSOLD';
  return 'NEUTRAL';
}

function macdStatus(cur, prev) {
  if (!cur) return 'UNAVAILABLE';
  if (prev && prev.macd != null && cur.macd != null) {
    if (prev.macd < prev.signal && cur.macd >= cur.signal) return 'BULLISH'; // fresh crossover
    if (prev.macd > prev.signal && cur.macd <= cur.signal) return 'BEARISH';
  }
  if (cur.macd != null && cur.signal != null) {
    return cur.macd > cur.signal ? 'BULLISH' : 'BEARISH';
  }
  return cur.histogram != null ? (cur.histogram > 0 ? 'BULLISH' : 'BEARISH') : 'UNAVAILABLE';
}

function candleMomentum(candles) {
  if (!candles || candles.length < 3) return 'NEUTRAL';
  const recent = candles.slice(0, 5);
  const bull = recent.filter(c => c.close > c.open).length;
  const bear = recent.filter(c => c.close < c.open).length;
  if (bull >= 4) return 'BUYING';
  if (bear >= 4) return 'SELLING';
  if (bull >= 3) return 'BUYING';
  if (bear >= 3) return 'SELLING';
  return 'NEUTRAL';
}

function recentSwingLow(candles, n = 12) {
  const lows = candles.slice(0, n).map(c => c.low).filter(v => v != null);
  return lows.length ? Math.min(...lows) : null;
}

function recentSwingHigh(candles, n = 12) {
  const highs = candles.slice(0, n).map(c => c.high).filter(v => v != null);
  return highs.length ? Math.max(...highs) : null;
}

function buildWarnings(md) {
  const warnings = [];
  const errs = Object.entries(md.errors ?? {}).filter(([, v]) => v);
  if (errs.length > 0) warnings.push(`Missing data: ${errs.map(([k]) => k).join(', ')}`);
  if (!md.ma200) warnings.push('EMA200 unavailable — 4th factor skipped');
  return warnings;
}

// ─── Core factor labels ───────────────────────────────────────────────────────

const LONG_FACTOR_LABELS_SWING  = ['MACD histogram bullish', 'Price above EMA50', 'Price above EMA200', 'RSI in bullish zone'];
const SHORT_FACTOR_LABELS_SWING = ['MACD histogram bearish', 'Price below EMA50', 'Price below EMA200', 'RSI in bearish zone'];
const LONG_FACTOR_LABELS_SCALP  = ['MACD histogram expanding bullish', 'Price above EMA50', 'RSI not overbought', 'Bullish candle momentum'];
const SHORT_FACTOR_LABELS_SCALP = ['MACD histogram expanding bearish', 'Price below EMA50', 'RSI not oversold', 'Bearish candle momentum'];

// ─── WAIT signal builder ──────────────────────────────────────────────────────

function buildWait(pair, timeframe, md, reason) {
  const dec  = PAIR_DEC[pair] ?? 2;
  const rsi  = md.rsi14?.[0];
  const macd = md.macd?.[0];
  const prev = md.macd?.[1];
  const close = md.price?.close;

  const macroBase = pair === 'XAUUSD'
    ? { dxyTrend: 'UNAVAILABLE', realYields: 'UNAVAILABLE' }
    : { fearGreedIndex: null, dominance: 'UNAVAILABLE' };

  return {
    dataFreshness: 'LIVE',
    price: {
      current: close ?? null,
      change:    (close && md.price?.open) ? round(close - md.price.open, dec) : null,
      changePct: (close && md.price?.open) ? round(((close - md.price.open) / md.price.open) * 100, 2) : null,
      high: md.price?.high ?? null,
      low:  md.price?.low  ?? null,
      open: md.price?.open ?? null,
      source: 'Twelve Data API',
    },
    indicators: {
      rsi14:  { value: round(rsi, 2), signal: rsiSignal(rsi) },
      macd:   { histogram: round(macd?.histogram, 4), crossover: macdStatus(macd, prev) },
      ma50:   { value: round(md.ma50, dec),  relation: md.ma50  != null && close != null ? (close > md.ma50  ? 'ABOVE' : 'BELOW') : 'UNAVAILABLE' },
      ma200:  { value: round(md.ma200, dec), relation: md.ma200 != null && close != null ? (close > md.ma200 ? 'ABOVE' : 'BELOW') : 'UNAVAILABLE' },
      atr14:  round(md.atr14, 2),
      bollingerUpper: round(md.bbands?.upper,  dec),
      bollingerMid:   round(md.bbands?.middle, dec),
      bollingerLower: round(md.bbands?.lower,  dec),
    },
    volume: { pressure: candleMomentum(md.candles), note: 'Price momentum proxy' },
    macro: {
      headline: `No trade — ${reason}`,
      sentiment: 'NEUTRAL',
      ...macroBase,
      keyEvents: [],
    },
    signal: {
      direction: 'WAIT', confidence: 'LOW', timeframe,
      entry: null, stopLoss: null,
      takeProfit1: null, takeProfit2: null, takeProfit3: null,
      riskReward: '',
      reasoning: reason,
      entryLogic: 'No entry — conditions not met.',
      slLogic: '', tpLogic: '',
      conflictingFactors: [reason],
    },
    dataWarnings: buildWarnings(md),
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate a trade signal from Twelve Data market snapshot.
 *
 * @param {object} md     Return value of fetchMarketData()
 * @param {string} pair   'XAUUSD' | 'BTCUSD'
 * @param {string} timeframe  e.g. 'M5', 'H1'
 * @returns {object}  Full signal object matching the VIP signal schema
 */
export function generateSignal(md, pair, timeframe) {
  const dec     = PAIR_DEC[pair] ?? 2;
  const isScalp = SCALP_TFS.has(timeframe);

  const close   = md.price?.close;
  const atr     = md.atr14;
  const rsi     = md.rsi14?.[0];
  const macd    = md.macd?.[0];
  const macdPrev = md.macd?.[1];

  if (!close || !atr) {
    return buildWait(pair, timeframe, md, 'Insufficient Twelve Data: price or ATR missing');
  }

  // ── Evaluate each factor ──────────────────────────────────────────────────

  const macdBull      = macd != null && macd.histogram > 0;
  const macdBear      = macd != null && macd.histogram < 0;
  const macdExpanding = macd != null && macdPrev != null
    && Math.abs(macd.histogram) > Math.abs(macdPrev.histogram);

  const aboveEma50  = md.ma50  != null && close > md.ma50;
  const belowEma50  = md.ma50  != null && close < md.ma50;
  const aboveEma200 = md.ma200 != null && close > md.ma200;
  const belowEma200 = md.ma200 != null && close < md.ma200;

  // RSI zones: for LONG we want RSI above 40 and below 75 (room to run, not overbought)
  //            for SHORT we want RSI below 60 and above 25 (room to fall, not oversold)
  const rsiBullOk = rsi != null && rsi > 40 && rsi < 75;
  const rsiBearOk = rsi != null && rsi < 60 && rsi > 25;

  const momentum  = candleMomentum(md.candles);
  const bullMomentum = momentum === 'BUYING';
  const bearMomentum = momentum === 'SELLING';

  // ── Score core factors ────────────────────────────────────────────────────

  let longCore, shortCore;
  let longLabels, shortLabels;

  if (isScalp) {
    // Scalp: momentum confirmation replaces EMA200
    longCore   = [macdBull && macdExpanding, aboveEma50, rsiBullOk, bullMomentum];
    shortCore  = [macdBear && macdExpanding, belowEma50, rsiBearOk, bearMomentum];
    longLabels  = LONG_FACTOR_LABELS_SCALP;
    shortLabels = SHORT_FACTOR_LABELS_SCALP;
  } else {
    // Swing: EMA200 is the 4th core factor
    longCore   = [macdBull, aboveEma50, aboveEma200, rsiBullOk];
    shortCore  = [macdBear, belowEma50, belowEma200, rsiBearOk];
    longLabels  = LONG_FACTOR_LABELS_SWING;
    shortLabels = SHORT_FACTOR_LABELS_SWING;
  }

  const longScore  = longCore.filter(Boolean).length;
  const shortScore = shortCore.filter(Boolean).length;

  // ── Determine direction and confidence ───────────────────────────────────
  // 4/4 factors → HIGH  (auto-post to VIP)
  // 3/4 factors → MEDIUM (suggest to admin in DM)
  // <3           → WAIT

  let direction = 'WAIT';
  let confidence = 'LOW';
  let alignedLabels = [];
  let conflicting   = [];
  let missingLabels = [];

  if (longScore >= 3 && longScore > shortScore) {
    direction  = 'LONG';
    confidence = longScore === 4 ? 'HIGH' : 'MEDIUM';
    alignedLabels = longLabels.filter((_, i) => longCore[i]);
    missingLabels = longLabels.filter((_, i) => !longCore[i]);
    if (macdBear)     conflicting.push('MACD histogram also shows recent bearish pressure');
    if (!aboveEma200 && !isScalp) conflicting.push('Price below EMA200 (caution)');
    if (rsi != null && rsi > 68)  conflicting.push(`RSI approaching overbought (${round(rsi, 1)})`);
  } else if (shortScore >= 3 && shortScore > longScore) {
    direction  = 'SHORT';
    confidence = shortScore === 4 ? 'HIGH' : 'MEDIUM';
    alignedLabels = shortLabels.filter((_, i) => shortCore[i]);
    missingLabels = shortLabels.filter((_, i) => !shortCore[i]);
    if (macdBull)     conflicting.push('MACD histogram also shows recent bullish pressure');
    if (aboveEma200 && !isScalp)  conflicting.push('Price above EMA200 (caution — counter-trend)');
    if (rsi != null && rsi < 32)  conflicting.push(`RSI approaching oversold (${round(rsi, 1)})`);
  } else {
    if (macdBull && belowEma50)   conflicting.push('MACD bullish but price below EMA50');
    if (macdBear && aboveEma50)   conflicting.push('MACD bearish but price above EMA50');
    if (!isScalp && aboveEma50 && belowEma200) conflicting.push('Price above EMA50 but below EMA200 — consolidation zone');
    if (rsi != null && rsi > 72)  conflicting.push(`RSI overbought at ${round(rsi, 1)}`);
    if (rsi != null && rsi < 28)  conflicting.push(`RSI oversold at ${round(rsi, 1)}`);
    if (longScore === shortScore)  conflicting.push(`${longScore}/4 factors each side — no clear direction`);

    return buildWait(pair, timeframe, md,
      conflicting.join('. ') || 'Insufficient factor alignment for a trade');
  }

  // ── Calculate trade levels ────────────────────────────────────────────────

  const long       = direction === 'LONG';
  const slMult     = isScalp ? 1.0 : 1.5;
  const atrSlDist  = round(atr * slMult, dec);

  let sl;
  if (isScalp) {
    // Scalp: pure ATR stop
    sl = round(long ? close - atrSlDist : close + atrSlDist, dec);
  } else {
    // Swing: ATR stop vs recent swing structure, use tighter of the two
    const swingRef = long ? recentSwingLow(md.candles) : recentSwingHigh(md.candles);
    const atrSl    = round(long ? close - atrSlDist : close + atrSlDist, dec);
    if (swingRef != null) {
      const swingSl = round(long ? swingRef - atr * 0.2 : swingRef + atr * 0.2, dec);
      // Tighter SL = higher for LONG (closer to price), lower for SHORT
      sl = long ? Math.max(atrSl, swingSl) : Math.min(atrSl, swingSl);
    } else {
      sl = atrSl;
    }
  }

  const slDist = Math.abs(close - sl);

  const [tp1Mult, tp2Mult, tp3Mult] = isScalp ? [0.5, 1.0, 2.0] : [1.0, 2.0, 3.0];
  const tp1 = round(long ? close + tp1Mult * slDist : close - tp1Mult * slDist, dec);
  const tp2 = round(long ? close + tp2Mult * slDist : close - tp2Mult * slDist, dec);
  const tp3 = round(long ? close + tp3Mult * slDist : close - tp3Mult * slDist, dec);

  const rrStr = isScalp ? '1:0.5 / 1:1.0 / 1:2.0' : '1:1 / 1:2 / 1:3';

  // ── Reasoning text ────────────────────────────────────────────────────────

  const rsiDesc   = rsi != null ? `RSI ${round(rsi, 1)} (${rsiSignal(rsi).toLowerCase()})` : 'RSI N/A';
  const macdDesc  = macd != null
    ? `MACD hist ${round(macd.histogram, 3) > 0 ? '+' : ''}${round(macd.histogram, 3)} (${macdExpanding ? 'expanding' : 'contracting'})`
    : 'MACD N/A';
  const ema50Desc = md.ma50 != null ? `EMA50 at ${round(md.ma50, dec)} (price ${long ? 'above' : 'below'})` : 'EMA50 N/A';
  const ema200Desc = md.ma200 != null ? `EMA200 at ${round(md.ma200, dec)} (price ${long ? 'above' : 'below'})` : 'EMA200 N/A';
  const momentumDesc = isScalp ? `${momentum.toLowerCase()} momentum on recent candles` : '';

  const reasonParts = isScalp
    ? [macdDesc, ema50Desc, rsiDesc, momentumDesc]
    : [macdDesc, ema50Desc, ema200Desc, rsiDesc];

  const factorCount = long ? longScore : shortScore;
  const reasoning = `${direction} — ${factorCount}/4 factors aligned: ${reasonParts.filter(Boolean).join(', ')}. ATR(14): ${round(atr, 2)} → SL at ${round(slDist, dec)} ${long ? 'below' : 'above'} entry.`;

  // ── Macro block ───────────────────────────────────────────────────────────
  // No live macro from Twelve Data — fields set to UNAVAILABLE as reminder to check news.
  const macroBlock = pair === 'XAUUSD'
    ? { headline: 'Technical signal only — verify vs DXY & news before entry.', sentiment: long ? 'BULLISH' : 'BEARISH', dxyTrend: 'UNAVAILABLE', realYields: 'UNAVAILABLE', keyEvents: [] }
    : { headline: 'Technical signal only — check Fear & Greed & news before entry.', sentiment: long ? 'BULLISH' : 'BEARISH', fearGreedIndex: null, dominance: 'UNAVAILABLE', keyEvents: [] };

  // ── Assemble result ───────────────────────────────────────────────────────

  return {
    dataFreshness: 'LIVE',
    price: {
      current:   close,
      change:    round(close - md.price.open, dec),
      changePct: round(((close - md.price.open) / md.price.open) * 100, 2),
      high:   md.price.high,
      low:    md.price.low,
      open:   md.price.open,
      source: 'Twelve Data API (real-time)',
    },
    indicators: {
      rsi14:  { value: round(rsi, 2), signal: rsiSignal(rsi) },
      macd:   { histogram: round(macd?.histogram, 4), crossover: macdStatus(macd, macdPrev) },
      ma50:   { value: round(md.ma50, dec),  relation: md.ma50  != null ? (close > md.ma50  ? 'ABOVE' : 'BELOW') : 'UNAVAILABLE' },
      ma200:  { value: round(md.ma200, dec), relation: md.ma200 != null ? (close > md.ma200 ? 'ABOVE' : 'BELOW') : 'UNAVAILABLE' },
      atr14:  round(atr, 2),
      bollingerUpper: round(md.bbands?.upper,  dec),
      bollingerMid:   round(md.bbands?.middle, dec),
      bollingerLower: round(md.bbands?.lower,  dec),
    },
    volume: {
      pressure: momentum,
      note: 'Derived from recent price candle momentum',
    },
    macro: macroBlock,
    signal: {
      direction,
      confidence,
      timeframe,
      entry:       round(close, dec),
      stopLoss:    sl,
      takeProfit1: tp1,
      takeProfit2: tp2,
      takeProfit3: tp3,
      riskReward:  rrStr,
      reasoning,
      entryLogic:  `Enter at market ${round(close, dec)}. ${factorCount}/4 factors aligned: ${alignedLabels.join(', ')}.`,
      slLogic:     isScalp
        ? `SL = ${round(close, dec)} ${long ? '-' : '+'} ${slMult}×ATR(${round(atr, 2)}) = ${sl}.`
        : `SL = ${round(close, dec)} ${long ? '-' : '+'} ${slMult}×ATR(${round(atr, 2)}) or beyond ${long ? 'swing low' : 'swing high'} = ${sl}.`,
      tpLogic:     isScalp
        ? `Scale out: TP1 at 0.5:1 R:R (${tp1}), TP2 at 1:1 (${tp2}), TP3 at 2:1 (${tp3}).`
        : `Scale out: TP1 at 1:1 R:R (${tp1}), TP2 at 2:1 (${tp2}), TP3 at 3:1 (${tp3}).`,
      conflictingFactors: conflicting,
      missingFactors: missingLabels,
    },
    dataWarnings: buildWarnings(md),
  };
}
