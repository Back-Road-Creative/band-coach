// "How to play it" — pure logic that picks, for one instrument record and
// one written MIDI pitch, which of src/instruments/how/*.js applies and
// builds both the data a diagram needs AND a plain-English, screen-reader
// ready description of it. Zero DOM; unit tested directly.
//
// Wiring pass (src/ui/fingerings.js): call `howKindFor(instrument)` to know
// whether an instrument can be shown at all (only instruments with tuning,
// a mapped brass preset, the free-reed family, the descant recorder, the
// tin whistle, the voice family, or a drum `kit` qualify), then
// `computeHow(instrument, midi, opts)` for the note the learner picked. `opts.key` (0-11) picks the
// harmonica's key; `opts.maxFret` caps how many frets/positions a
// fretboard or fingerboard diagram shows. `opts.leftHanded` mirrors a
// fretboard or fingerboard diagram; `opts.capo` and `opts.tuning` (one of
// fretboard.js's named TUNINGS keys, see `alternateTuningsFor` below) apply
// only to a 'fretboard' kind and are ignored for 'fingerboard' (fretless
// instruments have neither).
//
// A stringed instrument's diagram kind is driven by the record's own
// `fretted` field (schema.js), never by a hard-coded id list: `fretted:
// false` (violin, viola, cello, double bass) gets 'fingerboard' — position
// data with no fret wires — everything else with a `tuning` gets
// 'fretboard'.

import { fingeringsForValves, fingeringsForSlide, PRESETS as BRASS_PRESETS } from '../../instruments/how/brass.js';
import { positionsFor, tuningFor } from '../../instruments/how/fretboard.js';
import { holesFor } from '../../instruments/how/harmonica.js';
import { fingeringFor } from '../../instruments/how/recorder-whistle.js';
import { keyedFingeringFor } from '../../instruments/how/keyed-woodwind.js';
import { kitLayout, describeHit } from '../../instruments/how/drum-kit.js';
import { pieceForMidi, canonicalMidi } from '../../instruments/drum-kit.js';
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

// Which src/instruments/how/keyed-woodwind.js chart a keyed Boehm-system
// woodwind record uses (see that file's top comment for the low-confidence
// caveat on every entry -- a good-faith beginner fingering, not verified
// against a real chart or player).
const KEYED_WOODWIND_CHART_BY_ID = {
  flute: 'flute',
  'clarinet-bb': 'clarinet',
  oboe: 'oboe',
  'sax-alto-eb': 'sax',
  'sax-tenor-bb': 'sax'
};

// Which named alternate tunings (fretboard.js's TUNINGS) apply to a fretted
// instrument, keyed by instrument id — explicit, never guessed from string
// count: a 4-string tuning is not interchangeable between unrelated
// instruments (standard ukulele and bass are both 4 strings but nothing
// alike), and every named alternate in fretboard.js besides the ukulele/bass
// ones is a variant of the SAME 6-string guitar (gtr.js). 'standard' is
// listed first so it always appears as the no-op / "back to normal" choice.
const ALT_TUNINGS_BY_ID = {
  gtr: ['standard', 'drop-d', 'dadgad', 'open-g', 'open-d', 'half-step-down']
};

// The list of named tuning keys (fretboard.js's tuningFor) a learner can
// pick for this instrument, or null when none is defined — most fretted
// instruments in this app have only their one real-world tuning.
export function alternateTuningsFor(instrument) {
  return (instrument && ALT_TUNINGS_BY_ID[instrument.id]) || null;
}

export function howKindFor(instrument) {
  if (!instrument) return null;
  // A drum `kit` (schema.js) is drawn as the kit itself, whatever the family.
  if (Array.isArray(instrument.kit)) return 'drum-kit';
  if (Array.isArray(instrument.tuning) && instrument.tuning.length > 0) {
    return instrument.fretted === false ? 'fingerboard' : 'fretboard';
  }
  if (instrument.family === 'brass' && BRASS_BY_ID[instrument.id]) {
    return BRASS_BY_ID[instrument.id].style === 'slide' ? 'brass-slide' : 'brass-valves';
  }
  if (instrument.family === 'free-reed') return 'harmonica';
  if (instrument.id === 'recorder-descant') return 'recorder';
  if (instrument.id === 'tin-whistle') return 'whistle';
  if (KEYED_WOODWIND_CHART_BY_ID[instrument.id]) return 'keyed-woodwind';
  if (instrument.family === 'voice') return 'voice';
  return null;
}

