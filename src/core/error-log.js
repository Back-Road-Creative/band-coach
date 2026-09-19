// Pure in-memory ring of the most recent caught runtime errors. No DOM, no
// storage, no network. Every caller-supplied error is also mirrored to
// console.error so it shows up in devtools even when nothing reads the ring.
const MAX = 20;
let ring = [];

export function recordError(where, err) {
  const message = err && err.message ? err.message : String(err);
  const entry = { message, where, time: Date.now() };
  ring.push(entry);
  if (ring.length > MAX) ring.shift();
  console.error('[' + where + ']', err);
  return entry;
}

export function getErrors() {
  return ring.slice();
}

export function clearErrors() {
  ring = [];
}
