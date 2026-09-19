// Bridges an instrument record (src/instruments/*.js) and a target MIDI
// note into the inputs the pure notation engine (layout.js, tab.js) needs:
// which clef to draw on, the written (possibly display-shifted) pitch, its
// spelling in a given key, and — for a fretted instrument — a tab position.
import { spellMidi } from './spell.js';
import { layoutMeasure } from './layout.js';
import { layoutTab } from './tab.js';

const DEFAULT_KEY = 'C';
const DEFAULT_WIDTH = 260;

function clefFor(rec) {
  return rec.clefs.indexOf('grand') >= 0 ? 'grand' : rec.clefs[0];
}

// Guitar and bass print an octave above their sounding pitch (writtenOctaveUp
// on the record); every other instrument is written at its sounding pitch.
function writtenMidi(rec, midi) {
  return rec.writtenOctaveUp ? midi + 12 : midi;
}

function tabFor(rec, midi, item) {
  if (!rec.fretted || !rec.tuning) return null;
  if (item && item.string !== undefined && item.fret !== undefined) {
    return { primitives: [{ type: 'fretNumber', string: item.string, fret: item.fret, x: 10 }] };
  }
  return layoutTab({ tuning: rec.tuning, notes: [{ midi, dur: 4 }] });
}

// instrument record + sounding MIDI + { key, width, item } -> a one-note
// layoutMeasure() result on the right clef, its spelling, and (for a fretted
// instrument) a tab position. `item` is the exercise item (e.info), used to
// read an explicit string/fret when one was assigned rather than re-deriving
// one from the tuning.
export function forInstrument(rec, midi, opts = {}) {
  if (rec == null || midi === null || midi === undefined) return null;
  const key = opts.key || DEFAULT_KEY;
  const clef = clefFor(rec);
  const written = writtenMidi(rec, midi);
  const { primitives } = layoutMeasure({
    clef, key, time: [4, 4], width: opts.width || DEFAULT_WIDTH,
    notes: [{ midi: written, dur: 4 }],
  });
  const spelled = spellMidi(written, key);
  const tab = tabFor(rec, midi, opts.item);

  return { clef, midi, written, spelled, primitives, tab };
}
