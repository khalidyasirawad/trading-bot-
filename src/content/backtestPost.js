/**
 * Formats backtest results into a Telegram HTML post for the PUBLIC channel.
 * Posted daily at 14:00 UTC to show yesterday's signal accuracy.
 */

import { runBacktest, summariseBacktest } from '../signals/backtest.js';

const PAIR_EMOJI = { XAUUSD: '🥇', BTCUSD: '₿' };
const DIR_EMOJI  = { LONG: '🟢', SHORT: '🔴' };
const OUT_EMOJI  = { TP3: '✅✅✅', TP2: '✅✅', TP1: '✅', SL: '❌', OPEN: '⏳' };

function fmt(val, dec) {
  if (val == null) return 'N/A';
  return Number(val).toFixed(dec);
}

function fmtDate(datetimeStr) {
  try {
    return new Date(datetimeStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'UTC', hour12: false,
    }) + ' UTC';
  } catch {
    return datetimeStr;
  }
}

function buildPairSection(pair, timeframe, trades, stats, days) {
  const pairEmoji = PAIR_EMOJI[pair] ?? '📊';
  const dec       = pair === 'BTCUSD' ? 0 : 2;
  const unit      = pair === 'BTCUSD' ? 'USD' : 'pts';

  const lines = [
    `${pairEmoji} <b>${pair} · ${timeframe}</b>  <i>(~${days} days · ${stats.total} signals)</i>`,
  ];

  if (stats.total === 0) {
    lines.push('  <i>No HIGH confidence signals in this window.</i>');
    return lines.join('\n');
  }

  // Win rate bar
  const winPct  = stats.resolved > 0 ? Math.round(stats.wins / stats.resolved * 10) : 0;
  const bar = '█'.repeat(winPct) + '░'.repeat(10 - winPct);
  lines.push(`  Win rate: <code>${bar}</code> ${stats.winRate}%  (${stats.wins}W / ${stats.losses}L)`);

  if (stats.tp3s > 0) lines.push(`  🏆 TP3 hits: ${stats.tp3s}`);
  if (stats.tp2s > 0) lines.push(`  🎯 TP2 hits: ${stats.tp2s}`);
  if (stats.tp1s > 0) lines.push(`  🎯 TP1 hits: ${stats.tp1s}`);

  if (stats.bestWin != null)   lines.push(`  Best win:  <code>+${fmt(stats.bestWin, dec)} ${unit}</code>`);
  if (stats.worstLoss != null) lines.push(`  Worst loss: <code>${fmt(stats.worstLoss, dec)} ${unit}</code>`);

  const totalSign = stats.totalPnl >= 0 ? '+' : '';
  lines.push(`  Net result: <code>${totalSign}${fmt(stats.totalPnl, dec)} ${unit}</code>`);

  // Recent trade log (last 8 trades)
  if (trades.length > 0) {
    lines.push('');
    lines.push('  <b>Recent signals:</b>');
    const recent = [...trades].reverse().slice(0, 8);
    for (const t of recent) {
      const dirEmoji = DIR_EMOJI[t.direction] ?? '?';
      const outEmoji = OUT_EMOJI[t.outcome]   ?? '?';
      const pnlStr   = t.pnl != null
        ? `  <code>${t.pnl >= 0 ? '+' : ''}${fmt(t.pnl, dec)} ${unit}</code>`
        : '';
      lines.push(`  ${dirEmoji} ${fmtDate(t.datetime)} → ${outEmoji}${pnlStr}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate and format the daily backtest post for the PUBLIC channel.
 * Runs backtests on XAUUSD H1 and BTCUSD H1 (2 API credits total).
 *
 * @returns {Promise<string>}  Telegram HTML string
 */
export async function generateBacktestPost() {
  const configs = [
    { pair: 'XAUUSD', timeframe: 'H1' },
    { pair: 'BTCUSD', timeframe: 'H1' },
  ];

  const sections = [];

  for (const { pair, timeframe } of configs) {
    const { trades, timeframeDays } = await runBacktest(pair, timeframe);
    const stats = summariseBacktest(trades, pair);
    sections.push(buildPairSection(pair, timeframe, trades, stats, timeframeDays));
  }

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  return [
    `📊 <b>DAILY BACKTEST REPORT</b>`,
    `<i>${dateStr} · Last 300 candles · Algorithm only — no guesses</i>`,
    '',
    sections.join('\n\n'),
    '',
    '─────────────────────',
    '📡 These results are from our <b>live signal engine</b> — the same algorithm that sends signals to VIP members in real time.',
    `👉 Get live signals before the candle closes: ${process.env.PAYMENT_LINK ?? 'Link in bio'}`,
  ].join('\n');
}
