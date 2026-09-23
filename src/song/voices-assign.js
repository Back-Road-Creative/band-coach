// voices-assign: split a flat, possibly-overlapping list of detected notes
// (what a multipitch tracker emits) into role-tagged parts matching the
// Song model's part.role field (src/song/model.js ROLES: melody, bass,
// inner, percussion). Pure: no DOM, no AudioContext.
//
// Wiring pass (B5): feed transcribe.js's detected notes through
// assignVoices and hand the resulting parts to normalizeSong/edit.js;
// nothing here is wired into transcribe.js or the UI yet.
import { trackContours, pickMelody, contourStats } from './melody.js';

function byStart(notes) { return notes.slice().sort((a, b) => a.start - b.start); }

// A contour is "stable" enough to be the bass line if its note count isn't
// far below the busiest non-melody contour's -- otherwise a single stray
// low note (a fret buzz, a bad detection) would outrank a fully-played
// inner line just for sitting lower.
const BASS_STABILITY_FLOOR = 0.4;

function pickBass(restContours) {
  if (!restContours.length) return null;
  const maxCount = Math.max(...restContours.map((c) => c.notes.length));
  const stable = restContours.filter((c) => c.notes.length >= maxCount * BASS_STABILITY_FLOOR);
  stable.sort((a, b) => contourStats(a).avg - contourStats(b).avg);
  return stable[0] || null;
}

// assignVoices(notes, opts) -> [{ role, notes }], one entry per role that
// has notes. `opts` is passed through to trackContours/pickMelody (see
// melody.js for onsetEpsilon/maxJump/hysteresis). Notes are never cloned
// or mutated -- each output note is the same object the caller passed in.
export function assignVoices(notes, opts = {}) {
  const pitched = [];
  const percussive = [];
  for (const note of notes) {
    if (note.unpitched || note.percussive) percussive.push(note);
    else pitched.push(note);
  }

  const parts = [];
  const contours = trackContours(pitched, opts);
  if (contours.length) {
    const melodyId = pickMelody(contours, opts);
    const melodyContour = contours.find((c) => c.id === melodyId);
    const rest = contours.filter((c) => c.id !== melodyId);
    const bassContour = pickBass(rest);

    if (melodyContour && melodyContour.notes.length) parts.push({ role: 'melody', notes: byStart(melodyContour.notes) });
    if (bassContour && bassContour.notes.length) parts.push({ role: 'bass', notes: byStart(bassContour.notes) });
    const innerNotes = rest.filter((c) => c !== bassContour).flatMap((c) => c.notes);
    if (innerNotes.length) parts.push({ role: 'inner', notes: byStart(innerNotes) });
  }
  if (percussive.length) parts.push({ role: 'percussion', notes: byStart(percussive) });
  return parts;
}
