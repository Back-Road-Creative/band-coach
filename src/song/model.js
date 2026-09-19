// Song model: shape, validation, normalization and pure helpers for the
// shared Song data structure (see band-coach-author-brief.md, Wave C).
// Wiring pass: normalizeSong(raw) on anything read from disk/MIDI/JSON
// before storing/playing (valid Song or throws a plain-English Error);
// validateSong(song) to check a hand-built Song without throwing;
// songDurationTicks/barsOf/notesInBar/partRange are read-only helpers;
// transpose returns a NEW song (input untouched); ticksToSeconds converts
// a tick offset to wall-clock seconds for scheduling. Pure: no DOM, no
// globals, no randomness, no clock reads — everything is a parameter.

export const SCHEMA = 'song/1';
export const TICKS_PER_QUARTER = 480;
export const MODES = ['major', 'minor'];
const VALID_DENOMINATORS = [1, 2, 4, 8, 16, 32, 64];

function isFiniteNumber(x) { return typeof x === 'number' && Number.isFinite(x); }
function isInt(x) { return isFiniteNumber(x) && Math.floor(x) === x; }
function isNonNegInt(x) { return isInt(x) && x >= 0; }
function isMidi(x) { return isInt(x) && x >= 0 && x <= 127; }
function clamp(x, low, high) { return Math.min(high, Math.max(low, x)); }
function isPlainObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function isNonEmptyString(x) { return typeof x === 'string' && x.length > 0; }
function isStringOrNull(x) { return x === null || typeof x === 'string'; }

// ---- validation --------------------------------------------------------

// Validates one note within a part. `prev` is the previous note in the same
// part's sorted notes array, or undefined for the first note.
function validateNote(note, index, prev, path, errors) {
  if (!isPlainObject(note)) {
    errors.push(path + ': note is not an object');
    return;
  }
  if (!isNonNegInt(note.start)) {
    errors.push(path + '.start must be a non-negative integer tick count (got ' + JSON.stringify(note.start) + ')');
  }
  if (!isInt(note.dur) || note.dur <= 0) {
    errors.push(path + '.dur must be a positive integer tick count (got ' + JSON.stringify(note.dur) + ')');
  }
  if (!isMidi(note.midi)) {
    errors.push(path + '.midi must be an integer 0-127 (got ' + JSON.stringify(note.midi) + ')');
  }
  if ('tieFromPrev' in note && note.tieFromPrev !== true) {
    errors.push(path + '.tieFromPrev must be omitted or exactly true (got ' + JSON.stringify(note.tieFromPrev) + ')');
  }
  if ('confidence' in note) {
    if (!isFiniteNumber(note.confidence) || note.confidence < 0 || note.confidence > 1) {
      errors.push(path + '.confidence must be a number between 0 and 1 (got ' + JSON.stringify(note.confidence) + ')');
    }
  }
  if (index > 0 && isNonNegInt(note.start) && prev && isNonNegInt(prev.start)) {
    if (note.start < prev.start) {
      errors.push(path + ': notes must be sorted by start (got ' + note.start + ' after ' + prev.start + ')');
    }
  }
  if (note.tieFromPrev === true) {
    if (!prev) {
      errors.push(path + ': tieFromPrev on the first note of a part has no previous note to tie from');
    } else if (prev.midi !== note.midi) {
      errors.push(path + ': tieFromPrev requires the previous note to have the same pitch (got ' + prev.midi + ' -> ' + note.midi + ')');
    } else if (isInt(prev.start) && isInt(prev.dur) && prev.start + prev.dur !== note.start) {
      errors.push(path + ': tieFromPrev requires the previous note to end exactly where this one starts');
    }
  }
}

