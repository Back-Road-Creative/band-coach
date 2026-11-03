// The double-hit guard, against what a real kit sent (tests/fixtures/midi/kit-reading-usb-midi.json, K1 run of 2026-11-03).
// That kit repeats a hit as the same note, strong then weaker, up to 59 ms later, and a hi-hat hit also sends a soft snare
// note about 5 ms later. The guard drops those and keeps flams, two drums at once and fast playing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHitGuard, createMidiParser, RETRIGGER_MS } from '../../src/core/midi.js';
import { hatBleedsOnSnare, TRAINER_LEVELS } from '../../src/instruments/drum-kit.js';
import { buildPhrase, onsetsOf } from '../../src/core/rhythm.js';
import { starterGrooves } from '../../src/song/starter/index.js';
import { ticksToSeconds } from '../../src/song/model.js';

const capture = JSON.parse(readFileSync(new URL('../fixtures/midi/kit-reading-usb-midi.json', import.meta.url), 'utf8'));
const guarded = (hits, opts = { bleeds: hatBleedsOnSnare }) => {
  const guard = createHitGuard(opts);
  return hits.filter(h => !guard.drop({ port: 'kit', channel: 9, ...h }));
};
const hit = (note, velocity, at, over = {}) => ({ note, velocity, at, ...over });

test('the captured kit: every hit counts once, in the order the pads were struck', () => {
  const parser = createMidiParser();
  const guard = createHitGuard({ bleeds: hatBleedsOnSnare });
  const kept = [];
  let ons = 0;
  for (const [at, ...bytes] of capture.messages) {
    for (const e of parser.feed(bytes)) {
      if (e.type !== 'on') continue;
      ons++;
      if (!guard.drop({ port: capture.port, channel: e.channel, note: e.note, velocity: e.velocity, at })) kept.push(e.note);
    }
  }
  assert.equal(ons, 36, 'the capture really holds 36 note-ons for 21 hits');
  assert.deepEqual(kept, [36, 44, 46, 38, 44, 42, 48, 49, 45, 43, 51, 36, 44, 42, 46, 38, 48, 49, 45, 43, 51]);
});

test('single hits all stay (control)', () => {
  const hits = [hit(38, 90, 0), hit(38, 60, 500), hit(36, 127, 1000)];
  assert.deepEqual(guarded(hits), hits);
});

test('a repeat softer than the hit is dropped; each further one is measured from the one before it', () => {
  assert.deepEqual(guarded([hit(43, 49, 0), hit(43, 41, 26), hit(43, 37, 43)]).map(h => h.at), [0]);
  assert.deepEqual(guarded([hit(38, 127, 0), hit(38, 127, 20), hit(38, 32, 79)]).map(h => h.at), [0], 'the widest gap in the capture is 59 ms');
});

test('at the ceiling two equal hits are one hit, because a hard hit reads 127 twice', () => {
  assert.deepEqual(guarded([hit(38, 127, 0), hit(38, 127, 20)]).map(h => h.at), [0]);
});

test('below the ceiling two equal hits stay: the capture never repeats a hit at the same loudness there', () => {
  assert.deepEqual(guarded([hit(38, 100, 0), hit(38, 100, 30)]).map(h => h.at), [0, 30]);
});

test('a flam stays: a soft grace note and then the louder main hit, and the main hit\'s own repeat goes', () => {
  assert.deepEqual(guarded([hit(38, 40, 0), hit(38, 100, 25)]).map(h => h.at), [0, 25]);
  assert.deepEqual(guarded([hit(38, 40, 0), hit(38, 100, 25), hit(38, 60, 50)]).map(h => h.at), [0, 25]);
});

test('past the window the same note is a new hit, however soft', () => {
  assert.deepEqual(guarded([hit(38, 120, 0), hit(38, 30, RETRIGGER_MS + 1)]).map(h => h.at), [0, RETRIGGER_MS + 1]);
});

test('two drums at once stay, at any loudness the bleed rule does not name', () => {
  const kickAndHat = [hit(42, 127, 0), hit(36, 30, 3)];
  assert.deepEqual(guarded(kickAndHat), kickAndHat, 'a soft kick under a loud hat is a real hit');
  const snareAndHat = [hit(42, 120, 0), hit(38, 100, 3)];
  assert.deepEqual(guarded(snareAndHat), snareAndHat, 'a real snare beside a hat is far louder than the bleed');
  const snareFirst = [hit(38, 30, 0), hit(42, 127, 3)];
  assert.deepEqual(guarded(snareFirst), snareFirst, 'the snare does not bleed on the hat');
});

