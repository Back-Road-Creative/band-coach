// The 15 major and 15 minor key signatures, computed from the circle of fifths
// (never typed as a table). Wiring note: build the key picker off `ALL_KEYS`
// (`name` + a `{tonic, mode}` pair matching the Song shape); pass `name` into
// spell.js's `spellMidi`/`keyAccidentals` to render notation.

import { keyAccidentals } from '../../notation/spell.js';
import { LETTERS, LETTER_PC, mod12, mod7, centeredDiff, accidentalForDiff } from './pitch.js';

// A perfect fifth up is +7 semitones and +4 letters (C -> G is C,D,E,F,G).
const FIFTH_UP_LETTER_STEP = 4;

function majorKeyAtSharps(n) {
  const letterIndex = mod7(FIFTH_UP_LETTER_STEP * n);
  const letter = LETTERS[letterIndex];
  const tonic = mod12(7 * n);
  const accidental = accidentalForDiff(centeredDiff(tonic, LETTER_PC[letter]));
  return { letter, accidental, tonic, letterIndex };
}

function majorKeyAtFlats(n) {
  // A fifth down is the same as three letters up (C -> F is C,D,E,F).
  const letterIndex = mod7(3 * n);
  const letter = LETTERS[letterIndex];
  const tonic = mod12(-7 * n);
  const accidental = accidentalForDiff(centeredDiff(tonic, LETTER_PC[letter]));
  return { letter, accidental, tonic, letterIndex };
}

// The relative minor sits a minor third (3 semitones, 2 letters) below its
// major's tonic.
function relativeMinorOf(major) {
  const letterIndex = mod7(major.letterIndex - 2);
  const letter = LETTERS[letterIndex];
  const tonic = mod12(major.tonic - 3);
  const accidental = accidentalForDiff(centeredDiff(tonic, LETTER_PC[letter]));
  return { letter, accidental, tonic, letterIndex };
}

function keyName(spelling, mode) {
  return spelling.letter + spelling.accidental + (mode === 'minor' ? 'm' : '');
}

function makeKey(sharps, flats, mode) {
  const majorSpelling = sharps > 0 ? majorKeyAtSharps(sharps) : majorKeyAtFlats(flats);
  const spelling = mode === 'major' ? majorSpelling : relativeMinorOf(majorSpelling);
  const signature = sharps > 0
    ? { count: sharps, type: 'sharp' }
    : flats > 0
      ? { count: flats, type: 'flat' }
      : { count: 0, type: 'none' };
  return {
    name: keyName(spelling, mode),
    letter: spelling.letter,
    accidental: spelling.accidental,
    tonic: spelling.tonic,
    mode,
    signature,
  };
}

function buildAll(mode) {
  const keys = [makeKey(0, 0, mode)];
  for (let n = 1; n <= 7; n++) keys.push(makeKey(n, 0, mode));
  for (let n = 1; n <= 7; n++) keys.push(makeKey(0, n, mode));
  return keys;
}

export const MAJOR_KEYS = buildAll('major');
export const MINOR_KEYS = buildAll('minor');
export const ALL_KEYS = MAJOR_KEYS.concat(MINOR_KEYS);

export function findKey(name) {
  const found = ALL_KEYS.find(k => k.name === name);
  if (!found) throw new Error('not one of the 15 major / 15 minor keys: ' + JSON.stringify(name));
  return found;
}
export function keyByTonicMode(tonic, mode) {
  const found = ALL_KEYS.find(k => k.tonic === mod12(tonic) && k.mode === mode);
  if (!found) throw new Error('no key at tonic pitch class ' + tonic + ' mode ' + mode);
  return found;
}

// Accepts a key object, its display name, or a Song-shape { tonic, mode } pair.
function resolveKey(key) {
  if (key && typeof key === 'object' && 'signature' in key) return key;
  if (typeof key === 'string') return findKey(key);
  if (key && typeof key === 'object') return keyByTonicMode(key.tonic, key.mode);
  throw new Error('not a recognisable key: ' + JSON.stringify(key));
}

// Delegates to spell.js's own accidental list instead of a second copy of it.
export function signatureFor(key) {
  const resolved = resolveKey(key);
  const accidentals = keyAccidentals(resolved.name);
  if (accidentals.length === 0) return { count: 0, type: 'none' };
  return { count: accidentals.length, type: accidentals[0].accidental === '#' ? 'sharp' : 'flat' };
}

// `signature` is { count, type: 'sharp'|'flat'|'none' }.
export function keyFromSignature(signature, mode) {
  const { count, type } = signature;
  if (count === 0) return keys(mode)[0];
  const sharps = type === 'sharp' ? count : 0;
  const flats = type === 'flat' ? count : 0;
  if (count < 0 || count > 7) throw new Error('signature count must be 0..7, got ' + count);
  return makeKey(sharps, flats, mode);
}

function keys(mode) {
  return mode === 'major' ? MAJOR_KEYS : MINOR_KEYS;
}

export function relativeKey(key) {
  const resolved = resolveKey(key);
  const otherMode = resolved.mode === 'major' ? 'minor' : 'major';
  return keyFromSignature(resolved.signature, otherMode);
}

export function parallelKey(key) {
  const resolved = resolveKey(key);
  const otherMode = resolved.mode === 'major' ? 'minor' : 'major';
  return keyByTonicMode(resolved.tonic, otherMode);
}

// One step around the circle of fifths in either direction, same mode.
export function neighbours(key) {
  const resolved = resolveKey(key);
  const { count, type } = resolved.signature;
  const step = (dir) => {
    // dir=+1 is a fifth up (one more sharp / one fewer flat), dir=-1 the reverse.
    let sharps = type === 'sharp' ? count : type === 'none' ? 0 : -count;
    sharps += dir;
    if (sharps > 7 || sharps < -7) return null; // past the 15-key range (double accidentals)
    const signature = sharps === 0 ? { count: 0, type: 'none' } : sharps > 0
      ? { count: sharps, type: 'sharp' }
      : { count: -sharps, type: 'flat' };
    return keyFromSignature(signature, resolved.mode);
  };
  return { up: step(1), down: step(-1) };
}
