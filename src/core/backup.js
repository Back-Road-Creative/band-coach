// Backup save/restore decisions, with no DOM: the caller does the Blob/anchor download, the FileReader and
// the confirm(), and hands in the stores and callbacks; these functions return what to say.

// The song store opens lazily, so a blocked or broken IndexedDB surfaces here, not when the library is made:
// the progress is still exported, and `songsMissing` lets backupSaveOutcome say the songs are not in the file.
export async function exportBackup({ library, exportProgressFile, db, appVersion, now }) {
  let songs = [], songsMissing = false;
  try { songs = await library().exportAll(); } catch (e) { songsMissing = true; }
  const env = exportProgressFile(db, { appVersion, now, songs });
  if (songsMissing) Object.defineProperty(env, 'songsMissing', { value: true });
  return env;
}

// What a finished save means. A file over maxBytes would be refused by restore, so it must not count as a backup made.
export function backupSaveOutcome(env, size, maxBytes) {
  const tooLarge = size > maxBytes;
  return { counted: !tooLarge, messageId: tooLarge ? 'backup.savedTooLarge' : env.songsMissing ? 'backup.savedNoSongs' : 'backup.saved' };
}

// Restores a parsed backup (or text, parsed here). Returns { ret, say, undo }: ret is what the caller returns,
// say = { id, params? } the line to speak, undo = the profile to put back on Undo (null unless the restore landed).
// snapshot() must return the live profile as it is now, current instrument included; applyProfile/writeDB act on it.
export async function restoreBackup(textOrChecked, { library, importProgressFile, snapshot, applyProfile, writeDB, en }) {
  const result = typeof textOrChecked === 'string' ? importProgressFile(textOrChecked) : textOrChecked; // a pre-checked result: parsed once
  if (!result.ok) return { ret: result, say: { id: result.errorId }, undo: null };
  // The songs go first because that is the store that can fail (e.g.
  // IndexedDB unavailable): if it does, nothing about the live profile
  // has changed yet, so there is nothing to roll back. Only once the
  // songs are safely in does this replace DB, prefs, theme and mod.
  let songsFailed = 0;
  if (Array.isArray(result.songs) && result.songs.length) {
    try { songsFailed = (await library().importAll(result.songs)).failed; }
    catch (e) { return { ret: { ok: false, error: en['backup.err.songsNotStored'] }, say: { id: 'backup.err.songsNotStored' }, undo: null }; }
  }
  const before = snapshot();
  applyProfile(result.db);
  if (!writeDB()) return { ret: { ok: false, error: en['backup.err.notSaved'] }, say: { id: 'backup.err.notSaved' }, undo: null };
  return { ret: result, say: songsFailed ? { id: 'backup.restoredSongsFailed', params: { count: songsFailed } } : { id: 'backup.restored' }, undo: before };
}
