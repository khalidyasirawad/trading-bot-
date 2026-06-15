/**
 * Formats signal API responses into Telegram HTML messages.
 *
 * All format functions accept the full rich signal object returned by fetcher.js:
 * { pair, dataFreshness, price, indicators, volume, macro, signal, dataWarnings }
 *
 * Telegram HTML subset: <b>, <i>, <code>, <pre>, <a>
 */

const DIR_EMOJI = { LONG: '🟢', SHORT: '🔴', WAIT: '⏸' };
const CONF_EMOJI = { HIGH: '🔥', MEDIUM: '⚡', LOW: '💡' };
const PAIR_EMOJI = { XAUUSD: '🥇', BTCUSD: '₿' };
const SENTIMENT_EMOJI = { BULLISH: '📈', BEARISH: '📉', NEUTRAL: '➡️' };
const VOL_EMOJI = { BUYING: '🟢', SELLING: '🔴', NEUTRAL: '⚪' };

const SCALP_TFS = new Set(['M1', 'M5', 'M10']);
const isScalp = (tf) => SCALP_TFS.has(tf);

function fmt(val, decimals = 2) {
  if (val === null || val === undefined) return 'N/A';
  return Number(val).toFixed(decimals);
}

function fmtChange(change, pct) {
  if (change === null) return '';
  const sign = change >= 0 ? '+' : '';
  const pctStr = pct !== null ? ` (${sign}${fmt(pct, 2)}%)` : '';
  return `${sign}${fmt(change, 2)}${pctStr}`;
}

// ─── Public channel signal (direction-only, no entry/SL/TP) ──────────────────

/**
 * Format a teaser post for the public channel.
 * Shows direction, confidence, reasoning, and macro headline only.
 * @param {object} data  Full signal object from fetcher
 */
