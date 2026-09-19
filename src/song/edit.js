// Pure, immutable edit operations over the shared Song shape (see
// band-coach-author-brief.md "Wave C" for the schema). Every function in this
// file takes a Song (and never mutates it, or the note/part objects inside
// it) and returns either a new Song, or `{ song, changed }` where `changed`
// lists the indexes (into the RETURNED song) of notes that were created or
// altered by the operation. Deletions never appear in `changed` -- there is
// nothing left to point an index at.
//
// WIRING NOTES for whoever connects this to the UI:
//   - `partIndex` / `noteIndex` are plain array indexes into
//     `song.parts` / `song.parts[partIndex].notes`.
//   - A "range" is `{ start, end }` in ticks, half-open: a note is "in range"
//     when `start <= note.start < end`.
//   - `grid` arguments are a tick count (e.g. `ticksPerQuarter / 4` for a
//     16th-note grid); pass 0 or omit to skip snapping.
//   - `createHistory` wraps a Song and expects every undoable action to be
//     expressed as `history.apply(song => someOp(song, ...))`; `someOp` must
//     return either a bare Song or `{ song, changed }` (only `.song` is kept
//     in history, the full result is returned to the caller of `apply`).
//   - `hitTest` is given a list of pre-computed layout boxes (produced by
//     whatever the canvas layer turns notes into): pass boxes in painter's
//     order (back to front); the last box in the array that contains the
//     point wins, matching normal top-of-z-order hit testing.
//
// OVERLAP RULE (monophonic parts): after any operation that could leave two
// notes overlapping, notes are resolved left-to-right: if a note would start
// before the previous note ends, the PREVIOUS (earlier) note is trimmed so it
// ends exactly where the next one starts. A trim is clamped to a minimum
// duration of 1 tick. In the degenerate case of two notes landing on the
// exact same start tick (trimming would need to reach 0), the earlier note is
// dropped entirely rather than emitted with a zero/negative duration.
//
// Exception: `resize` pins the note's own start (that is the point of
// resizing rather than moving), so growing it trims FORWARD instead --
// the following note(s) get pushed/shrunk from the front, never the note
// you just grew. See `trimForward` below.

const MIN_DUR = 1;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampMidi(m) {
  return clamp(m, 0, 127);
}

function snap(value, grid) {
  if (!grid) return value;
  return Math.round(value / grid) * grid;
}

function cloneSong(song) {
  return {
    ...song,
    key: song.key ? { ...song.key } : null,
    metre: { ...song.metre },
    parts: song.parts.map((p) => ({ ...p, notes: p.notes.slice() })),
    chords: song.chords.slice(),
  };
}

function sortNotes(notes) {
  return notes.slice().sort((a, b) => a.start - b.start);
}

/** Trim/drop earlier notes so no two notes in `notes` (already start-sorted) overlap. */
function resolveOverlaps(notes) {
  const out = notes.slice();
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.start + prev.dur > cur.start) {
      const trimmed = cur.start - prev.start;
      if (trimmed <= 0) {
        // identical start tick: the earlier note is fully consumed
        out.splice(i - 1, 1);
        i -= 1;
        continue;
      }
      out[i - 1] = { ...prev, dur: Math.max(MIN_DUR, trimmed) };
    }
  }
  return out;
}

/**
 * Growing a note (resize) has its start pinned by definition, so the general
 * "trim the earlier note" rule would just undo the resize. Instead, growth
 * trims forward: whichever following notes it now overlaps get their start
 * pushed to where the grown note ends (shrinking them from the front), and a
 * note fully swallowed is dropped. `notes` must already be sorted by start.
 */
function trimForward(notes, index) {
  const out = notes.slice();
  const cur = out[index];
  for (let i = index + 1; i < out.length; ) {
    const nxt = out[i];
    if (cur.start + cur.dur <= nxt.start) break;
    const newStart = cur.start + cur.dur;
    const newDur = nxt.start + nxt.dur - newStart;
    if (newDur <= 0) {
      out.splice(i, 1); // fully swallowed by the grown note
      continue;
    }
    out[i] = { ...nxt, start: newStart, dur: newDur };
    break; // only the immediate neighbor can still be touched
  }
  return out;
}

