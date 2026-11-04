// The double-hit guard, against what a real kit sent (tests/fixtures/midi/kit-reading-usb-midi.json, K1 run of 2026-11-03).
// That kit repeats a hit as the same note, strong then weaker, up to 59 ms later, and a hi-hat hit also sends a soft snare
// note about 5 ms later. A kick at full force also sends soft snare and tom notes up to 19 ms later
// (tests/fixtures/midi/kit-reading-kick-usb-midi.json). The guard drops those and keeps flams, two drums at once and fast playing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHitGuard, createMidiParser, RETRIGGER_MS } from '../../src/core/midi.js';
import { hatBleedsOnSnare, kickBleedsOnDrums, padBleeds, TRAINER_LEVELS } from '../../src/instruments/drum-kit.js';
import { buildPhrase, onsetsOf } from '../../src/core/rhythm.js';
import { starterGrooves } from '../../src/song/starter/index.js';
import { ticksToSeconds } from '../../src/song/model.js';

const capture = JSON.parse(readFileSync(new URL('../fixtures/midi/kit-reading-usb-midi.json', import.meta.url), 'utf8'));
const kickCapture = JSON.parse(readFileSync(new URL('../fixtures/midi/kit-reading-kick-usb-midi.json', import.meta.url), 'utf8'));
const guarded = (hits, opts = { bleeds: padBleeds }) => {
  const guard = createHitGuard(opts);
  return hits.filter(h => !guard.drop({ port: 'kit', channel: 9, ...h }));
};
const hit = (note, velocity, at, over = {}) => ({ note, velocity, at, ...over });

test('the captured kit: every hit counts once, in the order the pads were struck', () => {
  const parser = createMidiParser();
  const guard = createHitGuard({ bleeds: padBleeds });
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

test('the captured kick: 20 strikes count 20 times, and none of the snare or tom notes it also sent counts', () => {
  const parser = createMidiParser();
  const guard = createHitGuard({ bleeds: padBleeds });
  const kept = [], sent = [];
  for (const [at, ...bytes] of kickCapture.messages) {
    for (const e of parser.feed(bytes)) {
      if (e.type !== 'on') continue;
      sent.push(e.note);
      if (!guard.drop({ port: kickCapture.port, channel: e.channel, note: e.note, velocity: e.velocity, at })) kept.push(e.note);
    }
  }
  assert.equal(sent.length, 41, 'the capture really holds 41 note-ons for 20 strikes');
  assert.deepEqual([...new Set(sent)].sort(), [36, 38, 43, 45, 48]);
  assert.deepEqual(kept, Array(20).fill(36));
});

test('a full-force kick: the snare and tom notes it sends are dropped, with their own repeat and however many there are', () => {
  assert.deepEqual(guarded([hit(36, 127, 0), hit(38, 26, 8)]).map(h => h.note), [36]);
  assert.deepEqual(guarded([hit(36, 127, 0), hit(38, 31, 12), hit(45, 38, 19)]).map(h => h.note), [36]);
  assert.deepEqual(guarded([hit(36, 127, 0), hit(43, 34, 10), hit(48, 32, 15)]).map(h => h.note), [36]);
  assert.deepEqual(guarded([hit(36, 127, 0), hit(38, 26, 8), hit(38, 20, 15)]).map(h => h.note), [36]);
});

test('beside a kick, real drums stay', () => {
  const after = (rest) => guarded([hit(36, 127, 0), ...rest]).map(h => h.at);
  assert.deepEqual(after([hit(38, 100, 5)]), [0, 5], 'a real snare with the kick is far louder than the crosstalk');
  assert.deepEqual(after([hit(38, 51, 5)]), [0, 5], 'over 40% of the kick is not crosstalk');
  assert.deepEqual(after([hit(38, 30, 26)]), [0, 26], 'a soft snare past the window is a ghost note');
  assert.deepEqual(after([hit(38, 30, 12), hit(38, 110, 30)]), [0, 30], 'a real snare straight after the crosstalk is louder, so it stays');
  assert.deepEqual(after([hit(42, 30, 5)]), [0, 5], 'the reading never showed a kick sending a hi-hat');
  assert.deepEqual(after([hit(49, 30, 5)]), [0, 5], 'nor a cymbal');
  assert.deepEqual(guarded([hit(38, 30, 0), hit(36, 127, 3)]).map(h => h.at), [0, 3], 'a soft snare before the kick is a real hit');
});

test('a kick below full force keeps every note beside it: the reading\'s softer kicks sent nothing else', () => {
  for (const v of [47, 77, 96, 104, 126]) assert.deepEqual(guarded([hit(36, v, 0), hit(38, 26, 8)]).map(h => h.at), [0, 8], `kick at ${v}`);
});

test('the kick window does not widen the hi-hat\'s: a soft snare 15 ms after a hat is a ghost note', () => {
  assert.deepEqual(guarded([hit(42, 127, 0), hit(38, 39, 15)]).map(h => h.at), [0, 15]);
});

test('kick crosstalk names only a kick over a snare or a tom', () => {
  for (const to of [38, 43, 45, 48]) assert.equal(kickBleedsOnDrums(36, to), true, `to ${to}`);
  for (const to of [36, 42, 44, 46, 49, 51]) assert.equal(kickBleedsOnDrums(36, to), false, `to ${to}`);
  for (const from of [38, 42, 45, 49]) assert.equal(kickBleedsOnDrums(from, 38), false, `from ${from}`);
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
  const guard = createHitGuard({ bleeds: padBleeds });
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