function validatePart(part, pIndex, errors) {
  const path = 'parts[' + pIndex + ']';
  if (!isPlainObject(part)) {
    errors.push(path + ' is not an object');
    return;
  }
  if (!isNonEmptyString(part.id)) {
    errors.push(path + '.id must be a non-empty string');
  }
  if (!isNonEmptyString(part.name)) {
    errors.push(path + '.name must be a non-empty string');
  }
  if (!Array.isArray(part.notes)) {
    errors.push(path + '.notes must be an array');
    return;
  }
  let prev;
  part.notes.forEach((note, i) => {
    validateNote(note, i, prev, path + '.notes[' + i + ']', errors);
    if (isPlainObject(note)) prev = note;
  });
}

function validateChord(chord, index, errors) {
  const path = 'chords[' + index + ']';
  if (!isPlainObject(chord)) {
    errors.push(path + ' is not an object');
    return;
  }
  if (!isNonNegInt(chord.start)) {
    errors.push(path + '.start must be a non-negative integer tick count (got ' + JSON.stringify(chord.start) + ')');
  }
  if (!isNonEmptyString(chord.symbol)) {
    errors.push(path + '.symbol must be a non-empty string');
  }
}

// Validates a Song object. Never throws: returns { ok, errors }.
export function validateSong(song) {
  const errors = [];
  const fail = msg => errors.push(msg);

  if (!isPlainObject(song)) {
    return { ok: false, errors: ['song is not an object'] };
  }

  if (song.schema !== SCHEMA) {
    fail('schema must be ' + JSON.stringify(SCHEMA) + ' (got ' + JSON.stringify(song.schema) + ')');
  }
  if (!isNonEmptyString(song.id)) {
    fail('id must be a non-empty string');
  }
  if (!isNonEmptyString(song.title)) {
    fail('title must be a non-empty string');
  }
  if (!isStringOrNull(song.composer)) {
    fail('composer must be a string or null');
  }
  if (!isStringOrNull(song.licence)) {
    fail('licence must be a string or null');
  }
  if (!isStringOrNull(song.source)) {
    fail('source must be a string or null');
  }

  if (song.key !== null) {
    if (!isPlainObject(song.key)) {
      fail('key must be an object { tonic, mode } or null');
    } else {
      if (!isInt(song.key.tonic) || song.key.tonic < 0 || song.key.tonic > 11) {
        fail('key.tonic must be an integer 0-11 (got ' + JSON.stringify(song.key.tonic) + ')');
      }
      if (!MODES.includes(song.key.mode)) {
        fail('key.mode must be one of ' + MODES.join('|') + ' (got ' + JSON.stringify(song.key.mode) + ')');
      }
    }
  }

  if (!isPlainObject(song.metre)) {
    fail('metre must be an object { num, den }');
  } else {
    if (!isInt(song.metre.num) || song.metre.num < 1) {
      fail('metre.num must be a positive integer (got ' + JSON.stringify(song.metre.num) + ')');
    }
    if (!VALID_DENOMINATORS.includes(song.metre.den)) {
      fail('metre.den must be one of ' + VALID_DENOMINATORS.join('|') + ' (got ' + JSON.stringify(song.metre.den) + ')');
    }
  }

  if (!isFiniteNumber(song.bpm) || song.bpm <= 0) {
    fail('bpm must be a positive number (got ' + JSON.stringify(song.bpm) + ')');
  }

  if (song.ticksPerQuarter !== TICKS_PER_QUARTER) {
    fail('ticksPerQuarter must be ' + TICKS_PER_QUARTER + ' (got ' + JSON.stringify(song.ticksPerQuarter) + ')');
  }

  if (!Array.isArray(song.parts)) {
    fail('parts must be an array');
  } else {
    song.parts.forEach((part, i) => validatePart(part, i, errors));
  }

  if (!Array.isArray(song.chords)) {
    fail('chords must be an array');
  } else {
    song.chords.forEach((chord, i) => validateChord(chord, i, errors));
  }

  return { ok: errors.length === 0, errors };
}

// ---- normalization -------------------------------------------------------