test('a soft snare note just after a hi-hat is the hat bleeding, and the real snare after it stays', () => {
  assert.deepEqual(guarded([hit(46, 127, 0), hit(38, 39, 4)]).map(h => h.note), [46]);
  assert.deepEqual(guarded([hit(42, 127, 0), hit(38, 42, 4.1)]).map(h => h.note), [42]);
  assert.deepEqual(guarded([hit(42, 127, 0), hit(38, 42, 4), hit(38, 30, 14)]).map(h => h.at), [0], 'the bleed\'s own repeat goes too');
  assert.deepEqual(guarded([hit(42, 127, 0), hit(38, 42, 4), hit(38, 110, 20)]).map(h => h.at), [0, 20], 'a real snare just after it is louder, so it stays');
  assert.deepEqual(guarded([hit(42, 127, 0), hit(38, 42, 4), hit(38, 30, 300)]).map(h => h.at), [0, 300]);
});

test('a soft snare too long after the hat is a ghost note, not bleed', () => {
  assert.deepEqual(guarded([hit(42, 127, 0), hit(38, 39, 30)]).map(h => h.at), [0, 30]);
});

test('without a bleed rule nothing but repeats is dropped', () => {
  const hits = [hit(46, 127, 0), hit(38, 39, 4)];
  assert.deepEqual(guarded(hits, {}), hits);
});

test('another port or channel is another instrument', () => {
  const guard = createHitGuard({ bleeds: hatBleedsOnSnare });
  assert.equal(guard.drop({ port: 'a', channel: 9, note: 38, velocity: 120, at: 0 }), false);
  assert.equal(guard.drop({ port: 'b', channel: 9, note: 38, velocity: 40, at: 5 }), false);
  assert.equal(guard.drop({ port: 'a', channel: 3, note: 38, velocity: 40, at: 10 }), false);
  assert.equal(guard.drop({ port: 'a', channel: 9, note: 38, velocity: 40, at: 15 }), true);
});

test('hat bleed names only a hi-hat over a snare', () => {
  assert.equal(hatBleedsOnSnare(42, 38), true);
  assert.equal(hatBleedsOnSnare(46, 38), true);
  assert.equal(hatBleedsOnSnare(44, 38), false, 'the pedal never did this');
  assert.equal(hatBleedsOnSnare(42, 36), false);
  assert.equal(hatBleedsOnSnare(38, 42), false);
});

// A same-drum gap under the window would lose a written note on a soft-after-loud pair.
function sameNoteGaps(items) {
  const last = new Map(), gaps = [];
  [...items].sort((a, b) => a.sec - b.sec).forEach(({ key, sec }) => { if (last.has(key)) gaps.push((sec - last.get(key)) * 1000); last.set(key, sec); });
  return gaps;
}

test('nothing in the trainer asks for the same drum faster than the window, flams aside', () => {
  let checked = 0;
  TRAINER_LEVELS.forEach(level => level.bars.forEach(bar => {
    const { events } = buildPhrase({ metre: level.metre, cells: bar.cells, bars: 1 });
    const at = onsetsOf(events, { bpm: level.bpm, swing: level.swing || 0 });
    const items = bar.hits.flatMap((h, i) => h.pieces.map(key => ({ key, sec: at[i] })));
    const gaps = sameNoteGaps(items);
    checked += gaps.length;
    assert.ok(!gaps.length || Math.min(...gaps) > RETRIGGER_MS * 2, `${level.name}: fastest same-drum gap ${Math.min(...gaps)} ms`);
  }));
  assert.ok(checked > 100);
});

test('no starter groove asks for the same drum faster than the window', () => {
  assert.ok(starterGrooves.length >= 8);
  starterGrooves.forEach(song => song.parts.forEach(part => {
    const gaps = sameNoteGaps(part.notes.map(n => ({ key: n.midi, sec: ticksToSeconds(n.start, song.bpm) })));
    assert.ok(gaps.length && Math.min(...gaps) > RETRIGGER_MS * 2, `${song.id}: fastest gap ${Math.min(...gaps)} ms`);
  }));
});
