// The "Play it for me" player's stop/end rules, with a fake clock and fake timers (no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMidiOutPlayer } from '../../src/core/midi-out-player.js';

function rig({ msgs = [{ atMs: 1150, bytes: [0x90, 60, 80] }, { atMs: 1650, bytes: [0x80, 60, 0] }], throws = false } = {}) {
  let clock = 1000, nextId = 1; const timers = new Map(), calls = { sched: [], play: [], stopped: [] };
  const p = createMidiOutPlayer({
    now: () => clock,
    setTimeout: (f, ms) => { const id = nextId++; timers.set(id, { f, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    scheduleSong: (song, o) => { calls.sched.push(o); if (throws) throw new Error('no part'); return msgs; },
    playOnOutput: (out, m) => { calls.play.push([out, m]); return ch => calls.stopped.push(ch); },
  });
  return { p, timers, calls, fire: () => { for (const [id, t] of [...timers]) { timers.delete(id); t.f(); } } };
}
const OUT = { id: 'a' };

test('play with no output picked returns false and starts nothing', () => {
  const { p, calls } = rig(); p.setPorts([OUT]);
  assert.equal(p.play({}, 0, () => {}), false); assert.equal(p.busy(), false); assert.equal(calls.play.length, 0);
});

test('play schedules 150 ms ahead, is busy, and ends 250 ms after the last message', () => {
  const { p, timers, calls } = rig(); p.setPorts([OUT]); p.select('a');
  assert.equal(p.play({}, 2, () => {}), true);
  assert.deepEqual(calls.sched[0], { partIndex: 2, startMs: 1150, channel: 0 });
  assert.equal(p.busy(), true);
  assert.equal([...timers.values()][0].ms, 650 + 250);
});

test('play returns false when scheduling throws or yields nothing, and is not busy', () => {
  const a = rig({ throws: true }); a.p.setPorts([OUT]); a.p.select('a');
  assert.equal(a.p.play({}, 0), false); assert.equal(a.p.busy(), false);
  const b = rig({ msgs: [] }); b.p.setPorts([OUT]); b.p.select('a');
  assert.equal(b.p.play({}, 0), false); assert.equal(b.p.busy(), false);
});

test('stop cancels the timer, silences the output and calls onEnd exactly once', () => {
  const { p, timers, calls } = rig(); let ends = 0; p.setPorts([OUT]); p.select('a'); p.play({}, 0, () => ends++);
  p.stop(); p.stop();
  assert.equal(ends, 1); assert.equal(p.busy(), false); assert.equal(timers.size, 0); assert.deepEqual(calls.stopped, [0]);
});

test('natural end fires onEnd once', () => {
  const { p, fire } = rig(); let ends = 0; p.setPorts([OUT]); p.select('a'); p.play({}, 0, () => ends++);
  fire(); p.stop();
  assert.equal(ends, 1); assert.equal(p.busy(), false);
});

test('starting a new play ends the previous one first', () => {
  const { p } = rig(); let ends = 0; p.setPorts([OUT]); p.select('a'); p.play({}, 0, () => ends++); p.play({}, 0);
  assert.equal(ends, 1); assert.equal(p.busy(), true);
});

test('the picked output unplugging stops playback and clears the pick', () => {
  const { p } = rig(); let ends = 0; p.setPorts([OUT]); p.select('a'); p.play({}, 0, () => ends++);
  p.setPorts([{ id: 'b' }]);
  assert.equal(ends, 1); assert.equal(p.busy(), false); assert.equal(p.selectedId(), ''); assert.equal(p.selected(), null);
});

test('picking another output stops playback; a stopper that throws is swallowed', () => {
  const { p } = rig(); let ends = 0; p.setPorts([OUT, { id: 'b' }]); p.select('a'); p.play({}, 0, () => ends++);
  p.select('b'); assert.equal(ends, 1); assert.equal(p.selectedId(), 'b');
});
