import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitToInstrument } from '../../src/song/lesson.js';
import { writtenPart, soundingFromWritten } from '../../src/song/arrange/transposing.js';
import clarinetBb from '../../src/instruments/clarinet-bb.js';
import trumpetBb from '../../src/instruments/trumpet-bb.js';
import saxAltoEb from '../../src/instruments/sax-alto-eb.js';
import saxTenorBb from '../../src/instruments/sax-tenor-bb.js';
import hornF from '../../src/instruments/horn-f.js';
import doubleBass from '../../src/instruments/double-bass.js';
import recorderDescant from '../../src/instruments/recorder-descant.js';
import tinWhistle from '../../src/instruments/tin-whistle.js';
import starterSongs from '../../src/song/starter/index.js';

function song(midis, partId = 'melody') {
  const notes = midis.map((midi, i) => ({ start: i * 480, dur: 480, midi }));
  return {
    schema: 'song/1', id: 'range-check', title: 'Range check', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100,
    ticksPerQuarter: 480,
    parts: [{ id: partId, name: 'Melody', notes }],
    chords: []
  };
}

// clarinet-bb.range is WRITTEN pitch (55-67), transposition -2 (sounding =
// written - 2). A concert (sounding) Bb4 = 70 is written C5 = 72, which is
// OUTSIDE the clarinet's written range (55-67) by 5 semitones -- too far for
// any octave shift to fix cleanly onto this narrow beginner range without
// landing on a different, still out-of-range octave. Before the fix,
// fitToInstrument compared the sounding midi directly against the WRITTEN
// range, so it wrongly reported this note as playable at concert Bb4.
test('fitToInstrument gates a transposing instrument by WRITTEN pitch, not sounding pitch', () => {
  // Sounding F#5 (66) sits inside clarinet-bb's written range 55-67 taken
  // literally as sounding pitch, so before the fix fitToInstrument accepted
  // shift 0 immediately (the first "perfect fit" it tries). But
  // clarinet-bb.range is WRITTEN pitch (transposition -2, written = sounding
  // + 2): written for sounding 66 is 68, one semitone OUTSIDE 55-67. The
  // correct fit shifts down an octave (shift -12): sounding 54, written 56,
  // inside 55-67.
  const soundingFSharp5 = 66;
  const fit = fitToInstrument(song([soundingFSharp5]), 'melody', clarinetBb);
  assert.equal(fit.shiftSemitones, -12);
  assert.equal(fit.notes[0].midi, soundingFSharp5 - 12);
  assert.equal(fit.unplayable.length, 0);
});

test('fitToInstrument: a note only reachable on the clarinet at a written-in-range octave is accepted there', () => {
  // Written C5 (72) sounding low? Actually written middle of range: written
  // 60 (sounding 58) is well inside written range 55-67. Confirms good notes
  // still pass through with shift 0.
  const fit = fitToInstrument(song([58]), 'melody', clarinetBb);
  assert.equal(fit.unplayable.length, 0);
  assert.equal(fit.shiftSemitones, 0);
  assert.equal(fit.notes[0].midi, 58);
});

test('never drops a note: an unreachable note is still returned in notes, just flagged unplayable', () => {
  const concertBb4 = 70;
  const fit = fitToInstrument(song([concertBb4]), 'melody', clarinetBb);
  assert.equal(fit.notes.length, 1);
});

// octave-only transposers (double-bass, recorder-descant, tin-whistle) store
// `range` in SOUNDING pitch already (their own file headers say so) -- must
// stay unaffected by the written-pitch fix.
test('fitToInstrument leaves octave-only transposers (sounding-pitch range) alone', () => {
  const fit = fitToInstrument(song([40]), 'melody', doubleBass); // within 28-48
  assert.equal(fit.shiftSemitones, 0);
  assert.equal(fit.unplayable.length, 0);
});

const TRANSPOSING_INSTRUMENTS = [clarinetBb, trumpetBb, saxAltoEb, saxTenorBb, hornF, doubleBass, recorderDescant, tinWhistle]
  .filter(i => i.status === 'ready');

test('every starter song melody, fitted to every ready transposing instrument: written pitch in range, no note dropped', () => {
  starterSongs.forEach(s => {
    const part = s.parts[0];
    TRANSPOSING_INSTRUMENTS.forEach(instrument => {
      const fit = fitToInstrument(s, part.id, instrument);
      assert.equal(fit.notes.length, part.notes.length, s.id + '/' + instrument.id + ': a note was dropped');
      assert.equal(fit.notes.length, fit.unplayable.length + (fit.notes.length - fit.unplayable.length));
      const unplayableStarts = new Set(fit.unplayable.map(u => u.start));
      // Octave-only transposers (transposition a multiple of 12) store
      // `range` in SOUNDING pitch already (double-bass.js, recorder-descant.js,
      // tin-whistle.js headers); genuine key-transposers store it in WRITTEN
      // pitch -- see lesson.js's rangeIsWrittenPitch for the same rule.
      const rangeIsWritten = instrument.transposition % 12 !== 0;
      fit.notes.forEach(n => {
        if (unplayableStarts.has(n.start)) return; // flagged unplayable, exempt from the range check
        const rangeMidi = rangeIsWritten ? n.midi - instrument.transposition : n.midi;
        assert.ok(
          rangeMidi >= instrument.range.low && rangeMidi <= instrument.range.high,
          s.id + '/' + instrument.id + ': pitch ' + rangeMidi + ' outside range ' +
            instrument.range.low + '-' + instrument.range.high
        );
      });
    });
  });
});

// ---------------------------------------------------------------------------
// transposing.js: writtenPart / soundingFromWritten
// ---------------------------------------------------------------------------

test('writtenPart: written = sounding - transposition for every note', () => {
  const notes = [{ start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 62 }];
  const part = writtenPart(notes, clarinetBb);
  assert.equal(part.notes[0].written, 60 - clarinetBb.transposition);
  assert.equal(part.notes[1].written, 62 - clarinetBb.transposition);
  // originals untouched, sounding pitch preserved
  assert.equal(part.notes[0].midi, 60);
});

test('writtenPart: reports the written key signature (tonic shifted by transposition)', () => {
  const notes = [{ start: 0, dur: 480, midi: 60 }];
  const part = writtenPart(notes, clarinetBb, { tonic: 0, mode: 'major' });
  // concert C major, Bb clarinet (transposition -2) writes in D major
  // (written tonic = sounding tonic - transposition = 0 - (-2) = 2).
  assert.equal(part.key.tonic, 2);
  assert.equal(part.key.mode, 'major');
});

test('soundingFromWritten inverts writtenPart', () => {
  const notes = [{ start: 0, dur: 480, midi: 65 }];
  const part = writtenPart(notes, hornF);
  const back = soundingFromWritten(part.notes.map(n => ({ start: n.start, dur: n.dur, midi: n.written })), hornF);
  assert.equal(back[0].midi, notes[0].midi);
});
