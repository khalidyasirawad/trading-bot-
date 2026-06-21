/**
 * In-memory signal registry.
 * Tracks all posted signals, their TP/SL status, and prevents re-posting
 * the same setup while it's still open.
 *
 * Resets on restart (Railway ephemeral) — signals from previous sessions
 * are not carried over, but new signals are numbered from 1 each session.
 * A persistent DB can replace this later without changing the interface.
 */

let counter = 0;

// signalId → signal record
const store = new Map();

// ─── Write ─────────────────────────────────────────────────────────────────

export function nextNumber() {
  return ++counter;
}

/**
 * Register a newly posted signal.
 */
export function register(signalId, { pair, timeframe, direction, entry, stopLoss, tp1, tp2, tp3 }) {
  store.set(signalId, {
    number: counter,
    signalId,
    pair,
    timeframe,
    direction,
    entry,
    stopLoss,
    tp1,
    tp2,
    tp3,
    postedAt: Date.now(),
    status: 'OPEN',  // OPEN | CLOSED | EXPIRED
    tpsHit: new Set(),
  });
}

/**
 * Mark a TP level as hit. Returns true if this is the first time for that level.
 * Closes the signal automatically on SL or TP3.
 */
export function markTpHit(signalId, level) {
  const s = store.get(signalId);
  if (!s || s.tpsHit.has(level)) return false;
  s.tpsHit.add(level);
  if (level === 'TP3' || level === 'SL') s.status = 'CLOSED';
  return true; // first time this level was hit
}

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * Is there already an open signal for this pair+timeframe+direction?
 * Prevents re-posting while a signal is still active.
 */
export function hasOpenSignal(pair, timeframe, direction) {
  for (const s of store.values()) {
    if (s.pair === pair && s.timeframe === timeframe &&
        s.direction === direction && s.status === 'OPEN') {
      return true;
    }
  }
  return false;
}

/**
 * Get all currently open signals.
 */
export function getOpenSignals() {
  return [...store.values()].filter(s => s.status === 'OPEN');
}

/**
 * Get signal record by ID.
 */
export function getSignal(signalId) {
  return store.get(signalId) ?? null;
}

// ─── Housekeeping ───────────────────────────────────────────────────────────

/**
 * Expire open signals older than maxAgeMs (default 48h).
 * Called at the start of each scan cycle to clean up stale signals.
 */
export function pruneStale(maxAgeMs = 48 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, s] of store) {
    if (s.status !== 'OPEN') {
      if (Date.now() - s.postedAt > maxAgeMs * 2) store.delete(id); // remove very old closed
    } else if (s.postedAt < cutoff) {
      s.status = 'EXPIRED';
      console.log(`[signalStore] Signal #${s.number} (${s.pair} ${s.timeframe}) expired after 48h`);
    }
  }
}
