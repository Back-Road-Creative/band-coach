// Turns a listened-to capture (src/app.js's `cap.notes`, recorded live by
// the pitch tracker) into a draft Song the library/editor/lesson generator
// already understand -- the "Make it a lesson" path (app.js's capUse
// button), so a captured tune gets the FULL lesson (buildLessonPlan) instead
// of the four-note drill DB.custom gives it. Pure: no DOM, no clock reads,
// no randomness -- `now` is caller-supplied (Date.now() in the app, a fixed
// instant in tests).
//
// `notes` is app.js's cap.notes shape: [{ m: midi, t: startSec, d: durSec }],
// already merged/deduped by capStop(). Reuses quantizeNotes (src/song/
// quantize.js) for the seconds->ticks grid snap so capture and MIDI/audio
// import share one quantization behaviour rather than a second
// reimplementation of "round to the nearest 16th" living here.

import { normalizeSong } from './model.js';
import { quantizeNotes } from './quantize.js';

function isNonEmptyString(x) { return typeof x === 'string' && x.length > 0; }

// YYYY-MM-DD from `now` (a timestamp), matching src/app.js's own today().
function dateStamp(now) {
  const d = new Date(now);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function captureToSong(notes, { name, now, bpm = 90 } = {}) {
  if (!Array.isArray(notes) || !notes.length) {
    throw new Error('captureToSong needs at least one captured note');
  }
  if (!Number.isFinite(now)) {
    throw new Error('captureToSong requires a numeric `now` timestamp');
  }
  const quantized = quantizeNotes(
    notes.map(n => ({ midi: n.m, startSec: n.t, durSec: n.d })),
    [{ tick: 0, bpm }]
  );
  const partNotes = quantized.map(n => ({ start: n.tick, dur: n.durTicks, midi: n.midi }));
  const title = isNonEmptyString(name) ? name : 'Captured tune ' + dateStamp(now);
  return normalizeSong({
    id: 'capture-' + now,
    title,
    composer: null,
    licence: null,
    // Same top-level `source` field the schema already carries (a string or
    // null, src/song/model.js) -- there is no separate provenance/meta slot,
    // so this is how the library and Songs panel would know a song came from
    // capture rather than import/authoring, without a new field.
    source: 'capture',
    key: null,
    metre: { num: 4, den: 4 },
    bpm,
    parts: [{ id: 'melody', name: 'Melody', notes: partNotes }],
    chords: []
  });
}
