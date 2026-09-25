// The "Record a tune" panel's unsaved-work stash (P3-10): a learner who
// switches away from the editor (to Settings, the instrument sheet, or
// Songs) before pressing Save must find their edits still there on return --
// panels.close() tears the editor panel's whole mounted instance down (see
// src/ui/panels.js's close(): every hide() is followed by a delete from its
// `mounted` map), so the only place that survives a switch is the panel's
// own saved-data slot (api.store('editor-working'), the same PANEL_DATA_MAX-
// capped JSON blob every other cross-panel handoff in this app uses -- see
// src/ui/songs.js's OPEN_REQUEST_STORE_ID for the established pattern).
//
// Pure and DOM-free by design (no api.store call lives here -- editor.js
// owns the one get()/set() pair, same division of labour as src/ui/songs/
// song-status.js): a plain in/out shape, trivially unit-testable, so the
// "never half-store" rule below is provable without a browser.
import { PANEL_DATA_MAX } from '../panels.js';
import { validateSong } from '../../song/model.js';

// The shape both stashWorking and restoreWorking agree on: a plain object
// carrying `song` (the in-progress Song, however invalid mid-edit -- see
// stashWorking's own comment on why it is NOT re-validated here) and `meta`
// (the small bag of extra state the editor needs to pick back up where it
// left off: loadedId, the still-open needsCheck list, and whether the
// learner had ticked the acknowledgement box). Anything else is junk.
function sanitizeWorking(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const song = raw.song;
  const check = validateSong(song);
  if (!check.ok) return null;
  const rawMeta = raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : {};
  const meta = {
    loadedId: typeof rawMeta.loadedId === 'string' && rawMeta.loadedId ? rawMeta.loadedId : null,
    needsCheck: Array.isArray(rawMeta.needsCheck) ? rawMeta.needsCheck.filter((x) => typeof x === 'string') : [],
    acknowledged: !!rawMeta.acknowledged,
  };
  return { song, meta };
}

// Builds the stashed shape from the panel's live state, or `null` when there
// is nothing worth keeping. `song` is stashed AS EDITED -- it may fail
// validateSong mid-edit (e.g. a note deleted down to zero) and that is fine,
// since nothing here ever reaches the shared library; restoreWorking below
// re-validates on the way back in, so a corrupt/oversized stash is simply
// dropped rather than half-restored.
//
// Never half-store: JSON.stringify's OWN length decides this, not a guess --
// a song right at the panel-data ceiling would otherwise get silently
// truncated by whatever eventually persists api.store()'s value (src/ui/
// panels.js's sanitizePanelData), which is worse than losing the edit
// outright (a learner would see it "restored" with notes missing, and no
// way to tell). `null` in either case: the caller's `set(null)` is exactly
// what clears a stale stash, same as "no unsaved song" does.
export function stashWorking(song, meta) {
  if (!song || typeof song !== 'object') return null;
  const out = { song, meta: meta && typeof meta === 'object' ? meta : {} };
  let text;
  try { text = JSON.stringify(out); } catch (e) { return null; }
  if (text.length > PANEL_DATA_MAX) return null;
  return out;
}

// The reverse: `null` for anything that is not a valid { song, meta } shape
// (including a Song that no longer passes validateSong -- junk in, nothing
// out, same "clean, don't throw" rule as sanitizePanelData/
// sanitizeStatusLedger).
export function restoreWorking(raw) {
  return sanitizeWorking(raw);
}
