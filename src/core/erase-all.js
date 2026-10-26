// Erase everything Band Coach keeps on this device. Pure: the caller hands in
// the stores (`storage`, `indexedDB`, `caches`, any of them absent) so a unit
// test needs no browser. Each store is tried on its own and a throw in one
// never stops the others; the result says honestly whether all of it went.
export const APP_KEY_PREFIX = 'bandcoach';
// Keys written before the app could enumerate them, removed by name even if the store cannot list its keys.
export const APP_KEYS = ['bandcoach.v1', 'bandcoach.v1.corrupt', 'bandcoach.v1.backupAt', 'bandcoach.v1.tuneAsked', 'bandcoach.v1.errors'];
export const APP_DATABASES = ['bandcoach-songs', 'band-coach-model-packs'];
export const APP_CACHE_PREFIX = 'band-coach-pages-v';

function eraseKeys(storage) {
  if (!storage) return true;
  let ok = true; const names = new Set(APP_KEYS);
  try { for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (typeof k === 'string' && k.indexOf(APP_KEY_PREFIX) === 0) names.add(k); } } catch (e) { ok = false; }
  for (const k of names) { try { storage.removeItem(k); } catch (e) { ok = false; } }
  return ok;
}
function eraseDatabase(indexedDB, name, timeoutMs) {
  return new Promise((resolve) => {
    let req; const timer = setTimeout(() => resolve(false), timeoutMs);
    const done = (v) => { clearTimeout(timer); resolve(v); };
    try { req = indexedDB.deleteDatabase(name); } catch (e) { done(false); return; }
    if (!req) { done(false); return; }
    req.onsuccess = () => done(true); req.onerror = () => done(false);
    // The app's own open connections (song library, model pack) are never closed, so the browser reports 'blocked'. The delete stays queued and finishes the moment the page reloads and they close: that is pending, not failed.
    req.onblocked = () => done(true);
  });
}
async function eraseCaches(caches) {
  try { const keys = await caches.keys(); const mine = keys.filter(k => typeof k === 'string' && k.indexOf(APP_CACHE_PREFIX) === 0); const r = await Promise.all(mine.map(k => caches.delete(k).then(() => true, () => false))); return r.every(Boolean); } catch (e) { return false; }
}
export async function eraseAll({ storage, session, indexedDB, caches } = {}, { timeoutMs = 3000 } = {}) {
  const parts = [eraseKeys(storage), eraseKeys(session)];
  if (indexedDB) parts.push(...await Promise.all(APP_DATABASES.map(n => eraseDatabase(indexedDB, n, timeoutMs))));
  if (caches) parts.push(await eraseCaches(caches));
  return { ok: parts.every(Boolean) };
}
