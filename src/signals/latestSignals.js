/**
 * Per-pair in-memory signal cache.
 * Updated by liveMonitor when HIGH/MEDIUM signals are found.
 * Read by the Express /signal/:pair endpoint polled by MT4 EAs.
 */

const cache = new Map();

export function updateSignal(pair, data) {
  cache.set(pair.toUpperCase(), {
    signal_id:   `sig_${Date.now()}`,
    pair:        pair.toUpperCase(),
    direction:   data.direction   ?? 'WAIT',
    confidence:  data.confidence  ?? 'LOW',
    entry:       data.entry       ?? null,
    stopLoss:    data.stopLoss    ?? null,
    takeProfit1: data.takeProfit1 ?? null,
    takeProfit2: data.takeProfit2 ?? null,
    takeProfit3: data.takeProfit3 ?? null,
    updatedAt:   new Date().toISOString(),
  });
}

export function getSignal(pair) {
  const key = pair.toUpperCase();
  return cache.get(key) ?? {
    signal_id:   `init_${Date.now()}`,
    pair:        key,
    direction:   'WAIT',
    confidence:  'LOW',
    entry:       null,
    stopLoss:    null,
    takeProfit1: null,
    takeProfit2: null,
    takeProfit3: null,
    updatedAt:   new Date().toISOString(),
  };
}

export function getAllSignals() {
  return Object.fromEntries(cache);
}
