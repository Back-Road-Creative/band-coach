import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { starterSongs } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId as instrumentById } from '../../src/instruments/index.js';

// Golden melodies in tests/fixtures/golden/ were written by hand before the
// app's song data was read; the comparison rule is in that folder's README.md.
// This file is the only thing that compares them to the app. A song that
// disagrees is left out of GOLDEN_IDS and reported, never "fixed" here.
// hot-cross-buns is out: the golden file has the eighth-note "one a penny, two
// a penny" bar (C C C C D D D D, 8 eighths in one bar); the app has the same
// pitches as quarter notes over two bars. Awaiting a decision on which is right.
const GOLDEN_IDS = ['mary-had-a-little-lamb', 'ode-to-joy'];

const golden = (id) => JSON.parse(readFileSync(new URL(`../fixtures/golden/${id}.json`, import.meta.url), 'utf8'));
const goldenFlat = (g, phraseCount = g.phrases.length) => g.phrases.slice(0, phraseCount).flat().map((n) => ({ off: n.off, beats: n.beats }));
// Semitones from the first note, length in beats (4/4: one beat = one quarter note).
const asOffsets = (notes, tpq) => notes.map((n) => ({ off: n.midi - notes[0].midi, beats: n.dur / tpq }));

for (const id of GOLDEN_IDS) {
  const g = golden(id);
  const song = starterSongs.find((s) => s.id === id);

  test(`golden ${id}: the fixture is a well-formed 4/4 tune`, () => {
    assert.equal(g.id, id);
    assert.equal(g.meter, '4/4');
    assert.equal(g.phrases[0][0].off, 0, 'offsets are measured from the first note');
    for (const p of g.phrases) {
      const beats = p.reduce((a, n) => a + n.beats, 0);
      assert.equal(beats % 4, 0, 'every phrase is a whole number of bars');
    }
  });

  test(`golden ${id}: the app's notes are the golden notes (whole tune, or whole-phrase prefix)`, () => {
    assert.ok(song, `${id} is in starterSongs`);
    assert.equal(song.parts.length, 1);
    const app = asOffsets(song.parts[0].notes, song.ticksPerQuarter);
    const accepted = g.phrases.map((_, i) => i + 1).filter((k) => JSON.stringify(goldenFlat(g, k)) === JSON.stringify(app));
    assert.equal(accepted.length, 1, `app notes ${JSON.stringify(app)} equal no whole-phrase prefix of the golden notes ${JSON.stringify(goldenFlat(g))}`);
  });

  for (const instId of ['kbd', 'gtr']) {
    test(`golden ${id}: the ${instId} lesson plan keeps every note, in order, with its length`, () => {
      const app = asOffsets(song.parts[0].notes, song.ticksPerQuarter);
      const plan = buildLessonPlan(song, song.parts[0].id, instrumentById[instId]);
      assert.deepEqual(plan.fit.unplayable, [], `${instId} can play every note, so none may be dropped`);
      const tpq = song.ticksPerQuarter;
      const whole = plan.steps.filter((s) => s.kind === 'whole');
      assert.equal(whole.length, 1);
      assert.deepEqual(asOffsets(whole[0].notes, tpq), app, 'the whole-piece step expects the song');
      // Steps may split the tune into phrases, never lose, add or move a note.
      for (const kind of ['listen', 'rhythm', 'pitches', 'phrase-slow']) {
        const steps = plan.steps.filter((s) => s.kind === kind);
        assert.ok(steps.length >= 1, `${kind} steps exist`);
        assert.deepEqual(asOffsets(steps.flatMap((s) => s.notes), tpq), app, `${kind} steps together expect the song`);
      }
      const chains = plan.steps.filter((s) => s.kind === 'chain');
      if (chains.length) assert.deepEqual(asOffsets(chains[chains.length - 1].notes, tpq), app, 'the longest chain expects the song');
      // And the notes keep their place on the timeline: starts rise, none overlap.
      const flat = whole[0].notes;
      for (let i = 1; i < flat.length; i++) assert.equal(flat[i].start, flat[i - 1].start + flat[i - 1].dur, 'notes follow one another with no gap or overlap');
    });
  }
}
