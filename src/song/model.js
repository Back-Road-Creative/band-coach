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
export const ROLES = ['melody', 'bass', 'inner', 'percussion'];
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
  if ('velocity' in note) {
    if (!isInt(note.velocity) || note.velocity < 1 || note.velocity > 127) {
      errors.push(path + '.velocity must be an integer 1-127 (got ' + JSON.stringify(note.velocity) + ')');
    }
  }
  // `piece` names which drum-kit piece (src/instruments/drum-kit.js PIECES
  // id) a percussion-part note belongs to -- null for a channel-10 note
  // that doesn't map to any kit piece (e.g. GM 39 hand clap). Only meaningful
  // on a part with role 'percussion' (see validatePart's part.unmapped
  // below), but validated here regardless of role so a malformed value is
  // always caught, never silently ignored on a part missing its role.
  if ('piece' in note) {
    if (!isStringOrNull(note.piece)) {
      errors.push(path + '.piece must be a string or null (got ' + JSON.stringify(note.piece) + ')');
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
  if ('role' in part && !ROLES.includes(part.role)) {
    errors.push(path + '.role must be one of ' + ROLES.join('|') + ' (got ' + JSON.stringify(part.role) + ')');
  }
  if ('instrumentHint' in part && typeof part.instrumentHint !== 'string') {
    errors.push(path + '.instrumentHint must be a string (got ' + JSON.stringify(part.instrumentHint) + ')');
  }
  // `unmapped` -- how many of this part's notes carry piece: null (import-
  // midi.js's count of channel-10 notes it could not name a drum-kit piece
  // for). Optional: absent on any part that was never imported from a
  // channel-10 MIDI track.
  if ('unmapped' in part && !isNonNegInt(part.unmapped)) {
    errors.push(path + '.unmapped must be a non-negative integer (got ' + JSON.stringify(part.unmapped) + ')');
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

// Validates one entry of an optional sorted-by-tick change list (tempoMap,
// metreChanges, keyChanges). `checkFields` validates the entry's own fields
// beyond tick/sortedness and pushes onto `errors`.
function validateTickList(list, name, checkFields, errors) {
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    errors.push(name + ' must be an array');
    return;
  }
  let prevTick;
  list.forEach((entry, i) => {
    const path = name + '[' + i + ']';
    if (!isPlainObject(entry)) {
      errors.push(path + ' is not an object');
      return;
    }
    if (!isNonNegInt(entry.tick)) {
      errors.push(path + '.tick must be a non-negative integer (got ' + JSON.stringify(entry.tick) + ')');
    } else {
      if (i > 0 && isNonNegInt(prevTick) && entry.tick < prevTick) {
        errors.push(name + ' must be sorted by tick (got ' + entry.tick + ' after ' + prevTick + ')');
      }
      prevTick = entry.tick;
    }
    checkFields(entry, path, errors);
  });
}

function checkTempoFields(entry, path, errors) {
  if (!isFiniteNumber(entry.bpm) || entry.bpm <= 0) {
    errors.push(path + '.bpm must be a positive number (got ' + JSON.stringify(entry.bpm) + ')');
  }
}

function checkMetreFields(entry, path, errors) {
  if (!isInt(entry.num) || entry.num < 1) {
    errors.push(path + '.num must be a positive integer (got ' + JSON.stringify(entry.num) + ')');
  }
  if (!VALID_DENOMINATORS.includes(entry.den)) {
    errors.push(path + '.den must be one of ' + VALID_DENOMINATORS.join('|') + ' (got ' + JSON.stringify(entry.den) + ')');
  }
}

function checkKeyFields(entry, path, errors) {
  if (!isInt(entry.tonic) || entry.tonic < 0 || entry.tonic > 11) {
    errors.push(path + '.tonic must be an integer 0-11 (got ' + JSON.stringify(entry.tonic) + ')');
  }
  if (!MODES.includes(entry.mode)) {
    errors.push(path + '.mode must be one of ' + MODES.join('|') + ' (got ' + JSON.stringify(entry.mode) + ')');
  }
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

  validateTickList(song.tempoMap, 'tempoMap', checkTempoFields, errors);
  validateTickList(song.metreChanges, 'metreChanges', checkMetreFields, errors);
  validateTickList(song.keyChanges, 'keyChanges', checkKeyFields, errors);

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
  if ('velocity' in raw) {
    if (!isInt(raw.velocity) || raw.velocity < 1 || raw.velocity > 127) {
      throw new Error(path + '.velocity must be an integer 1-127');
    }
    note.velocity = raw.velocity;
  }
  if ('piece' in raw) {
    if (!isStringOrNull(raw.piece)) {
      throw new Error(path + '.piece must be a string or null');
    }
    note.piece = raw.piece;
  }
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

  const part = {
    id: isNonEmptyString(raw.id) ? raw.id : 'part-' + (index + 1),
    name: isNonEmptyString(raw.name) ? raw.name : 'Part ' + (index + 1),
    notes
  };
  if ('role' in raw) {
    if (!ROLES.includes(raw.role)) {
      throw new Error('parts[' + index + '].role must be one of ' + ROLES.join('|'));
    }
    part.role = raw.role;
  }
  if ('instrumentHint' in raw) {
    if (typeof raw.instrumentHint !== 'string') {
      throw new Error('parts[' + index + '].instrumentHint must be a string');
    }
    part.instrumentHint = raw.instrumentHint;
  }
  if ('unmapped' in raw) {
    if (!isNonNegInt(raw.unmapped)) {
      throw new Error('parts[' + index + '].unmapped must be a non-negative integer');
    }
    part.unmapped = raw.unmapped;
  }
  return part;
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

// Normalizes an optional sorted-by-tick change list (tempoMap, metreChanges,
// keyChanges). Absent input yields `undefined` (the key is omitted from the
// song entirely, so a song without the field normalizes unchanged). Present
// but malformed input throws -- there is no safe default for "what tempo did
// you mean here", so guessing would be worse than refusing.
function normalizeTickList(raw, name, normalizeFields) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(name + ' must be an array');
  }
  let prevTick;
  return raw.map((entry, i) => {
    const path = name + '[' + i + ']';
    if (!isPlainObject(entry)) {
      throw new Error(path + ' must be an object');
    }
    if (!isNonNegInt(entry.tick)) {
      throw new Error(path + '.tick must be a non-negative integer');
    }
    if (i > 0 && entry.tick < prevTick) {
      throw new Error(name + ' must be sorted by tick');
    }
    prevTick = entry.tick;
    return { tick: entry.tick, ...normalizeFields(entry, path) };
  });
}

function normalizeTempoFields(entry, path) {
  if (!isFiniteNumber(entry.bpm) || entry.bpm <= 0) {
    throw new Error(path + '.bpm must be a positive number');
  }
  return { bpm: entry.bpm };
}

function normalizeMetreFields(entry, path) {
  if (!isInt(entry.num) || entry.num < 1) {
    throw new Error(path + '.num must be a positive integer');
  }
  if (!VALID_DENOMINATORS.includes(entry.den)) {
    throw new Error(path + '.den must be one of ' + VALID_DENOMINATORS.join('|'));
  }
  return { num: entry.num, den: entry.den };
}

function normalizeKeyFields(entry, path) {
  if (!isInt(entry.tonic) || entry.tonic < 0 || entry.tonic > 11) {
    throw new Error(path + '.tonic must be an integer 0-11');
  }
  if (!MODES.includes(entry.mode)) {
    throw new Error(path + '.mode must be "major" or "minor"');
  }
  return { tonic: entry.tonic, mode: entry.mode };
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

  const tempoMap = normalizeTickList(raw.tempoMap, 'tempoMap', normalizeTempoFields);
  const metreChanges = normalizeTickList(raw.metreChanges, 'metreChanges', normalizeMetreFields);
  const keyChanges = normalizeTickList(raw.keyChanges, 'keyChanges', normalizeKeyFields);

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
  if (tempoMap !== undefined) song.tempoMap = tempoMap;
  if (metreChanges !== undefined) song.metreChanges = metreChanges;
  if (keyChanges !== undefined) song.keyChanges = keyChanges;

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

// The metre in force from tick 0, followed by each entry in song.metreChanges
// (already sorted-by-tick and normalized), each carrying its own bar length.
// An entry at tick 0 replaces the opening metre rather than adding a
// zero-length segment. Absent metreChanges this is just [{ tick: 0, ...}].
// A bar length that is zero, negative or NaN would leave `tick` in barsOf's
// loop below unable to advance, growing `boundaries` without bound. A
// validated song can't produce this (validateSong/normalizeSong reject
// num < 1), but barsOf is called directly by bar-heat.js and
// export-musicxml.js with no re-validation, so the guard lives here.
function assertPositiveBarTicks(barTicks) {
  if (!(Number.isFinite(barTicks) && barTicks > 0)) {
    throw new Error('barsOf: a bar must be longer than zero ticks');
  }
  return barTicks;
}

function metreSegmentsOf(song) {
  const segments = [{ tick: 0, barTicks: assertPositiveBarTicks(barTicksOf(song)) }];
  for (const change of song.metreChanges || []) {
    const barTicks = change.num * (4 / change.den) * song.ticksPerQuarter;
    if (change.tick === 0) segments[0] = { tick: 0, barTicks: assertPositiveBarTicks(barTicks) };
    else segments.push({ tick: change.tick, barTicks: assertPositiveBarTicks(barTicks) });
  }
  return segments;
}

// Bar boundaries in ticks, e.g. [0, 1920, 3840]. Always covers at least one
// bar, even for an empty song, so a coach UI always has a bar 1 to show.
// Each entry in song.metreChanges forces a bar boundary at its tick -- the
// bar straddling a change is shortened to end exactly there -- and bars
// after it use that change's own length until the next change (if any).
export function barsOf(song) {
  const duration = songDurationTicks(song);
  const segments = metreSegmentsOf(song);
  const boundaries = [0];
  let tick = 0;
  let segIdx = 0;
  while (tick < duration || boundaries.length === 1) {
    while (segIdx + 1 < segments.length && segments[segIdx + 1].tick <= tick) segIdx++;
    const nextChangeTick = segIdx + 1 < segments.length ? segments[segIdx + 1].tick : Infinity;
    const next = tick + segments[segIdx].barTicks;
    tick = next > nextChangeTick ? nextChangeTick : next;
    boundaries.push(tick);
  }
  return boundaries;
}

// Notes (from every part) whose start falls within bar `barIndex`, each
// tagged with the part id it came from.
export function notesInBar(song, barIndex) {
  if (!isInt(barIndex) || barIndex < 0) {
    throw new Error('barIndex must be a non-negative integer');
  }
  // Same bar windows as barsOf, so a metre change moves them too. Past the
  // last bar there are no notes (barsOf covers the whole song).
  const boundaries = barsOf(song);
  if (barIndex >= boundaries.length - 1) return [];
  const barStart = boundaries[barIndex];
  const barEnd = boundaries[barIndex + 1];
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
  const shiftTonic = tonic => ((tonic + semitones) % 12 + 12) % 12;
  const result = {
    ...song,
    key: song.key ? { tonic: shiftTonic(song.key.tonic), mode: song.key.mode } : null,
    parts: song.parts.map(part => ({
      ...part,
      notes: part.notes.map(note => ({ ...note, midi: clamp(note.midi + semitones, 0, 127) }))
    }))
  };
  if (song.keyChanges) {
    result.keyChanges = song.keyChanges.map(kc => ({ ...kc, tonic: shiftTonic(kc.tonic) }));
  }
  return result;
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
