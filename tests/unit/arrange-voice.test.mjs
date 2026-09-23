// Plan §11.7 Wave D6: move a song into the key that fits the SINGER's own
// measured comfortable range, not the fixed range of a physical instrument
// (that shift lives in src/song/lesson.js's fitToInstrument -- see #99).
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyForVoice, arrangeVoice } from '../../src/song/arrange/voice.js';
import { exerciseRangeFor } from '../../src/instruments/how/voice-range.js';
import { starterSongs } from '../../src/song/starter/index.js';

// Typical alto/bass comfortable ranges, matching voice-range.js's own
// VOICE_TYPES table (widest starter-song ambitus is 14 semitones, well
// inside either range's margin-adjusted span).
const ALTO_RANGE = { low: 53, high: 77 };
const BASS_RANGE = { low: 40, high: 64 };

function partNotes(song) {
  return song.parts.find(p => p.id === 'melody').notes;
}

for (const [label, range] of [['alto', ALTO_RANGE], ['bass', BASS_RANGE]]) {
  test(`every starter song fits a typical ${label} range with no dropped or out-of-range note`, () => {
    for (const song of starterSongs) {
      const notes = partNotes(song);
      const ranked = keyForVoice(notes, range);
      const best = ranked[0];
      assert.equal(best.outOfRange.length, 0, `${song.id}: expected a perfect fit for ${label}, got ${JSON.stringify(best.outOfRange)}`);
      assert.equal(best.fits, true, `${song.id} should fit the ${label} range`);

      const arranged = arrangeVoice(notes, range);
      assert.equal(arranged.notes.length, notes.length, `${song.id}: no note may be dropped`);
      arranged.notes.forEach((n, i) => assert.equal(n.midi - notes[i].midi, arranged.shiftSemitones, `${song.id}: every note shifts by the same amount`));

      const fitRange = exerciseRangeFor(range);
      for (const n of arranged.notes) {
        assert.ok(n.midi >= fitRange.low && n.midi <= fitRange.high, `${song.id}: note ${n.midi} outside ${label} margin range ${fitRange.low}-${fitRange.high}`);
      }
    }
  });
}

test('a song wider than the singer\'s range reports its out-of-range notes instead of dropping them', () => {
  const notes = [
    { start: 0, dur: 480, midi: 40 },
    { start: 480, dur: 480, midi: 90 }
  ];
  const range = { low: 50, high: 65 }; // margin-adjusted width (9) far smaller than the 50-semitone ambitus above

  const ranked = keyForVoice(notes, range);
  const best = ranked[0];
  assert.equal(best.fits, false);
  assert.ok(best.outOfRange.length > 0, 'the impossible-to-fit song must report at least one out-of-range note');

  const arranged = arrangeVoice(notes, range);
  assert.equal(arranged.notes.length, 2, 'no note may ever be dropped, even an unplayable one');
});

test('the chosen shift centres the tessitura within 2 semitones of the range centre where the range allows', () => {
  const notes = [
    { start: 0, dur: 100, midi: 60 },
    { start: 100, dur: 100, midi: 70 }
  ];
  const range = ALTO_RANGE;
  const fitRange = exerciseRangeFor(range);
  const centre = (fitRange.low + fitRange.high) / 2;

  const ranked = keyForVoice(notes, range);
  const best = ranked[0];
  assert.equal(best.fits, true);
  assert.ok(Math.abs(best.tessituraCentre - centre) <= 2, `tessitura ${best.tessituraCentre} not within 2 semitones of centre ${centre}`);
});

test('keyForVoice ranks candidates best-first by fit, then tessitura centring, then smallest shift', () => {
  const notes = [{ start: 0, dur: 480, midi: 60 }];
  const ranked = keyForVoice(notes, ALTO_RANGE);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].outOfRange.length <= ranked[i].outOfRange.length, 'out-of-range count must be non-decreasing down the ranked list');
  }
});

test('arrangeVoice names the new key only when the input carries a key signature', () => {
  const notes = [{ start: 0, dur: 480, midi: 67 }]; // G4
  const withoutKey = arrangeVoice(notes, BASS_RANGE);
  assert.equal('newKeyName' in withoutKey, false);

  const withKey = arrangeVoice({ notes, key: { tonic: 7, mode: 'major' } }, BASS_RANGE);
  assert.equal(typeof withKey.newKeyName, 'string');
  assert.match(withKey.newKeyName, /^[A-G][#b]*m?$/);
});