export function formatPublicSignal(data) {
  const { pair, price, macro, signal } = data;
  const pairEmoji = PAIR_EMOJI[pair] ?? '📊';
  const dirEmoji = DIR_EMOJI[signal.direction] ?? '❓';
  const confEmoji = CONF_EMOJI[signal.confidence] ?? '';
  const sentEmoji = SENTIMENT_EMOJI[macro?.sentiment] ?? '';

  const priceStr = price?.current != null
    ? `<code>${fmt(price.current, pair === 'BTCUSD' ? 0 : 2)}</code>  <i>${fmtChange(price.change, price.changePct)}</i>`
    : '';

  return [
    `${pairEmoji} <b>${pair} · ${signal.timeframe}</b>${priceStr ? '  ' + priceStr : ''}`,
    '',
    `${dirEmoji} <b>Bias: ${signal.direction}</b>  ${confEmoji} ${signal.confidence}`,
    '',
    `<i>${signal.reasoning}</i>`,
    '',
    macro?.headline ? `📌 <i>${macro.headline}</i>  ${sentEmoji}` : '',
    '',
    '─────────────────────',
    `🔐 <b>Full signal</b> (entry · SL · TP1/2/3) → <b>VIP only</b>`,
    `👉 ${process.env.PAYMENT_LINK ?? 'Link in bio'}`,
  ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n');
}

// ─── VIP full signal ──────────────────────────────────────────────────────────

/**
 * Format a complete VIP signal post with all levels, indicators, and reasoning.
 * @param {object} data  Full signal object from fetcher
 * @param {string} signalId  Unique signal ID
 */
export function formatVipSignal(data, signalId) {
  const { pair, dataFreshness, price, indicators, volume, macro, signal, dataWarnings } = data;

  const pairEmoji = PAIR_EMOJI[pair] ?? '📊';
  const dirEmoji = DIR_EMOJI[signal.direction] ?? '❓';
  const confEmoji = CONF_EMOJI[signal.confidence] ?? '';
  const sentEmoji = SENTIMENT_EMOJI[macro?.sentiment] ?? '';
  const volEmoji = VOL_EMOJI[volume?.pressure] ?? '⚪';

  const priceDecimals = pair === 'BTCUSD' ? 0 : 2;
  const currentPrice = price?.current != null ? fmt(price.current, priceDecimals) : 'N/A';
  const changeStr = price ? fmtChange(price.change, price.changePct) : '';

  // ── Indicators block ──
  const rsiVal = indicators?.rsi14?.value != null ? fmt(indicators.rsi14.value, 1) : 'N/A';
  const rsiSig = indicators?.rsi14?.signal ?? 'N/A';
  const macdH = indicators?.macd?.histogram != null ? fmt(indicators.macd.histogram, 3) : 'N/A';
  const macdX = indicators?.macd?.crossover ?? 'N/A';
  const ma50 = indicators?.ma50?.value != null ? fmt(indicators.ma50.value, priceDecimals) : 'N/A';
  const ma50rel = indicators?.ma50?.relation ?? '';
  const ma200 = indicators?.ma200?.value != null ? fmt(indicators.ma200.value, priceDecimals) : 'N/A';
  const ma200rel = indicators?.ma200?.relation ?? '';
  const atr = indicators?.atr14 != null ? fmt(indicators.atr14, 2) : 'N/A';
  const bbU = indicators?.bollingerUpper != null ? fmt(indicators.bollingerUpper, priceDecimals) : 'N/A';
  const bbM = indicators?.bollingerMid != null ? fmt(indicators.bollingerMid, priceDecimals) : 'N/A';
  const bbL = indicators?.bollingerLower != null ? fmt(indicators.bollingerLower, priceDecimals) : 'N/A';

  // ── Macro block (XAU vs BTC) ──
  let macroLines = [];
  if (pair === 'XAUUSD') {
    macroLines = [
      `DXY: ${macro?.dxyTrend ?? 'N/A'}   Real Yields: ${macro?.realYields ?? 'N/A'}`,
    ];
  } else {
    const fgi = macro?.fearGreedIndex != null ? `${macro.fearGreedIndex}/100` : 'N/A';
    macroLines = [
      `Fear & Greed: ${fgi}   Dominance: ${macro?.dominance ?? 'N/A'}`,
    ];
  }

  const keyEvents = macro?.keyEvents?.length
    ? macro.keyEvents.map(e => `  • ${e}`).join('\n')
    : '';

  const conflicts = signal.conflictingFactors?.length
    ? signal.conflictingFactors.map(f => `  ⚠️ ${f}`).join('\n')
    : '';

  const warnings = dataWarnings?.length
    ? `\n⚠️ <i>Data: ${dataWarnings.join(', ')}</i>`
    : '';

  const freshnessTag = dataFreshness === 'LIVE' ? '' : `  <i>(${dataFreshness})</i>`;

  const signalTypeTag = isScalp(signal.timeframe)
    ? '⚡ <b>SCALP SIGNAL</b>'
    : '⚡ <b>VIP SIGNAL</b>';

  return [
    `${signalTypeTag}  ·  <code>${signalId}</code>`,
    '',
    `${pairEmoji} <b>${pair}</b>  |  ${signal.timeframe}  |  ${dirEmoji} <b>${signal.direction}</b>  ${confEmoji} ${signal.confidence}`,
    `<b>Price:</b> <code>${currentPrice}</code>  ${changeStr}${freshnessTag}`,
    `<b>Source:</b> <i>${price?.source ?? 'N/A'}</i>`,
    '',
    '─── TRADE LEVELS ─────────────────',
    `<b>📥 Entry:    </b> <code>${fmt(signal.entry, priceDecimals)}</code>`,
    `<b>🛑 Stop Loss:</b> <code>${fmt(signal.stopLoss, priceDecimals)}</code>`,
    `<b>🎯 TP1:      </b> <code>${fmt(signal.takeProfit1, priceDecimals)}</code>`,
    `<b>🎯 TP2:      </b> <code>${fmt(signal.takeProfit2, priceDecimals)}</code>`,
    `<b>🎯 TP3:      </b> <code>${fmt(signal.takeProfit3, priceDecimals)}</code>`,
    `<b>⚖️ R:R:      </b> ${signal.riskReward}`,
    '',
    '─── INDICATORS ────────────────────',
    `RSI(14): <code>${rsiVal}</code> ${rsiSig}   MACD: <code>${macdH}</code> ${macdX}`,
    `MA50: <code>${ma50}</code> ${ma50rel}   MA200: <code>${ma200}</code> ${ma200rel}`,
    `ATR(14): <code>${atr}</code>   Vol: ${volEmoji} ${volume?.pressure ?? 'N/A'}`,
    `BB: <code>${bbL}</code> ↔ <code>${bbM}</code> ↔ <code>${bbU}</code>`,
    '',
    '─── MACRO ─────────────────────────',
    `${sentEmoji} ${macro?.headline ?? ''}`,
    ...macroLines,
    keyEvents ? `Events:\n${keyEvents}` : '',
    '',
    '─── ANALYSIS ──────────────────────',
    `<i>${signal.reasoning}</i>`,
    '',
    `<b>Entry logic:</b> <i>${signal.entryLogic}</i>`,
    `<b>SL logic:</b>    <i>${signal.slLogic}</i>`,
    `<b>TP logic:</b>    <i>${signal.tpLogic}</i>`,
    conflicts ? `\n<b>Conflicting factors:</b>\n${conflicts}` : '',
    warnings,
    '',
    `<b>🕐 Posted:</b> ${new Date().toUTCString()}`,
    '─────────────────────────────────',
    '⚠️ <i>VIP exclusive. Do not forward.</i>',
  ].filter(l => l !== undefined && l !== '').join('\n').replace(/\n{3,}/g, '\n\n');
}

// ─── TP confirmation post (public channel) ────────────────────────────────────

/**
 * Format a public TP-hit announcement.
 * @param {{ pair: string, timeframe: string, direction: string, entry: number, tp1: number, tp2: number, tp3: number }} storedSignal  From DB (flat)
 * @param {1|2|3} tpLevel
 */
export function formatTpHit(storedSignal, tpLevel) {
  const tpPrice = storedSignal[`tp${tpLevel}`];
  const priceDecimals = storedSignal.pair === 'BTCUSD' ? 0 : 2;
  const pipsGained = storedSignal.direction === 'LONG'
    ? (tpPrice - storedSignal.entry).toFixed(priceDecimals)
    : (storedSignal.entry - tpPrice).toFixed(priceDecimals);
  const pairEmoji = PAIR_EMOJI[storedSignal.pair] ?? '📊';
  const unit = storedSignal.pair === 'XAUUSD' ? 'pts' : 'USD';

  return [
    `✅ <b>TP${tpLevel} HIT</b> on ${pairEmoji} <b>${storedSignal.pair} [${storedSignal.timeframe}]</b>`,
    '',
    `VIP members are <b>+${pipsGained} ${unit}</b> on this trade 📈`,
    `Entry <code>${fmt(storedSignal.entry, priceDecimals)}</code> → TP${tpLevel} <code>${fmt(tpPrice, priceDecimals)}</code>`,
    '',
    'Still watching from the sidelines? 👇',
    `👉 Get VIP access: ${process.env.PAYMENT_LINK ?? 'Link in bio'}`,
  ].join('\n');
}

// ─── Scan summary (admin DM) ─────────────────────────────────────────────────

/**
 * Format a full scan summary for the admin showing all 8 results ranked.
 * @param {Array} rows  Sorted rows from scanAllSignals()
 * @param {object|null} winner  The top-scored actionable row (or null)
 */
export function formatScanSummary(rows, winner) {
  const DIR_LINE = { LONG: '🟢 LONG', SHORT: '🔴 SHORT', WAIT: '⏸  WAIT' };
  const CONF_TAG = { HIGH: '🔥 HIGH', MEDIUM: '⚡ MED', LOW: '💡 LOW' };
  const PAIR_LABEL = { XAUUSD: '🥇 XAU', BTCUSD: '₿  BTC' };

  // Group by pair
  const byPair = {};
  for (const row of rows) {
    if (!byPair[row.pair]) byPair[row.pair] = [];
    byPair[row.pair].push(row);
  }

  const lines = [
    `🔍 <b>Signal Scan — 8 setups checked</b>`,
    `<i>${new Date().toUTCString()}</i>`,
    '',
  ];

  for (const [pair, pairRows] of Object.entries(byPair)) {
    // Sort timeframes in order
    const TF_ORDER = { M15: 0, H1: 1, H4: 2, D1: 3 };
    pairRows.sort((a, b) => TF_ORDER[a.timeframe] - TF_ORDER[b.timeframe]);

    lines.push(`<b>${PAIR_LABEL[pair] ?? pair}</b>`);
    for (const row of pairRows) {
      const isWinner = winner && row.pair === winner.pair && row.timeframe === winner.timeframe;
      const star = isWinner ? ' ⭐' : '';

      if (row.error) {
        lines.push(`  ${row.timeframe.padEnd(3)} │ ❌ error: ${row.error.slice(0, 40)}`);
        continue;
      }

      const sig = row.result?.signal;
      if (!sig) { lines.push(`  ${row.timeframe.padEnd(3)} │ ❓ no data`); continue; }

      const dir  = DIR_LINE[sig.direction] ?? sig.direction;
      const conf = CONF_TAG[sig.confidence] ?? sig.confidence;
      const rr   = sig.riskReward ? `  R:R ${sig.riskReward.split('/').pop().trim()}` : '';
      const pts  = row.score > 0 ? `  [${row.score}pts]` : '';

      lines.push(`  ${row.timeframe.padEnd(3)} │ ${dir}  ${conf}${rr}${pts}${star}`);
    }
    lines.push('');
  }

  if (winner) {
    lines.push(`─────────────────────────────`);
    lines.push(`⭐ <b>Winner: ${winner.pair} ${winner.timeframe} ${winner.result.signal.direction}</b>`);
    lines.push(`Signal posted to VIP channel ✅`);
  } else {
    lines.push(`─────────────────────────────`);
    lines.push(`⏸ <b>No HIGH confidence 3:1 setup found across all 8 setups.</b>`);
    lines.push(`<i>Nothing posted to VIP channel.</i>`);
  }

  return lines.join('\n');
}

// ─── No-signal message (VIP channel, when conditions not met) ────────────────

/**
 * Posted to VIP channel when the scan runs but finds no HIGH confidence 3:1 setup.
 * @param {object} data  Full signal object from fetcher (direction=WAIT)
 */
export function formatNoSignal(data) {
  const { pair, signal, macro } = data;
  const pairEmoji = PAIR_EMOJI[pair] ?? '📊';
  const reasons = signal.conflictingFactors?.length
    ? signal.conflictingFactors.map(f => `  • ${f}`).join('\n')
    : '  • Conditions did not align for a clean 3:1 setup';

  return [
    `⏸ <b>No Trade Today</b>  ${pairEmoji} ${pair} · ${signal.timeframe}`,
    '',
    'Market scan complete. No HIGH confidence setup with 3:1 R:R found.',
    '',
    '<b>Reasons:</b>',
    reasons,
    macro?.headline ? `\n📌 <i>${macro.headline}</i>` : '',
    '',
    '<i>Patience is part of the edge. We wait for the right setup.</i>',
  ].filter(Boolean).join('\n');
}

// ─── Scalp scan summary (admin DM) ───────────────────────────────────────────

/**
 * Format a scalp scan summary for the admin showing M1/M5/M10 results.
 * @param {Array} rows   Sorted rows from scanScalpSignals()
 * @param {object|null} winner  Top-scored actionable row (or null)
 */
export function formatScalpScanSummary(rows, winner) {
  const DIR_LINE  = { LONG: '🟢 LONG', SHORT: '🔴 SHORT', WAIT: '⏸  WAIT' };
  const CONF_TAG  = { HIGH: '🔥 HIGH', MEDIUM: '⚡ MED', LOW: '💡 LOW' };
  const PAIR_LABEL = { XAUUSD: '🥇 XAU', BTCUSD: '₿  BTC' };

  const byPair = {};
  for (const row of rows) {
    if (!byPair[row.pair]) byPair[row.pair] = [];
    byPair[row.pair].push(row);
  }

  const lines = [
    `⚡ <b>Scalp Scan — 6 setups checked (M1 · M5 · M10)</b>`,
    `<i>${new Date().toUTCString()}</i>`,
    '',
  ];

  const TF_ORDER = { M1: 0, M5: 1, M10: 2 };

  for (const [pair, pairRows] of Object.entries(byPair)) {
    pairRows.sort((a, b) => (TF_ORDER[a.timeframe] ?? 9) - (TF_ORDER[b.timeframe] ?? 9));
    lines.push(`<b>${PAIR_LABEL[pair] ?? pair}</b>`);

    for (const row of pairRows) {
      const isWinner = winner && row.pair === winner.pair && row.timeframe === winner.timeframe;
      const star = isWinner ? ' ⭐' : '';

      if (row.error) {
        lines.push(`  ${row.timeframe.padEnd(3)} │ ❌ ${row.error.slice(0, 40)}`);
        continue;
      }
      const sig = row.result?.signal;
      if (!sig) { lines.push(`  ${row.timeframe.padEnd(3)} │ ❓ no data`); continue; }

      const dir  = DIR_LINE[sig.direction]  ?? sig.direction;
      const conf = CONF_TAG[sig.confidence] ?? sig.confidence;
      const rr   = sig.riskReward ? `  R:R ${sig.riskReward.split('/').pop().trim()}` : '';
      const pts  = row.score > 0 ? `  [${row.score}pts]` : '';
      lines.push(`  ${row.timeframe.padEnd(3)} │ ${dir}  ${conf}${rr}${pts}${star}`);
    }
    lines.push('');
  }

  lines.push('─────────────────────────────');
  if (winner) {
    lines.push(`⭐ <b>Winner: ${winner.pair} ${winner.timeframe} ${winner.result.signal.direction}</b>`);
    lines.push(`Scalp signal posted to VIP channel ✅`);
  } else {
    lines.push(`⏸ <b>No HIGH confidence scalp setup found across 6 setups.</b>`);
    lines.push(`<i>Market conditions not suitable for scalping right now.</i>`);
  }

  return lines.join('\n');
}

// ─── VIP teaser for public channel ───────────────────────────────────────────

export function formatVipTeaser(timeframe = 'H4') {
  return [
    `⚡ <b>VIP members just received today's ${timeframe} signal.</b>`,
    '',
    'Entry locked. ✅',
    'SL set. 🛑',
    'TPs defined. 🎯',
    '',
    'Still watching from the sidelines?',
    `👉 ${process.env.PAYMENT_LINK ?? 'Link in bio'}`,
  ].join('\n');
}
