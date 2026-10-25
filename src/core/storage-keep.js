// Asks the browser to keep this site's data (navigator.storage.persist) so
// progress is not cleared when the device runs low on space, and reads back
// whether it is kept and roughly how much is stored. No network, no DOM: the
// caller passes navigator.storage. A browser without the API, or one that
// throws, gets null and the app carries on as before.
export async function requestKeep(sm) {
  if (!sm || typeof sm.persist !== 'function') return null;
  try {
    if (typeof sm.persisted === 'function' && (await sm.persisted())) return true;
    return !!(await sm.persist());
  } catch (e) {
    return null;
  }
}

export async function readKeep(sm) {
  if (!sm || typeof sm.persisted !== 'function') return null;
  try {
    const kept = !!(await sm.persisted());
    let kb = null;
    if (typeof sm.estimate === 'function') {
      const est = await sm.estimate();
      if (est && Number.isFinite(est.usage)) kb = Math.round(est.usage / 1024);
    }
    return { kept, kb };
  } catch (e) {
    return null;
  }
}
