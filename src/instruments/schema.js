// Instrument record schema + hand-written validator. Zero dependencies on purpose:
// this module is imported by build/build.mjs's bundle target eventually, and by
// plain `node --test` unit tests, so it must run standalone in either place.

export const FAMILIES = ['keys', 'fretted', 'bowed', 'wind', 'brass', 'voice', 'percussion', 'free-reed'];
export const INPUTS = ['mic', 'midi', 'mic+midi', 'tap'];
export const CLEFS = ['treble', 'bass', 'alto', 'tenor', 'grand', 'tab', 'percussion'];
export const OCTAVE_POLICIES = ['exact', 'nearest-octave'];
export const STATUSES = ['ready', 'planned'];

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function isInt(x) {
  return typeof x === 'number' && Number.isFinite(x) && Math.floor(x) === x;
}

function isMidi(x) {
  return isInt(x) && x >= 0 && x <= 127;
}

// Validates one instrument record. Returns { ok: boolean, errors: string[] }.
// Never throws: a malformed record (wrong types, missing fields) is reported
// as errors, not an exception, so a bad data file fails a test rather than
// crashing whatever reads it.
export function validateInstrument(rec) {
  const errors = [];
  const fail = msg => errors.push(msg);

  if (!rec || typeof rec !== 'object') {
    return { ok: false, errors: ['record is not an object'] };
  }

  if (typeof rec.id !== 'string' || !ID_RE.test(rec.id)) {
    fail('id must be a lowercase kebab-case string (got ' + JSON.stringify(rec.id) + ')');
  }

  if (typeof rec.name !== 'string' || rec.name.length === 0) {
    fail('name must be a non-empty string');
  }

  if (typeof rec.family !== 'string' || !FAMILIES.includes(rec.family)) {
    fail('family must be one of ' + FAMILIES.join('|') + ' (got ' + JSON.stringify(rec.family) + ')');
  }

  if (typeof rec.input !== 'string' || !INPUTS.includes(rec.input)) {
    fail('input must be one of ' + INPUTS.join('|') + ' (got ' + JSON.stringify(rec.input) + ')');
  }

  if (!rec.range || typeof rec.range !== 'object') {
    fail('range must be an object { low, high }');
  } else {
    const { low, high } = rec.range;
    if (!isMidi(low)) fail('range.low must be an integer MIDI note 0-127 (got ' + JSON.stringify(low) + ')');
    if (!isMidi(high)) fail('range.high must be an integer MIDI note 0-127 (got ' + JSON.stringify(high) + ')');
    if (isMidi(low) && isMidi(high) && !(low < high)) fail('range.low must be less than range.high');
  }

  if (!isInt(rec.transposition)) {
    fail('transposition must be an integer number of semitones (got ' + JSON.stringify(rec.transposition) + ')');
  }

  if (!Array.isArray(rec.clefs) || rec.clefs.length === 0) {
    fail('clefs must be a non-empty array');
  } else {
    rec.clefs.forEach(c => { if (!CLEFS.includes(c)) fail('unknown clef ' + JSON.stringify(c)); });
  }

  if (typeof rec.octavePolicy !== 'string' || !OCTAVE_POLICIES.includes(rec.octavePolicy)) {
    fail('octavePolicy must be one of ' + OCTAVE_POLICIES.join('|') + ' (got ' + JSON.stringify(rec.octavePolicy) + ')');
  }

  const needsTuning = rec.family === 'fretted' || rec.family === 'bowed';
  if (rec.tuning !== undefined) {
    if (!Array.isArray(rec.tuning) || rec.tuning.length === 0 || !rec.tuning.every(isMidi)) {
      fail('tuning must be a non-empty array of integer MIDI notes');
    } else if (rec.range && isMidi(rec.range.low) && isMidi(rec.range.high)) {
      rec.tuning.forEach(t => {
        if (t < rec.range.low || t > rec.range.high) fail('tuning note ' + t + ' falls outside range');
      });
    }
  } else if (needsTuning) {
    fail('tuning is required for family ' + rec.family);
  }

  if (rec.fretted !== undefined && typeof rec.fretted !== 'boolean') {
    fail('fretted must be a boolean when present');
  }

  // Notation display convention: some instruments (guitar, bass) are printed
  // an octave away from their sounding pitch to avoid a thicket of ledger
  // lines. Absent, a record is written at its sounding pitch.
  if (rec.writtenOctaveUp !== undefined && typeof rec.writtenOctaveUp !== 'boolean') {
    fail('writtenOctaveUp must be a boolean when present');
  }

  // kit: an unpitched percussion record's drawn pieces (src/instruments/drum-kit.js).
  // Each piece's General MIDI notes must sit inside the record's range, and a
  // note may belong to only one piece, so a note heard always names exactly
  // one drum. `key` is the one computer key suggested for playing that piece.
  if (rec.kit !== undefined) {
    if (!Array.isArray(rec.kit) || rec.kit.length === 0) {
      fail('kit must be a non-empty array of pieces when present');
    } else {
      const ids = new Set();
      const keys = new Set();
      const notes = new Map();
      rec.kit.forEach((p, i) => {
        const at = 'kit[' + i + ']';
        if (!p || typeof p !== 'object') { fail(at + ' must be an object { id, name, midi, key }'); return; }
        if (typeof p.id !== 'string' || !ID_RE.test(p.id)) fail(at + '.id must be a lowercase kebab-case string (got ' + JSON.stringify(p.id) + ')');
        else if (ids.has(p.id)) fail(at + '.id ' + JSON.stringify(p.id) + ' is repeated in the kit');
        else ids.add(p.id);
        if (typeof p.name !== 'string' || p.name.length === 0) fail(at + '.name must be a non-empty string');
        if (!Array.isArray(p.midi) || p.midi.length === 0 || !p.midi.every(isMidi)) {
          fail(at + '.midi must be a non-empty array of integer MIDI notes');
        } else {
          p.midi.forEach(n => {
            if (rec.range && isMidi(rec.range.low) && isMidi(rec.range.high) && (n < rec.range.low || n > rec.range.high)) fail(at + ' kit note ' + n + ' falls outside range');
            if (notes.has(n)) fail(at + ' kit note ' + n + ' already belongs to ' + JSON.stringify(notes.get(n)));
            else notes.set(n, p.id);
          });
        }
        if (typeof p.key !== 'string' || !/^[a-z]$/.test(p.key)) fail(at + '.key must be one lowercase letter (got ' + JSON.stringify(p.key) + ')');
        else if (keys.has(p.key)) fail(at + '.key ' + JSON.stringify(p.key) + ' is repeated in the kit');
        else keys.add(p.key);
      });
    }
  }

  if (typeof rec.status !== 'string' || !STATUSES.includes(rec.status)) {
    fail('status must be one of ' + STATUSES.join('|') + ' (got ' + JSON.stringify(rec.status) + ')');
  }

  if (!Array.isArray(rec.curriculum)) {
    fail('curriculum must be an array (use [] when not written yet)');
  } else {
    if (rec.curriculum.length === 0) {
      if (rec.status === 'ready') fail('status "ready" requires a non-empty curriculum');
    } else {
      if (rec.status !== 'ready') fail('a non-empty curriculum requires status "ready"');
      let prevLevel = 0;
      rec.curriculum.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') { fail('curriculum[' + i + '] must be an object'); return; }
        if (!isInt(entry.level) || entry.level < 1) fail('curriculum[' + i + '].level must be a positive integer');
        else if (entry.level <= prevLevel) fail('curriculum[' + i + '].level must increase (' + entry.level + ' after ' + prevLevel + ')');
        else prevLevel = entry.level;
        if (!Array.isArray(entry.items) || entry.items.length === 0 || !entry.items.every(x => typeof x === 'string' && x.length > 0)) {
          fail('curriculum[' + i + '].items must be a non-empty array of strings');
        }
      });
    }
  }

  // provenance: who (if anyone) has checked this record's curriculum against
  // a real method book or teaching standard. Absent or null means
  // provisional -- written by the app's authors, not yet reviewed by a
  // musician. When present it must be an object with a non-empty `reference`
  // (a method-book/standard name, not a URL) plus reviewedBy/reviewedAt that
  // are either both null (reference noted, review still pending) or both
  // filled in (a real review happened, on a real date).
  if (rec.provenance !== undefined && rec.provenance !== null) {
    const p = rec.provenance;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      fail('provenance must be null or an object { reference, reviewedBy, reviewedAt }');
    } else {
      if (typeof p.reference !== 'string' || p.reference.length === 0) fail('provenance.reference must be a non-empty string naming a method book or standard');
      const byPresent = typeof p.reviewedBy === 'string' && p.reviewedBy.length > 0;
      const atPresent = typeof p.reviewedAt === 'string' && p.reviewedAt.length > 0;
      if (p.reviewedBy !== null && !byPresent) fail('provenance.reviewedBy must be a non-empty string or null');
      if (p.reviewedAt !== null && !atPresent) fail('provenance.reviewedAt must be a non-empty string or null');
      if (byPresent !== atPresent) fail('provenance.reviewedBy and provenance.reviewedAt must both be set or both be null');
      if (atPresent && !/^\d{4}-\d{2}-\d{2}$/.test(p.reviewedAt)) fail('provenance.reviewedAt must be a YYYY-MM-DD date string');
    }
  }

  return { ok: errors.length === 0, errors };
}
