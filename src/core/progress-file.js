// Pure, DOM-free progress-backup helpers. The saved DB already carries a `v`
// field (see sanitizeDB in app.js) that nothing reads today — this module is
// what starts reading it, and gives export/import a versioned envelope of
// their own so a backup file can outlive the app version that wrote it.
//
// Nothing here trusts its input: importProgress() only gets the caller as
// far as a plausible `db` object. The call site must still run that db
// through the app's own sanitizeDB before using it.

export const PROGRESS_FORMAT = 'band-coach-progress';
export const PROGRESS_FORMAT_VERSION = 1;
export const CURRENT_DB_VERSION = 1;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

// Migration ladder for the saved DB's own `v` field, keyed by the version a
// db is migrating FROM. Each entry returns a db object at (key + 1). To add
// the next migration when the DB shape changes again: bump
// CURRENT_DB_VERSION and add ONE new entry here keyed by the version being
// migrated away from — never edit an existing entry.
const MIGRATIONS = {
  // 0 -> 1: dbs from before the `v` field existed at all. Nothing about the
  // shape changed, so just stamp the version.
  0: (db) => ({ ...db, v: 1 }),
};

/** Runs `db` forward through the migration ladder to CURRENT_DB_VERSION. */
export function migrate(db) {
  let out = db && typeof db === 'object' ? db : {};
  let v = Number.isInteger(out.v) ? out.v : 0;
  while (v < CURRENT_DB_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break; // no path from here; sanitizeDB will fall back to defaults downstream
    out = step(out);
    v = Number.isInteger(out.v) ? out.v : v + 1;
  }
  return out;
}

/** Wraps `db` in a JSON-serialisable backup envelope. */
export function exportProgress(db, { appVersion, now } = {}) {
  const nowMs = typeof now === 'function' ? now() : now ?? Date.now();
  return {
    format: PROGRESS_FORMAT,
    formatVersion: PROGRESS_FORMAT_VERSION,
    appVersion: appVersion || 'unknown',
    exportedAt: new Date(nowMs).toISOString(),
    db,
  };
}

function byteLength(text) {
  try {
    return new TextEncoder().encode(text).length;
  } catch (e) {
    return text.length;
  }
}

/**
 * Parses and validates a backup file's text. Returns `{ ok: true, db }` or
 * `{ ok: false, error }` — a plain-English, non-technical message either way.
 * The returned `db` is migrated but NOT sanitised; the caller must still run
 * it through sanitizeDB.
 */
export function importProgress(text) {
  if (typeof text !== 'string') {
    return { ok: false, error: 'That file could not be read.' };
  }
  if (byteLength(text) > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'That backup file is too large to be a Band Coach backup.' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'That does not look like a Band Coach backup file.' };
  }
  if (!parsed || typeof parsed !== 'object' || parsed.format !== PROGRESS_FORMAT) {
    return { ok: false, error: 'That does not look like a Band Coach backup file.' };
  }
  if (!Number.isInteger(parsed.formatVersion) || parsed.formatVersion > PROGRESS_FORMAT_VERSION) {
    return { ok: false, error: 'This backup was made by a newer Band Coach. Update the app to restore it.' };
  }
  return { ok: true, db: migrate(parsed.db) };
}
