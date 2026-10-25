// F20: drum-kit starter grooves. Each groove is a built-in song with one
// percussion part, so the drum kit has something in Songs to play along
// with -- the pitched starter tunes all fit the drum kit at 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterGrooves, starterIds, starterById } from '../../src/song/starter/index.js';
import { validateSong } from '../../src/song/model.js';
import { buildLessonPlan, fitToInstrument } from '../../src/song/lesson.js';
import { PIECES, canonicalMidi } from '../../src/instruments/drum-kit.js';
import { byId } from '../../src/instruments/index.js';
import { METRES } from '../../src/core/rhythm.js';

const PIECE_IDS = new Set(PIECES.map((p) => p.id));

test('at least six grooves, each a valid song with one percussion part', () => {
  assert.ok(starterGrooves.length >= 6, `only ${starterGrooves.length} grooves`);
  for (const song of starterGrooves) {
    const v = validateSong(song);
    assert.ok(v.ok, `${song.id}: ${v.errors && v.errors.join('; ')}`);
    assert.equal(song.parts.length, 1, song.id);
    assert.equal(song.parts[0].role, 'percussion', song.id);
    assert.ok(song.title && song.title !== 'groove.' + song.id, `${song.id} has a translated title`);
  }
});

test('every note names a kit piece and sounds that piece', () => {
  for (const song of starterGrooves) {
    for (const n of song.parts[0].notes) {
      assert.ok(PIECE_IDS.has(n.piece), `${song.id}: unknown piece ${n.piece}`);
      assert.equal(n.midi, canonicalMidi(n.piece), `${song.id}: ${n.piece} midi`);
    }
  }
});

test('each groove fills whole bars of its metre', () => {
  for (const song of starterGrooves) {
    const metre = song.metre.num + '/' + song.metre.den;
    const bar = METRES[metre].ticksPerBar;
    const end = Math.max(...song.parts[0].notes.map((n) => n.start + n.dur));
    assert.equal(end % bar, 0, `${song.id} ends mid-bar`);
    assert.ok(end / bar >= 4, `${song.id} is shorter than four bars`);
  }
});

test('the drum kit plays every note of every groove', () => {
  const kit = byId['drum-kit'];
  for (const song of starterGrooves) {
    const fit = fitToInstrument(song, song.parts[0].id, kit);
    assert.deepEqual(fit.unplayable, [], song.id);
    assert.equal(fit.fitScore, 1, song.id);
    const plan = buildLessonPlan(song, song.parts[0].id, kit);
    assert.ok(plan.steps.some((s) => s.passRule), `${song.id} has a step to play`);
  }
});

test('groove ids are reserved and found by id beside the tunes', () => {
  for (const song of starterGrooves) {
    assert.ok(starterIds.has(song.id), song.id);
    assert.equal(starterById(song.id), song);
  }
  assert.equal(starterById('hot-cross-buns').id, 'hot-cross-buns');
  assert.equal(starterById('no-such-song'), undefined);
});
