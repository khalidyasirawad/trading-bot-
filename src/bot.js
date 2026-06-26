/**
 * Gold Signal Bot — signals-only entry point.
 * Stripe, emails, and subscriptions are disabled for now.
 *
 * Starts:
 *  - Grammy Telegram bot (long-polling)
 *  - Express HTTP server (health check + Railway port binding)
 *  - Signal cron scheduler
 */

import 'dotenv/config';
import express from 'express';
import { Bot } from 'grammy';
import crypto from 'crypto';
import { startScheduler } from './scheduler.js';
import { fetchManualSignal, isActionableSignal, ALL_TFS, SCALP_TFS } from './signals/fetcher.js';
import { formatVipSignal, formatNoSignal, formatScanSummary, formatScalpScanSummary } from './signals/formatter.js';
import { scanAllSignals, scanScalpSignals } from './signals/scanner.js';
import { applyWatermark } from './signals/antiLeak.js';
import { generateBacktestPost } from './content/backtestPost.js';
import { startLiveMonitor } from './signals/liveMonitor.js';
import { nextNumber, register } from './signals/signalStore.js';
import { getSignal, getAllSignals } from './signals/latestSignals.js';

// ─── Validate required env vars ───────────────────────────────────────────────
const REQUIRED_ENV = [
  'TELEGRAM_BOT_TOKEN',
  'PUBLIC_CHANNEL_ID',
  'VIP_CHANNEL_ID',
  'TWELVE_DATA_API_KEY',
  'OPENAI_API_KEY',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[boot] Missing required env var: ${key}`);
    process.exit(1);
  }
}

// ─── Bot setup ────────────────────────────────────────────────────────────────
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

function isAdmin(ctx) {
  return String(ctx.from?.id) === String(process.env.ADMIN_TELEGRAM_ID);
}
function adminOnly(ctx, next) {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Unauthorized');
  return next();
}

// ─── /start ───────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  if (isAdmin(ctx)) {
    await ctx.reply(
      `✅ <b>Bot is active</b> — your Telegram ID: <code>${ctx.from.id}</code>\n\n` +
      `24/7 monitor is running. You'll receive MEDIUM signal alerts here and HIGH signals auto-post to VIP.\n\n` +
      `Type /help for all commands.`,
      { parse_mode: 'HTML' }
    );
  } else {
    await ctx.reply(
      `👋 This is a private trading signal bot.\n` +
      `Your Telegram ID: <code>${ctx.from.id}</code>`,
      { parse_mode: 'HTML' }
    );
  }
});

// ─── Admin commands ───────────────────────────────────────────────────────────

/**
 * /signal [pair] [tf] [force]
 * Swing:  /signal XAUUSD H1      /signal BTCUSD D1
 * Scalp:  /signal XAUUSD M1      /signal BTCUSD M5      /signal XAUUSD M10
 * Force:  /signal XAUUSD M5 force
 */
bot.command('signal', adminOnly, async (ctx) => {
  const args = ctx.message?.text?.split(' ').slice(1) ?? [];
  const pair = (args[0] ?? 'XAUUSD').toUpperCase();
  const tf   = (args[1] ?? 'H1').toUpperCase();
  const force = (args[2] ?? '').toLowerCase() === 'force';

  if (!ALL_TFS.includes(tf)) {
    return ctx.reply(
      `❌ Unknown timeframe: <code>${tf}</code>\n` +
      `Scalp: M1 · M5 · M10\n` +
      `Swing: M15 · H1 · H4 · D1`,
      { parse_mode: 'HTML' }
    );
  }

  await ctx.reply(`⏳ Fetching ${pair} ${tf} signal…`);

  try {
    const result = await fetchManualSignal(pair, tf);
    const dir  = result.signal.direction;
    const conf = result.signal.confidence;

    if (!isActionableSignal(result) && !force) {
      return ctx.reply(
        `⏸ <b>No actionable signal</b>\n\nDirection: <b>${dir}</b> | Confidence: <b>${conf}</b>\n\n` +
        `Did not meet HIGH confidence + 3:1 R:R criteria.\n` +
        `Add <code>force</code> to post anyway: <code>/signal ${pair} ${tf} force</code>`,
        { parse_mode: 'HTML' }
      );
    }

    const num      = nextNumber();
    const signalId = `sig_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const sig      = result.signal;
    const text = applyWatermark(formatVipSignal(result, signalId, num), `admin_${signalId}`);

    await bot.api.sendMessage(process.env.VIP_CHANNEL_ID, text, {
      parse_mode: 'HTML',
      protect_content: true,
    });

    register(signalId, {
      pair, timeframe: tf,
      direction:  sig.direction,
      entry:      sig.entry,
      stopLoss:   sig.stopLoss,
      tp1:        sig.takeProfit1,
      tp2:        sig.takeProfit2,
      tp3:        sig.takeProfit3,
    });

    await ctx.reply(
      `✅ <b>#${String(num).padStart(4,'0')} ${dir}</b> signal posted · <code>${signalId}</code>\nR:R: ${sig.riskReward}`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    await ctx.reply(`❌ Error: ${err.message}`);
  }
});

/**
 * /scan — check 8 swing setups (M15/H1/H4/D1), rank and post best to VIP.
 * /scan scalp  — check 6 scalp setups (M1/M5/M10) instead.
 * /scan nopost — scan without posting to VIP channel.
 * Flags can be combined: /scan scalp nopost
 */