// `tuning` and `capo` are the EFFECTIVE ones (an alternate tuning if the
// learner picked one, else the instrument's own) — string labels and "open"
// pitches must follow what the learner actually chose, not the instrument's
// factory tuning. A capo shifts every open string up and becomes the new
// nut (fretboard.js's own rule), so a pitch below every capo'd open string
// physically cannot be played there; that is told plainly rather than
// folded into the generic "doesn't fall on this fretboard" wording.
function describeFretboard(midi, positions, tuning, capo) {
  const name = noteName(midi);
  if (positions.length === 0) {
    if (capo > 0 && midi < Math.min(...tuning) + capo) {
      return name + ' is below the capo (fret ' + capo + ') — no open string can reach it with the capo there.';
    }
    return name + ' does not fall on this fretboard within the frets shown.';
  }
  const parts = positions.map(p => {
    const openName = noteName(tuning[p.stringIndex] + capo);
    const where = p.fret === 0 ? 'open' : 'fret ' + p.fret;
    return 'string ' + (p.stringIndex + 1) + ' (' + openName + '), ' + where;
  });
  const capoNote = capo > 0 ? ' (frets counted from the capo at fret ' + capo + ')' : '';
  return name + ': ' + parts.join('; or ') + '.' + capoNote;
}

// Fretless: same string/semitone-offset data as a fretted diagram (the
// physical string doesn't care whether the neck has frets), worded as hand
// position instead of a fret number, since there is nothing to fret. No
// capo (bowed instruments this app models don't have one).
function describeFingerboard(midi, positions, tuning) {
  const name = noteName(midi);
  if (positions.length === 0) {
    return name + ' does not fall within reach of an open string on this fingerboard.';
  }
  const parts = positions.map(p => {
    const openName = noteName(tuning[p.stringIndex]);
    const where = p.fret === 0
      ? 'open string'
      : p.fret + ' semitone' + (p.fret > 1 ? 's' : '') + ' up (no frets — find it by ear or hand position)';
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

function describeKeyedWoodwind(midi, entry) {
  const name = noteName(midi);
  if (!entry) return name + ' has no fingering shown: this pitch is outside the beginner fingering chart for this instrument.';
  let text = name + ': ' + entry.keys + '.';
  if (entry.halfHole) text += ' Uses the half-hole technique.';
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

  // Drum kit: the note is a General MIDI percussion note naming a piece,
  // not a pitch. A note that is not on this kit highlights nothing.
  if (kind === 'drum-kit') {
    const piece = pieceForMidi(midi);
    return {
      kind, piece, layout: kitLayout(),
      playable: !!piece,
      description: piece ? describeHit(piece) : 'MIDI drum note ' + midi + ' is not one of the drums on this kit.'
    };
  }

  if (kind === 'fretboard' || kind === 'fingerboard') {
    const maxFret = opts.maxFret ?? 15;
    const leftHanded = !!opts.leftHanded;
    // Capo and named alternate tunings are a fretted-guitar-family concept;
    // a fingerboard (bowed, fretless) instrument has neither, so those opts
    // are silently ignored rather than producing an invalid diagram.
    const capo = kind === 'fretboard' ? (opts.capo || 0) : 0;
    const tuning = (kind === 'fretboard' && opts.tuning) ? tuningFor(opts.tuning) : instrument.tuning;
    const positions = positionsFor(midi, tuning, { maxFret, capo, leftHanded });
    return {
      kind, tuning, positions, maxFret, capo, leftHanded,
      playable: positions.length > 0,
      description: kind === 'fretboard'
        ? describeFretboard(midi, positions, tuning, capo)
        : describeFingerboard(midi, positions, tuning)
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

  if (kind === 'recorder' || kind === 'whistle') {
    const entry = fingeringFor(midi, kind);
    return {
      kind, instrumentKind: kind, entry,
      playable: !!entry,
      description: describeRecorderLike(midi, entry, kind)
    };
  }

  if (kind === 'keyed-woodwind') {
    const chart = KEYED_WOODWIND_CHART_BY_ID[instrument.id];
    const entry = keyedFingeringFor(midi, chart);
    return {
      kind, chart, entry,
      playable: !!entry,
      description: describeKeyedWoodwind(midi, entry)
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
  if (howKindFor(instrument) === 'drum-kit') return canonicalMidi('snare') ?? instrument.range.low;
  const { low, high } = instrument.range;
  for (let m = low; m <= high; m++) {
    const how = computeHow(instrument, m, opts);
    if (how && how.playable) return m;
  }
  return low;
}