function normalizeNote(raw, path) {
  if (!isPlainObject(raw)) {
    throw new Error(path + ' must be an object');
  }
  if (!isFiniteNumber(raw.start)) {
    throw new Error(path + '.start is missing or not a number');
  }
  if (!isFiniteNumber(raw.midi)) {
    throw new Error(path + '.midi is missing or not a number');
  }
  const note = {
    start: Math.max(0, Math.round(raw.start)),
    dur: isFiniteNumber(raw.dur) ? Math.max(1, Math.round(raw.dur)) : 1,
    midi: clamp(Math.round(raw.midi), 0, 127)
  };
  if (raw.tieFromPrev === true) note.tieFromPrev = true;
  if (isFiniteNumber(raw.confidence)) note.confidence = clamp(raw.confidence, 0, 1);
  return note;
}

function normalizePart(raw, index) {
  if (!isPlainObject(raw)) {
    throw new Error('parts[' + index + '] must be an object');
  }
  if (!Array.isArray(raw.notes)) {
    throw new Error('parts[' + index + '].notes is missing or not an array');
  }
  const notes = raw.notes
    .map((n, i) => normalizeNote(n, 'parts[' + index + '].notes[' + i + ']'))
    .sort((a, b) => a.start - b.start);

  // A tie survives normalization only if it still meets the rule after
  // sorting/clamping; otherwise it is dropped rather than left dangling.
  for (let i = 0; i < notes.length; i++) {
    if (!notes[i].tieFromPrev) continue;
    const prev = notes[i - 1];
    const valid = prev && prev.midi === notes[i].midi && prev.start + prev.dur === notes[i].start;
    if (!valid) delete notes[i].tieFromPrev;
  }

  return {
    id: isNonEmptyString(raw.id) ? raw.id : 'part-' + (index + 1),
    name: isNonEmptyString(raw.name) ? raw.name : 'Part ' + (index + 1),
    notes
  };
}

function normalizeChord(raw, index) {
  if (!isPlainObject(raw)) {
    throw new Error('chords[' + index + '] must be an object');
  }
  if (!isFiniteNumber(raw.start)) {
    throw new Error('chords[' + index + '].start is missing or not a number');
  }
  if (!isNonEmptyString(raw.symbol)) {
    throw new Error('chords[' + index + '].symbol is missing or empty');
  }
  return { start: Math.max(0, Math.round(raw.start)), symbol: raw.symbol };
}

// Turns anything into a valid Song, or throws an Error whose `.message` is
// plain English. Fields that can be safely defaulted or coerced are (notes
// get sorted by start, out-of-range numbers get clamped, unknown keys are
// dropped); fields with no safe default (id, per-note start/midi, part
// notes arrays) throw instead of guessing.
export function normalizeSong(raw) {
  if (!isPlainObject(raw)) {
    throw new Error('a song must be an object');
  }
  if (!isNonEmptyString(raw.id)) {
    throw new Error('a song needs a non-empty string id');
  }

  const metre = isPlainObject(raw.metre) ? raw.metre : {};
  const num = isInt(metre.num) && metre.num >= 1 ? metre.num : 4;
  const den = VALID_DENOMINATORS.includes(metre.den) ? metre.den : 4;

  const key = raw.key === null || raw.key === undefined
    ? null
    : (() => {
        if (!isPlainObject(raw.key)) {
          throw new Error('key must be an object { tonic, mode } or null');
        }
        if (!isInt(raw.key.tonic) || raw.key.tonic < 0 || raw.key.tonic > 11) {
          throw new Error('key.tonic must be an integer 0-11');
        }
        if (!MODES.includes(raw.key.mode)) {
          throw new Error('key.mode must be "major" or "minor"');
        }
        return { tonic: raw.key.tonic, mode: raw.key.mode };
      })();

  const parts = Array.isArray(raw.parts) ? raw.parts.map(normalizePart) : [];
  const chords = Array.isArray(raw.chords)
    ? raw.chords.map(normalizeChord).sort((a, b) => a.start - b.start)
    : [];

  const song = {
    schema: SCHEMA,
    id: raw.id,
    title: isNonEmptyString(raw.title) ? raw.title : 'Untitled',
    composer: typeof raw.composer === 'string' ? raw.composer : null,
    licence: typeof raw.licence === 'string' ? raw.licence : null,
    source: typeof raw.source === 'string' ? raw.source : null,
    key,
    metre: { num, den },
    bpm: isFiniteNumber(raw.bpm) && raw.bpm > 0 ? raw.bpm : 120,
    ticksPerQuarter: TICKS_PER_QUARTER,
    parts,
    chords
  };

  const { ok, errors } = validateSong(song);
  if (!ok) {
    // Should not happen given the coercions above; surfaced plainly if it does.
    throw new Error('song could not be normalized: ' + errors.join('; '));
  }
  return song;
}

