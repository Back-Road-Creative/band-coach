// Pure ring of the most recent caught runtime errors. No DOM, no network.
// Every caller-supplied error is also mirrored to console.error so it shows up
// in devtools even when nothing reads the ring. persistErrors() hands it a
// Storage-like object so the ring survives a reload of the same tab (the error
// notice says "Reload, then Settings > Copy diagnostics").
const MAX = 20;
let ring = [];
let sink = null;

function write() {
  if (!sink) return;
  try { sink.storage.setItem(sink.key, JSON.stringify(ring)); } catch (e) { /* full or denied: the in-memory ring still has it */ }
}

const wellFormed = (e) => !!e && typeof e.message === 'string' && typeof e.where === 'string' && typeof e.time === 'number';

export function recordError(where, err) {
  const message = err && err.message ? err.message : String(err);
  const entry = { message, where, time: Date.now() };
  ring.push(entry);
  if (ring.length > MAX) ring.shift();
  write();
  console.error('[' + where + ']', err);
  return entry;
}

// Reads what an earlier page in this tab stored under `key` (junk is ignored),
// puts it ahead of anything already recorded, and writes every later entry back.
export function persistErrors(storage, key) {
  let stored = [];
  try { const parsed = JSON.parse(storage.getItem(key)); if (Array.isArray(parsed)) stored = parsed.filter(wellFormed); } catch (e) { /* unreadable: start from what is in memory */ }
  ring = stored.concat(ring).slice(-MAX);
  sink = { storage, key };
  write();
}

export function getErrors() {
  return ring.slice();
}

export function clearErrors() {
  ring = [];
  sink = null;
}