bot.command('scan', adminOnly, async (ctx) => {
  const text    = ctx.message?.text?.toLowerCase() ?? '';
  const nopost  = text.includes('nopost');
  const isScalp = text.includes('scalp');

  const label = isScalp
    ? '6 scalp setups (M1/M5/M10)'
    : '8 swing setups (M15/H1/H4/D1)';

  const pairLine = isScalp
    ? 'XAUUSD × M1/M5/M10\nBTCUSD × M1/M5/M10'
    : 'XAUUSD × M15/H1/H4/D1\nBTCUSD × M15/H1/H4/D1';

  const timeEst = isScalp ? '~60 seconds' : '~90 seconds';

  await ctx.reply(
    `⏳ <b>Scanning ${label}…</b>\n${pairLine}\n\n<i>${timeEst} — market data fetched sequentially to avoid rate limits</i>`,
    { parse_mode: 'HTML' }
  );

  try {
    const rows   = isScalp ? await scanScalpSignals() : await scanAllSignals();
    const winner = rows.find(r => r.result && isActionableSignal(r.result)) ?? null;

    if (winner && !nopost) {
      const signalId = `sig_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const vipText  = applyWatermark(formatVipSignal(winner.result, signalId), `scan_${signalId}`);
      await bot.api.sendMessage(process.env.VIP_CHANNEL_ID, vipText, {
        parse_mode: 'HTML',
        protect_content: true,
      });
    }

    const summary = isScalp
      ? formatScalpScanSummary(rows, nopost ? null : winner)
      : formatScanSummary(rows, nopost ? null : winner);

    await ctx.reply(summary, { parse_mode: 'HTML' });

  } catch (err) {
    await ctx.reply(`❌ Scan failed: ${err.message}`);
  }
});

/**
 * /backtest — run backtest on XAUUSD H1 + BTCUSD H1, post to public channel.
 * /backtest nopost — preview result in admin DM only.
 */
bot.command('backtest', adminOnly, async (ctx) => {
  const nopost = ctx.message?.text?.toLowerCase().includes('nopost') ?? false;
  await ctx.reply('⏳ Running backtest on XAUUSD H1 + BTCUSD H1… (~30 seconds)');

  try {
    const text = await generateBacktestPost();

    if (!nopost) {
      await bot.api.sendMessage(process.env.PUBLIC_CHANNEL_ID, text, { parse_mode: 'HTML' });
      await ctx.reply('✅ Backtest report posted to public channel.');
    } else {
      await ctx.reply(text, { parse_mode: 'HTML' });
    }
  } catch (err) {
    await ctx.reply(`❌ Backtest failed: ${err.message}`);
  }
});

/** /help */
bot.command('help', adminOnly, async (ctx) => {
  await ctx.reply(
    `<b>Admin Commands</b>\n\n` +

    `<b>Swing Trading (M15–D1)</b>\n` +
    `/scan — Scan 8 swing setups, post best to VIP\n` +
    `/scan nopost — Scan without posting\n\n` +

    `<b>Scalp Trading (M1/M5/M10)</b>\n` +
    `/scan scalp — Scan 6 scalp setups, post best to VIP\n` +
    `/scan scalp nopost — Scan scalp without posting\n\n` +

    `<b>Manual Signal</b>\n` +
    `/signal [pair] [tf] [force]\n` +
    `  Pairs: XAUUSD · BTCUSD\n` +
    `  Scalp TFs:  M1 · M5 · M10\n` +
    `  Swing TFs:  M15 · H1 · H4 · D1\n` +
    `  Add <code>force</code> to bypass HIGH confidence gate\n\n` +

    `<b>Examples</b>\n` +
    `  <code>/signal XAUUSD M1</code> — 1-min gold scalp\n` +
    `  <code>/signal BTCUSD M10</code> — 10-min BTC scalp\n` +
    `  <code>/signal XAUUSD H4 force</code> — forced H4 swing\n\n` +

    `<b>Backtest</b>\n` +
    `/backtest — Run + post backtest report to public channel\n` +
    `/backtest nopost — Preview backtest in this DM\n\n` +

    `/help — Show this list`,
    { parse_mode: 'HTML' }
  );
});

bot.catch((err) => console.error('[bot] Unhandled error:', err.message));

// ─── Express (health check + Railway port binding) ────────────────────────────
const app = express();
app.use(express.json());

// CORS — required for MT4 WebRequest and any external clients
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) })
);

// ─── Signal endpoints — MT4 EA polls these ───────────────────────────────────
// GET /signal/:pair        — EA polls e.g. /signal/EURUSD
// GET /signals             — all active signals (dashboard / debug)
// GET /btc-signal          — legacy alias kept for backward compat

app.get('/signal/:pair', (req, res) => {
  const pair = req.params.pair.toUpperCase();
  res.json(getSignal(pair));
});

app.get('/signals', (_req, res) => {
  res.json(getAllSignals());
});

// Legacy alias — redirect old BTC EA to the new unified endpoint
app.get('/btc-signal', (_req, res) => {
  res.json(getSignal('BTCUSD'));
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);
app.listen(PORT, () => console.log(`[http] Listening on port ${PORT}`));

// ─── Start scheduler ──────────────────────────────────────────────────────────
const scheduler = startScheduler(bot);

// ─── Start bot ────────────────────────────────────────────────────────────────
bot.start({
  onStart: (info) => {
    console.log(`[bot] @${info.username} is running`);
    // Start 24/7 monitor after bot is confirmed running
    startLiveMonitor(bot);
  },
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  scheduler.stop();
  await bot.stop();
  process.exit(0);
});
process.on('SIGINT', async () => {
  scheduler.stop();
  await bot.stop();
  process.exit(0);
});
