// "How to play it" — pure logic that picks, for one instrument record and
// one written MIDI pitch, which of src/instruments/how/*.js applies and
// builds both the data a diagram needs AND a plain-English, screen-reader
// ready description of it. Zero DOM; unit tested directly.
//
// Wiring pass (src/ui/fingerings.js): call `howKindFor(instrument)` to know
// whether an instrument can be shown at all (only instruments with tuning,
// a mapped brass preset, the free-reed family, the descant recorder, or the
// voice family qualify), then `computeHow(instrument, midi, opts)` for the
// note the learner picked. `opts.key` (0-11) picks the harmonica's key;
// `opts.maxFret` caps how many frets a fretboard diagram shows.

import { fingeringsForValves, fingeringsForSlide, PRESETS as BRASS_PRESETS } from '../../instruments/how/brass.js';
import { positionsFor } from '../../instruments/how/fretboard.js';
import { holesFor } from '../../instruments/how/harmonica.js';
import { fingeringFor } from '../../instruments/how/recorder-whistle.js';
import { noteName } from './notes.js';

// Which brass preset (src/instruments/how/brass.js's PRESETS) an instrument
// record uses, and whether it is valved or slide-based. Only instruments
// this app actually has a record for; euphonium/tuba presets exist in
// brass.js but nothing in src/instruments/*.js models them yet.
const BRASS_BY_ID = {
  'trumpet-bb': { preset: 'trumpet-cornet', style: 'valves' },
  'horn-f': { preset: 'horn-f-basics', style: 'valves' },
  trombone: { preset: 'trombone', style: 'slide' }
};

export function howKindFor(instrument) {
  if (!instrument) return null;
  if (Array.isArray(instrument.tuning) && instrument.tuning.length > 0) return 'fretboard';
  if (instrument.family === 'brass' && BRASS_BY_ID[instrument.id]) {
    return BRASS_BY_ID[instrument.id].style === 'slide' ? 'brass-slide' : 'brass-valves';
  }
  if (instrument.family === 'free-reed') return 'harmonica';
  if (instrument.id === 'recorder-descant') return 'recorder';
  if (instrument.family === 'voice') return 'voice';
  return null;
}

function describeFretboard(instrument, midi, positions) {
  const name = noteName(midi);
  if (positions.length === 0) {
    return name + ' does not fall on this fretboard within the frets shown.';
  }
  const parts = positions.map(p => {
    const openName = noteName(instrument.tuning[p.stringIndex]);
    const where = p.fret === 0 ? 'open' : 'fret ' + p.fret;
    return 'string ' + (p.stringIndex + 1) + ' (' + openName + '), ' + where;
  });
  return name + ': ' + parts.join('; or ') + '.';
}

function describeBrassValves(midi, result) {
  const name = noteName(midi);
  if (!result.standard) return name + " doesn't fit this instrument's harmonic series in this chart.";
  const s = result.standard;
  const valveWord = s.label === 'open' ? 'open, no valves' : (s.label.split('-').length > 1 ? 'valves ' : 'valve ') + s.label;
  let text = name + ': ' + valveWord + ' (partial ' + s.partial + ' of the harmonic series).';
  if (s.sharp) text += ' This fingering tends to run sharp; lip it down.';
  if (s.needsCheck) text += ' This uses a high, unreliable partial — check the pitch by ear.';
  if (result.alternates.length) text += ' Alternate: ' + result.alternates.map(a => a.label).join(', ') + '.';
  return text;
}

function describeBrassSlide(midi, result) {
  const name = noteName(midi);
  if (!result.standard) return name + " doesn't fit this instrument's harmonic series in this chart.";
  const s = result.standard;
  let text = name + ': slide position ' + s.position + ' (partial ' + s.partial + ' of the harmonic series).';
  if (s.needsCheck) text += ' This uses a high, unreliable partial — check the pitch by ear.';
  if (result.alternates.length) text += ' Alternate position' + (result.alternates.length > 1 ? 's' : '') + ': ' + result.alternates.map(a => a.label).join(', ') + '.';
  return text;
}