/** Indexes (into `newNotes`) of notes that are not reference-identical to any note in `oldNotes`. */
function computeChanged(oldNotes, newNotes) {
  const origSet = new Set(oldNotes);
  const changed = [];
  newNotes.forEach((n, i) => {
    if (!origSet.has(n)) changed.push(i);
  });
  return changed;
}

function finalizePart(song, partIndex, notes, changed) {
  const newSong = cloneSong(song);
  newSong.parts[partIndex] = { ...newSong.parts[partIndex], notes };
  return { song: newSong, changed };
}

function getNote(song, partIndex, noteIndex) {
  const note = song.parts[partIndex] && song.parts[partIndex].notes[noteIndex];
  if (!note) throw new RangeError(`no note at part ${partIndex} index ${noteIndex}`);
  return note;
}

// ---------------------------------------------------------------- note ops

export function moveNote(song, partIndex, noteIndex, newStart, grid = 0) {
  const orig = song.parts[partIndex].notes;
  const note = getNote(song, partIndex, noteIndex);
  let start = snap(newStart, grid);
  if (start < 0) start = 0;
  const moved = { ...note, start };
  const rest = orig.filter((_, i) => i !== noteIndex);
  const notes = resolveOverlaps(sortNotes(rest.concat([moved])));
  return finalizePart(song, partIndex, notes, computeChanged(orig, notes));
}

export function repitch(song, partIndex, noteIndex, { semitones = 0, octaves = 0, set } = {}) {
  const orig = song.parts[partIndex].notes;
  const note = getNote(song, partIndex, noteIndex);
  const midi = clampMidi(typeof set === 'number' ? set : note.midi + semitones + octaves * 12);
  const notes = orig.slice();
  notes[noteIndex] = { ...note, midi };
  return finalizePart(song, partIndex, notes, [noteIndex]);
}

export function resize(song, partIndex, noteIndex, newDur) {
  if (!(newDur >= MIN_DUR)) throw new RangeError('resize: duration must be positive');
  const orig = song.parts[partIndex].notes;
  const note = getNote(song, partIndex, noteIndex);
  const resized = { ...note, dur: newDur };
  const rest = orig.slice();
  rest[noteIndex] = resized;
  // orig is already sorted and resize never changes `start`, so `rest` stays sorted.
  const notes = trimForward(rest, noteIndex);
  return finalizePart(song, partIndex, notes, computeChanged(orig, notes));
}

export function deleteNote(song, partIndex, noteIndex) {
  const orig = song.parts[partIndex].notes;
  getNote(song, partIndex, noteIndex);
  const notes = orig.filter((_, i) => i !== noteIndex);
  return finalizePart(song, partIndex, notes, []);
}

export function insertNote(song, partIndex, note) {
  if (!(note.dur >= MIN_DUR)) throw new RangeError('insertNote: duration must be positive');
  const orig = song.parts[partIndex].notes;
  const notes = resolveOverlaps(sortNotes(orig.concat([{ ...note }])));
  return finalizePart(song, partIndex, notes, computeChanged(orig, notes));
}

export function splitNote(song, partIndex, noteIndex, offset) {
  const orig = song.parts[partIndex].notes;
  const note = getNote(song, partIndex, noteIndex);
  if (!(offset > 0 && offset < note.dur)) {
    throw new RangeError('splitNote: offset must fall strictly inside the note');
  }
  const first = { ...note, dur: offset };
  const second = { ...note, start: note.start + offset, dur: note.dur - offset, tieFromPrev: true };
  const rest = orig.filter((_, i) => i !== noteIndex);
  const notes = resolveOverlaps(sortNotes(rest.concat([first, second])));
  return finalizePart(song, partIndex, notes, computeChanged(orig, notes));
}

