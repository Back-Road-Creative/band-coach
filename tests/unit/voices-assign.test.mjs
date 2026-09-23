// assignVoices: split a flat, possibly-overlapping list of detected notes
// into role-tagged parts (melody/bass/inner/percussion). Proof fixture is
// the kbd "hands together" exercises (src/core/hands-together.js), which
// give a real right-hand/left-hand note stream without needing a two-hand
// starter song (none of the starter songs are multi-part -- see
// src/song/starter/index.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assignVoices } from '../../src/song/voices-assign.js';
import { HANDS_TOGETHER_EXERCISES } from '../../src/core/hands-together.js';
import { starterSongs } from '../../src/song/starter/index.js';

test('assignVoices round-trips kbd hands-together material: right hand -> melody, left hand -> bass', () => {
  const notes = [];
  HANDS_TOGETHER_EXERCISES.forEach((ex, i) => {
    const start = i * 480;
    notes.push({ start, dur: 480, midi: ex.rh.midi, _hand: 'rh' });
    notes.push({ start, dur: 480, midi: ex.lh.midi, _hand: 'lh' });
  });
  const parts = assignVoices(notes);
  const melody = parts.find((p) => p.role === 'melody');
  const bass = parts.find((p) => p.role === 'bass');
  assert.ok(melody && bass, 'both a melody and a bass part come out of hands-together material');
  let agree = 0;
  for (const n of notes) {
    const inMelody = melody.notes.includes(n);
    const inBass = bass.notes.includes(n);
    if ((n._hand === 'rh' && inMelody) || (n._hand === 'lh' && inBass)) agree++;
  }
  const pct = agree / notes.length;
  // Measured agreement on this fixture is 100% (RH/LH pitch ranges never
  // overlap: RH 60-67, LH 48-55). Floor pinned at the measured value.
  assert.ok(pct >= 1.0, `measured RH->melody / LH->bass agreement was ${(pct * 100).toFixed(1)}% (floor 100%)`);
});

test('a single-line starter melody produces one melody part and no bass part', () => {
  const song = starterSongs.find((s) => s.id === 'twinkle-twinkle');
  const parts = assignVoices(song.parts[0].notes);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].role, 'melody');
  assert.equal(parts[0].notes.length, song.parts[0].notes.length);
});

test('crossing voices land in one melody part and one bass part, not fragmented by the crossing', () => {
  const steps = [[60, 76], [63, 73], [66, 70], [69, 67], [72, 64], [75, 61]];
  const notes = [];
  steps.forEach(([a, b], i) => { const start = i * 480; notes.push({ start, dur: 480, midi: a, _v: 'A' }, { start, dur: 480, midi: b, _v: 'B' }); });
  const parts = assignVoices(notes);
  const melody = parts.find((p) => p.role === 'melody');
  const bass = parts.find((p) => p.role === 'bass');
  assert.equal(parts.filter((p) => p.role === 'melody' || p.role === 'bass').length, 2, 'exactly one melody part and one bass part, not one per crossing segment');
  const home = (v) => (melody.notes.some((n) => n._v === v) ? 'melody' : (bass.notes.some((n) => n._v === v) ? 'bass' : null));
  for (const v of ['A', 'B']) {
    const role = home(v);
    const otherPart = role === 'melody' ? bass : melody;
    const leaked = otherPart.notes.filter((n) => n._v === v).length;
    assert.equal(leaked, 0, `voice ${v} should stay entirely in one part, not split across melody/bass by the crossing`);
  }
});

test('notes flagged unpitched go straight to a percussion part, bypassing contour tracking', () => {
  const notes = [
    { start: 0, dur: 240, midi: 60 },
    { start: 0, dur: 240, midi: 36, unpitched: true },
    { start: 240, dur: 240, midi: 62 },
    { start: 240, dur: 240, midi: 38, unpitched: true },
  ];
  const parts = assignVoices(notes);
  const perc = parts.find((p) => p.role === 'percussion');
  assert.ok(perc);
  assert.equal(perc.notes.length, 2);
  assert.ok(perc.notes.every((n) => n.unpitched));
});