// ---- pure helpers ----------------------------------------------------

export function songDurationTicks(song) {
  let end = 0;
  for (const part of song.parts) {
    for (const note of part.notes) {
      end = Math.max(end, note.start + note.dur);
    }
  }
  return end;
}

function barTicksOf(song) {
  const beatsToQuarterRatio = 4 / song.metre.den;
  return song.metre.num * beatsToQuarterRatio * song.ticksPerQuarter;
}

// Bar boundaries in ticks, e.g. [0, 1920, 3840]. Always covers at least one
// bar, even for an empty song, so a coach UI always has a bar 1 to show.
export function barsOf(song) {
  const barTicks = barTicksOf(song);
  const duration = songDurationTicks(song);
  const barCount = duration > 0 ? Math.ceil(duration / barTicks) : 1;
  const boundaries = [];
  for (let i = 0; i <= barCount; i++) {
    boundaries.push(i * barTicks);
  }
  return boundaries;
}

// Notes (from every part) whose start falls within bar `barIndex`, each
// tagged with the part id it came from.
export function notesInBar(song, barIndex) {
  if (!isInt(barIndex) || barIndex < 0) {
    throw new Error('barIndex must be a non-negative integer');
  }
  const barTicks = barTicksOf(song);
  const barStart = barIndex * barTicks;
  const barEnd = barStart + barTicks;
  const result = [];
  for (const part of song.parts) {
    for (const note of part.notes) {
      if (note.start >= barStart && note.start < barEnd) {
        result.push({ partId: part.id, note });
      }
    }
  }
  return result;
}

// Lowest and highest MIDI note used in a part; { low: null, high: null } if
// the part has no notes.
export function partRange(part) {
  if (!part.notes.length) return { low: null, high: null };
  let low = Infinity;
  let high = -Infinity;
  for (const note of part.notes) {
    if (note.midi < low) low = note.midi;
    if (note.midi > high) high = note.midi;
  }
  return { low, high };
}

// Returns a NEW song with every note shifted by `semitones` (clamped to the
// 0-127 MIDI range) and the key's tonic shifted to match. Does not mutate
// the input.
export function transpose(song, semitones) {
  if (!isInt(semitones)) {
    throw new Error('semitones must be an integer');
  }
  return {
    ...song,
    key: song.key ? { tonic: ((song.key.tonic + semitones) % 12 + 12) % 12, mode: song.key.mode } : null,
    parts: song.parts.map(part => ({
      ...part,
      notes: part.notes.map(note => ({ ...note, midi: clamp(note.midi + semitones, 0, 127) }))
    }))
  };
}

// Converts a tick offset to wall-clock seconds at the given tempo.
export function ticksToSeconds(ticks, bpm) {
  if (!isFiniteNumber(ticks)) {
    throw new Error('ticks must be a number');
  }
  if (!isFiniteNumber(bpm) || bpm <= 0) {
    throw new Error('bpm must be a positive number');
  }
  return (ticks / TICKS_PER_QUARTER) * (60 / bpm);
}