export function mergeWithNext(song, partIndex, noteIndex) {
  const orig = song.parts[partIndex].notes;
  const note = getNote(song, partIndex, noteIndex);
  const next = orig[noteIndex + 1];
  if (!next) throw new RangeError('mergeWithNext: no following note');
  if (next.midi !== note.midi) throw new RangeError('mergeWithNext: pitches differ');
  const merged = { ...note, dur: next.start + next.dur - note.start };
  const rest = orig.filter((_, i) => i !== noteIndex && i !== noteIndex + 1);
  const notes = resolveOverlaps(sortNotes(rest.concat([merged])));
  return finalizePart(song, partIndex, notes, computeChanged(orig, notes));
}

export function setTie(song, partIndex, noteIndex, tie) {
  const orig = song.parts[partIndex].notes;
  const note = getNote(song, partIndex, noteIndex);
  const notes = orig.slice();
  if (tie) {
    notes[noteIndex] = { ...note, tieFromPrev: true };
  } else {
    const { tieFromPrev, ...rest } = note;
    notes[noteIndex] = rest;
  }
  return finalizePart(song, partIndex, notes, [noteIndex]);
}

// ----------------------------------------------------------- selection ops

function inRange(note, range) {
  return note.start >= range.start && note.start < range.end;
}

export function transposeRange(song, partIndex, range, semitones) {
  const orig = song.parts[partIndex].notes;
  const notes = orig.map((n) => (inRange(n, range) ? { ...n, midi: clampMidi(n.midi + semitones) } : n));
  return finalizePart(song, partIndex, notes, computeChanged(orig, notes));
}

export function shiftRange(song, partIndex, range, deltaTicks, grid = 0) {
  const orig = song.parts[partIndex].notes;
  const selected = [];
  const others = [];
  for (const n of orig) (inRange(n, range) ? selected : others).push(n);
  const shifted = selected.map((n) => {
    let start = snap(n.start + deltaTicks, grid);
    if (start < 0) start = 0;
    return { ...n, start };
  });
  const notes = resolveOverlaps(sortNotes(others.concat(shifted)));
  return finalizePart(song, partIndex, notes, computeChanged(orig, notes));
}

export function deleteRange(song, partIndex, range) {
  const orig = song.parts[partIndex].notes;
  const notes = orig.filter((n) => !inRange(n, range));
  return finalizePart(song, partIndex, notes, []);
}

export function quantizeRange(song, partIndex, range, grid) {
  const orig = song.parts[partIndex].notes;
  const notes = orig.map((n) => {
    if (!inRange(n, range)) return n;
    const start = Math.max(0, snap(n.start, grid));
    return start === n.start ? n : { ...n, start };
  });
  const resolved = resolveOverlaps(sortNotes(notes));
  return finalizePart(song, partIndex, resolved, computeChanged(orig, resolved));
}

// ----------------------------------------------------------------- song ops

export function setBpm(song, bpm) {
  if (!(bpm > 0)) throw new RangeError('setBpm: bpm must be positive');
  const newSong = cloneSong(song);
  newSong.bpm = bpm;
  return { song: newSong, changed: [] };
}

/** Re-bars the song (changes the time-signature label only); no note is moved. */
export function setMetre(song, metre) {
  const newSong = cloneSong(song);
  newSong.metre = { ...metre };
  return { song: newSong, changed: [] };
}

export function setKey(song, key) {
  const newSong = cloneSong(song);
  newSong.key = key ? { ...key } : null;
  return { song: newSong, changed: [] };
}

/**
 * Shifts every note and chord in the song forward (or back) by `pickupTicks`,
 * e.g. to make "the song starts on beat 3": pass the tick length of the
 * pickup so bar 1 becomes a partial measure and everything after it lands on
 * the same barlines as before. Refuses a shift that would push any note
 * before tick 0.
 */
