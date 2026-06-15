/**
 * Subscriber persistence layer.
 * Uses Supabase when SUPABASE_URL + SUPABASE_SERVICE_KEY are set,
 * otherwise falls back to a local JSON file at data/subscribers.json.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, '../../data/subscribers.json');

// ─── Supabase client (lazy-loaded) ───────────────────────────────────────────
let _supabase = null;

async function getSupabase() {
  if (_supabase) return _supabase;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;

  const { createClient } = await import('@supabase/supabase-js');
  _supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  return _supabase;
}

// ─── JSON file helpers ────────────────────────────────────────────────────────
async function readFile() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeFile(data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a new subscriber.
 * @param {{ email: string, telegramUsername: string, telegramId?: string|null, expiresAt: Date }} sub
 * @returns {Promise<object>} The created subscriber record
 */
export async function addSubscriber({ email, telegramUsername, telegramId = null, expiresAt }) {
  const sb = await getSupabase();
  const record = {
    email,
    telegram_username: telegramUsername.replace('@', ''),
    telegram_id: telegramId,
    expires_at: expiresAt.toISOString(),
    active: true,
    created_at: new Date().toISOString(),
  };

  if (sb) {
    const { data, error } = await sb
      .from('subscribers')
      .upsert(record, { onConflict: 'email' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const all = await readFile();
  const existing = all.findIndex(s => s.email === email);
  if (existing >= 0) {
    all[existing] = { ...all[existing], ...record };
  } else {
    record.id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    all.push(record);
  }
  await writeFile(all);
  return record;
}

/**
 * Get subscriber by email.
 */
export async function getSubscriberByEmail(email) {
  const sb = await getSupabase();
  if (sb) {
    const { data } = await sb
      .from('subscribers')
      .select('*')
      .eq('email', email)
      .single();
    return data;
  }
  const all = await readFile();
  return all.find(s => s.email === email) ?? null;
}

/**
 * Get subscriber by Telegram username (without @).
 */
export async function getSubscriberByUsername(username) {
  const clean = username.replace('@', '');
  const sb = await getSupabase();
  if (sb) {
    const { data } = await sb
      .from('subscribers')
      .select('*')
      .eq('telegram_username', clean)
      .single();
    return data;
  }
  const all = await readFile();
  return all.find(s => s.telegram_username === clean) ?? null;
}

/**
 * Get all active subscribers.
 */
export async function getActiveSubscribers() {
  const sb = await getSupabase();
  if (sb) {
    const { data } = await sb
      .from('subscribers')
      .select('*')
      .eq('active', true);
    return data ?? [];
  }
  const all = await readFile();
  return all.filter(s => s.active);
}

/**
 * Get all subscribers whose expiry is before `before` date (defaults to now).
 */
export async function getExpiredSubscribers(before = new Date()) {
  const sb = await getSupabase();
  if (sb) {
    const { data } = await sb
      .from('subscribers')
      .select('*')
      .eq('active', true)
      .lt('expires_at', before.toISOString());
    return data ?? [];
  }
  const all = await readFile();
  return all.filter(s => s.active && new Date(s.expires_at) < before);
}

/**
 * Get subscribers expiring within the next `days` days.
 */
export async function getSubscribersExpiringSoon(days = 3) {
  const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const sb = await getSupabase();
  if (sb) {
    const { data } = await sb
      .from('subscribers')
      .select('*')
      .eq('active', true)
      .lt('expires_at', cutoff.toISOString())
      .gt('expires_at', new Date().toISOString());
    return data ?? [];
  }
  const all = await readFile();
  const now = new Date();
  return all.filter(
    s => s.active && new Date(s.expires_at) > now && new Date(s.expires_at) < cutoff
  );
}

/**
 * Mark a subscriber as expired/inactive.
 */
export async function deactivateSubscriber(email) {
  const sb = await getSupabase();
  if (sb) {
    await sb.from('subscribers').update({ active: false }).eq('email', email);
    return;
  }
  const all = await readFile();
  const idx = all.findIndex(s => s.email === email);
  if (idx >= 0) {
    all[idx].active = false;
    await writeFile(all);
  }
}

/**
 * Update telegram_id for a subscriber (set after they join the channel).
 */
export async function setTelegramId(email, telegramId) {
  const sb = await getSupabase();
  if (sb) {
    await sb.from('subscribers').update({ telegram_id: String(telegramId) }).eq('email', email);
    return;
  }
  const all = await readFile();
  const idx = all.findIndex(s => s.email === email);
  if (idx >= 0) {
    all[idx].telegram_id = String(telegramId);
    await writeFile(all);
  }
}

/**
 * Save a signal entry for TP tracking.
 */
export async function saveSignal({ signalId, pair, timeframe, entry, sl, tp1, tp2, tp3, direction }) {
  const sb = await getSupabase();
  const record = {
    signal_id: signalId,
    pair,
    timeframe,
    entry,
    sl,
    tp1,
    tp2,
    tp3,
    direction,
    created_at: new Date().toISOString(),
    tp1_hit: false,
    tp2_hit: false,
    tp3_hit: false,
  };

  if (sb) {
    await sb.from('signals').upsert(record, { onConflict: 'signal_id' });
    return record;
  }

  // JSON fallback
  const filePath = path.resolve(__dirname, '../../data/signals.json');
  let signals = [];
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    signals = JSON.parse(raw);
  } catch { /* empty */ }
  signals.push(record);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(signals, null, 2));
  return record;
}

/**
 * Get a signal by ID.
 */
export async function getSignal(signalId) {
  const sb = await getSupabase();
  if (sb) {
    const { data } = await sb.from('signals').select('*').eq('signal_id', signalId).single();
    return data;
  }
  const filePath = path.resolve(__dirname, '../../data/signals.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw).find(s => s.signal_id === signalId) ?? null;
  } catch { return null; }
}

/**
 * Mark a TP level as hit.
 */
export async function markTpHit(signalId, tpLevel) {
  const field = `tp${tpLevel}_hit`;
  const sb = await getSupabase();
  if (sb) {
    await sb.from('signals').update({ [field]: true }).eq('signal_id', signalId);
    return;
  }
  const filePath = path.resolve(__dirname, '../../data/signals.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const signals = JSON.parse(raw);
  const idx = signals.findIndex(s => s.signal_id === signalId);
  if (idx >= 0) {
    signals[idx][field] = true;
    await fs.writeFile(filePath, JSON.stringify(signals, null, 2));
  }
}