function describeHarmonica(midi, options) {
  const name = noteName(midi);
  if (options.length === 0) return name + ' is not reachable on this harmonica.';
  const wordFor = o => 'hole ' + o.hole + ' ' + o.action + (o.semitonesBent > 0 ? ', bent ' + o.semitonesBent + ' semitone' + (o.semitonesBent > 1 ? 's' : '') + ' (' + o.difficulty.replace('-', ' ') + ')' : '');
  let text = name + ': ' + wordFor(options[0]) + '.';
  if (options.length > 1) text += ' Also possible: ' + options.slice(1).map(wordFor).join('; ') + '.';
  return text;
}

// `instrumentKind` is 'recorder' or 'whistle' — only 'recorder' has a thumb
// hole (index 0 of its pattern); the whistle's six holes are all fingers.
function describeRecorderLike(midi, entry, instrumentKind) {
  const name = noteName(midi);
  if (!entry) return name + " is outside this app's " + instrumentKind + ' fingering chart.';
  const hasThumb = instrumentKind === 'recorder';
  const words = entry.holes.split('').map((c, i) => {
    const label = hasThumb ? (i === 0 ? 'thumb hole' : 'hole ' + i) : 'hole ' + (i + 1);
    const state = c === 'x' ? 'covered' : c === 'h' ? 'half-covered' : 'open';
    return label + ' ' + state;
  });
  let text = name + ': ' + words.join(', ') + '.';
  if (entry.overblow) text += ' Overblow this fingering (blow harder) for the upper octave.';
  return text;
}

function describeVoice(instrument, midi) {
  const name = noteName(midi);
  const inRange = midi >= instrument.range.low && midi <= instrument.range.high;
  return name + ': no fingering — just sing this pitch. It is ' + (inRange ? 'within' : 'outside') + " the range shown; if it's uncomfortable, try the nearest octave that feels easy.";
}

// Everything the fingerings panel needs to draw one note on one instrument,
// or null when this instrument has no "how" module.
export function computeHow(instrument, midi, opts = {}) {
  const kind = howKindFor(instrument);
  if (!kind) return null;

  if (kind === 'fretboard') {
    const maxFret = opts.maxFret ?? 15;
    const positions = positionsFor(midi, instrument.tuning, { maxFret });
    return {
      kind, tuning: instrument.tuning, positions, maxFret,
      playable: positions.length > 0,
      description: describeFretboard(instrument, midi, positions)
    };
  }

  if (kind === 'brass-valves' || kind === 'brass-slide') {
    const preset = BRASS_PRESETS[BRASS_BY_ID[instrument.id].preset];
    const result = kind === 'brass-valves' ? fingeringsForValves(midi, preset) : fingeringsForSlide(midi, preset);
    return {
      kind, result, hasFourthValve: !!preset.hasFourthValve,
      playable: !!result.standard,
      description: kind === 'brass-valves' ? describeBrassValves(midi, result) : describeBrassSlide(midi, result)
    };
  }

  if (kind === 'harmonica') {
    const key = Number.isInteger(opts.key) ? opts.key : 0;
    const options = holesFor(midi, key);
    return {
      kind, key, options,
      playable: options.length > 0,
      description: describeHarmonica(midi, options)
    };
  }

  if (kind === 'recorder') {
    const instrumentKind = opts.whistle ? 'whistle' : 'recorder';
    const entry = fingeringFor(midi, instrumentKind);
    return {
      kind, instrumentKind, entry,
      playable: !!entry,
      description: describeRecorderLike(midi, entry, instrumentKind)
    };
  }

  // voice
  return {
    kind, range: instrument.range,
    playable: midi >= instrument.range.low && midi <= instrument.range.high,
    description: describeVoice(instrument, midi)
  };
}

// The first note at or above `instrument.range.low` (falling back to
// range.low itself) that computeHow can actually find a fingering for — a
// sane default selection when a panel first opens on an instrument, since
// range.low is not always in a typed table (e.g. the descant recorder's
// beginner range starts below its short fingering table).
export function defaultNoteFor(instrument, opts = {}) {
  const { low, high } = instrument.range;
  for (let m = low; m <= high; m++) {
    const how = computeHow(instrument, m, opts);
    if (how && how.playable) return m;
  }
  return low;
}
