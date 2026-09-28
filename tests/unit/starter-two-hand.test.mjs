// Unit E6d: two public-domain two-hand keyboard starters. Both hands live
// in ONE part (the shared shape, notation.js grammar, H1's note.hand
// tagging) so the existing hand-filter (src/song/hand-filter.js) and kbd
// hand-off (src/instruments/kbd-songs.js) work unchanged. Every melody-only
// consumer (ear song-dictation, song-rhythm, the roundtrip eval harness)
// reads `starterMelodies`, never `starterSongs`, so a two-hand piece never
// gets pulled apart into a monophonic phrase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { starterSongs, starterSongDefs, starterMelodies, isTwoHand, build } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { arrangeFor } from '../../src/song/arrange/index.js';
import { handsAvailable } from '../../src/song/hand-filter.js';
import { fidelityReport } from '../../src/song/eval/fidelity.js';
import { ENTRIES, songFor, reviewItems, KBD_HANDS_TOGETHER_LEVEL } from '../../src/instruments/kbd-songs.js';
import { make as makeDictation } from '../../src/core/ear/song-dictation.js';
import { make as makeRhythm } from '../../src/core/ear/song-rhythm.js';

const kbd = INSTRUMENTS.find((r) => r.id === 'kbd');

const TWO_HAND_IDS = ['ode-to-joy-two-hands', 'twinkle-twinkle-two-hands'];

function arr(song) {
  const fit = buildLessonPlan(song, 'melody', kbd).fit;
  return arrangeFor(fit.notes, kbd, {});
}

test('each two-hand starter has one part with every note tagged rh or lh, and handsAvailable sees both', () => {
  for (const id of TWO_HAND_IDS) {
    const song = starterSongs.find((s) => s.id === id);
    assert.ok(song, `${id}: not found in starterSongs`);
    assert.equal(song.parts.length, 1, `${id}: expected exactly one part`);
    for (const note of song.parts[0].notes) {
      assert.ok(note.hand === 'rh' || note.hand === 'lh', `${id}: note at ${note.start} missing hand tag`);
    }
    assert.deepEqual(handsAvailable(song, 'melody', arr(song)), ['rh', 'lh'], `${id}: expected both hands available`);
    assert.equal(isTwoHand(song), true, `${id}: isTwoHand should be true`);
  }
});

test('each two-hand starter has a clean fidelity report on kbd, with notes for both hands', () => {
  for (const id of TWO_HAND_IDS) {
    const song = starterSongs.find((s) => s.id === id);
    const report = fidelityReport(null, song, 'melody', kbd);
    assert.deepEqual(report.outOfRange, [], `${id}: expected no out-of-range notes`);
    assert.deepEqual(report.chordReduced, [], `${id}: expected no chord-reduced notes`);
    assert.equal(report.shiftSemitones, 0, `${id}: expected no octave shift`);
    assert.ok(report.hands, `${id}: expected a hands breakdown`);
    assert.ok(report.hands.rh > 0, `${id}: expected right-hand notes`);
    assert.ok(report.hands.lh > 0, `${id}: expected left-hand notes`);
  }
});

test('each two-hand starter states public-domain licence and an honest source', () => {
  for (const id of TWO_HAND_IDS) {
    const song = starterSongs.find((s) => s.id === id);
    assert.equal(song.licence, 'Public domain', `${id}: unexpected licence`);
    assert.match(song.source, /this transcription was made for Band Coach/, `${id}: source must disclose Band Coach transcription`);
    assert.match(song.source, /left-hand part arranged for Band Coach/, `${id}: source must disclose the left-hand arrangement`);
  }
});

test('every other starter stays one-handed, and starterMelodies excludes only the two-hand ids', () => {
  for (const song of starterSongs) {
    if (TWO_HAND_IDS.includes(song.id)) continue;
    assert.deepEqual(handsAvailable(song, 'melody', arr(song)), ['rh'], `${song.id}: expected one hand only`);
    assert.equal(isTwoHand(song), false, `${song.id}: isTwoHand should be false`);
  }
  const allIds = starterSongs.map((s) => s.id);
  const melodyIds = starterMelodies.map((s) => s.id);
  const expectedMelodyIds = allIds.filter((id) => !TWO_HAND_IDS.includes(id));
  assert.deepEqual(melodyIds, expectedMelodyIds);
});

test('KBD_HANDS_TOGETHER_LEVEL floors the two-hand hand-off suggestions at 13', () => {
  assert.equal(KBD_HANDS_TOGETHER_LEVEL, 13);
  for (const id of TWO_HAND_IDS) {
    const entry = ENTRIES.find((e) => e.songId === id);
    assert.ok(entry, `${id}: expected a kbd-songs ENTRIES row`);
    assert.equal(entry.minLevel, 13, `${id}: expected minLevel 13`);
    const review = reviewItems().find((r) => r.songId === id);
    assert.equal(review.current, false, `${id}: expected an unreviewed hand-off entry`);
  }
  assert.equal(songFor(12).songId, 'frere-jacques');
  assert.equal(songFor(13).songId, 'ode-to-joy-two-hands');
});

test('ear song dictation and song rhythm never draw a two-hand starter into their phrases', () => {
  const twoHandTitles = starterSongs.filter((s) => TWO_HAND_IDS.includes(s.id)).map((s) => s.title);
  for (const level of [1, 3, 5]) {
    for (let seed = 0; seed < 200; seed++) {
      const dictation = makeDictation(level, seed);
      for (const title of twoHandTitles) {
        assert.ok(!dictation.explain.includes(title), `dictation level ${level} seed ${seed}: named a two-hand starter`);
      }
      const rhythm = makeRhythm(level, seed);
      for (const title of twoHandTitles) {
        assert.ok(!rhythm.explain.includes(title), `rhythm level ${level} seed ${seed}: named a two-hand starter`);
      }
    }
  }
});

test('build refuses a two-hand def whose left hand has a different number of bars', () => {
  const def = { ...starterSongDefs.find((d) => d.id === 'ode-to-joy-two-hands') };
  def.lh = def.lh.split('|').slice(0, -1).join('|');
  assert.throws(() => build(def), /ode-to-joy-two-hands: the right hand has 8 bars but the left hand has 7/);
});