export function shiftBarline(song, pickupTicks) {
  for (const part of song.parts) {
    for (const note of part.notes) {
      if (note.start + pickupTicks < 0) {
        throw new RangeError('shiftBarline: would produce a negative note start');
      }
    }
  }
  const newSong = cloneSong(song);
  const changed = [];
  newSong.parts = newSong.parts.map((p, partIndex) => {
    const notes = p.notes.map((n, noteIndex) => {
      changed.push({ partIndex, noteIndex });
      return { ...n, start: n.start + pickupTicks };
    });
    return { ...p, notes };
  });
  newSong.chords = newSong.chords.map((c) => ({ ...c, start: c.start + pickupTicks }));
  return { song: newSong, changed };
}

function scaleDurations(song, factor, bpmFactor) {
  const newSong = cloneSong(song);
  const changed = [];
  newSong.parts = newSong.parts.map((p, partIndex) => {
    const notes = p.notes.map((n, noteIndex) => {
      changed.push({ partIndex, noteIndex });
      return {
        ...n,
        start: Math.round(n.start * factor),
        dur: Math.max(MIN_DUR, Math.round(n.dur * factor)),
      };
    });
    return { ...p, notes };
  });
  newSong.bpm = song.bpm * bpmFactor;
  return { song: newSong, changed };
}

/**
 * Fixes a transcription that came out at double the true note values: halves
 * every note's start/duration and halves bpm with them, so the tune still
 * sounds at the same speed and only the notation reads correctly. bpm moves
 * WITH the tick scale because seconds = ticks / ticksPerQuarter * 60 / bpm
 * (src/song/model.js ticksToSeconds); scaling it the other way made playback
 * four times too fast.
 */
export function halveDurations(song) {
  return scaleDurations(song, 0.5, 0.5);
}

/** Fixes a transcription that came out at half the true note values (mirror of halveDurations). */
export function doubleDurations(song) {
  return scaleDurations(song, 2, 2);
}

export function octaveShiftPart(song, partIndex, octaves) {
  const orig = song.parts[partIndex].notes;
  const notes = orig.map((n) => ({ ...n, midi: clampMidi(n.midi + octaves * 12) }));
  return finalizePart(song, partIndex, notes, computeChanged(orig, notes));
}

// ------------------------------------------------------------------ history

/**
 * `createHistory(song, { limit })` — a simple linear undo/redo stack.
 * `apply(opFn)` calls `opFn(currentSong)`, which must return either a Song or
 * `{ song, changed }` (any of the ops above); the resulting Song becomes the
 * new current state and any redo branch is discarded. The full result of
 * `opFn` is returned from `apply` so a caller can still read `changed`.
 */
export function createHistory(song, { limit = Infinity } = {}) {
  let states = [song];
  let cursor = 0;

  return {
    apply(opFn) {
      const result = opFn(states[cursor]);
      const nextSong = result && Object.prototype.hasOwnProperty.call(result, 'song') ? result.song : result;
      states = states.slice(0, cursor + 1);
      states.push(nextSong);
      if (states.length > limit) states.shift();
      cursor = states.length - 1;
      return result;
    },
    undo() {
      if (cursor > 0) cursor -= 1;
      return states[cursor];
    },
    redo() {
      if (cursor < states.length - 1) cursor += 1;
      return states[cursor];
    },
    current() {
      return states[cursor];
    },
    get canUndo() {
      return cursor > 0;
    },
    get canRedo() {
      return cursor < states.length - 1;
    },
  };
}

// ------------------------------------------------------------------ hitTest

/**
 * Given layout boxes `[{ noteIndex, x, y, w, h }]` in painter's order (back
 * to front), returns the topmost box containing point (x, y), expanded by
 * `slop` on every side for touch-friendly hit testing, or null.
 */
export function hitTest(layoutBoxes, x, y, slop = 0) {
  for (let i = layoutBoxes.length - 1; i >= 0; i--) {
    const b = layoutBoxes[i];
    const left = b.x - slop;
    const top = b.y - slop;
    const right = b.x + b.w + slop;
    const bottom = b.y + b.h + slop;
    if (x >= left && x <= right && y >= top && y <= bottom) return b;
  }
  return null;
}
