// The hands-together stage machine (src/core/hands-together-stage.js), driven
// with a fake clock and the real note-state ledger. Each test walks one
// stage's transitions and checks the verdict (fail/pass/say/refresh actions
// and the held-window replacement) plus the pair scratchpad it leaves behind.
// tests/characterization/kbd-hands-together.test.mjs and its level 14-17
// siblings prove the same messages through the real app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step } from '../../src/core/hands-together-stage.js';
import { createNoteState } from '../../src/core/note-state.js';
import { handsTogetherById, isStagedPairId } from '../../src/core/hands-together.js';

const NAMES = { 48: 'C3', 50: 'D3', 60: 'C4', 62: 'D4', 64: 'E4', 65: 'F4', 66: 'F#4' };
const nname = m => NAMES[m] || ('m' + m);

// One exercise attempt: ids j1 (rh 60, lh 48), j1t/j1h/j1d staged, j1p position (rh 65, old 60).
function rig(id) {
  const t = { ms: 1000, sec: 10 };
  const ns = createNoteState();
  const pair = isStagedPairId(id) ? { phase: 'learn', on: {}, off: {}, learnOn: [], notes: [], rhOns: [], rhOffs: [], last: null } : undefined;
  const r = {
    t, ns, pair, held: [], midiHeld: new Set(), ex: handsTogetherById(id),
    ctx() { return { id, ex: r.ex, pair, held: r.held, now: () => t.sec, perfNow: () => t.ms, noteState: ns, realMidiHeld: r.midiHeld, nname }; },
    // a key goes down on the ledger, then the machine hears the note-on
    on(midi, source = 'midi', exact = true) {
      if (source === 'midi' || source === 'computer-key') { ns.noteOn(source, 0, midi); r.midiHeld.add(midi); }
      const v = step(r.ctx(), { type: 'on', midi, exact, source }); if (v.held) r.held = v.held; return v;
    },
    off(midi, source = 'midi') { ns.noteOff(source, 0, midi); r.midiHeld.delete(midi); return step(r.ctx(), { type: 'off', midi, source }); },
    at(ms) { t.ms = ms; t.sec = ms / 1000; return r; }
  };
  return r;
}
const kinds = v => v.acts.map(a => a.t);
const fails = v => v.acts.filter(a => a.t === 'fail');

test('plain id, real MIDI: both keys held pass with the fingering line; a stray key fails with its confusion key', () => {
  const r = rig('j1');
  assert.deepEqual(kinds(r.on(60)), []);
  const v = r.on(48);
  assert.equal(v.acts.length, 1); assert.equal(v.acts[0].t, 'pass'); assert.equal(v.acts[0].input, 'midi');
  assert.match(v.acts[0].msg, /^C \(both hands\): both hands together\. /);
  const r2 = rig('j1'); const f = r2.on(62);
  assert.equal(f.acts.length, 1); assert.equal(f.acts[0].t, 'fail'); assert.equal(f.acts[0].key, 'j1>x62');
  assert.match(f.acts[0].msg, /^D4 is not part of C \(both hands\) \(/);
  assert.equal(f.held, undefined, 'real MIDI leaves the recent-notes window alone');
});

test('plain id, screen tap: the 0.6s window counts both taps, an old tap ages out, a wrong tap clears the window', () => {
  const r = rig('j1');
  r.at(1000).on(60, 'screen');
  assert.deepEqual(kinds(r.at(1300).on(48, 'screen')), ['pass']);
  const late = rig('j1'); late.at(1000).on(60, 'screen');
  assert.deepEqual(kinds(late.at(1700).on(48, 'screen')), [], 'the first tap is 0.7s old, so it no longer counts');
  assert.equal(late.held.length, 1);
  const bad = rig('j1'); const v = bad.on(62, 'screen');
  assert.equal(fails(v).length, 1); assert.deepEqual(v.held, []);
});

test('microphone (approximate): right-only passes at 0.7 with the tail, the other hand alone is silently ignored', () => {
  const r = rig('j1r');
  const v = step({ ...r.ctx() }, { type: 'on', midi: 60, exact: false, source: 'mic' });
  assert.equal(v.acts.length, 1); assert.equal(v.acts[0].q, 0.7); assert.equal(v.acts[0].assist, 'approximate');
  assert.equal(v.acts[0].msg, 'Approximate (one note heard, microphone): right hand, C4. Right hand checked; the left hand was not.');
  assert.deepEqual(step(r.ctx(), { type: 'on', midi: 48, exact: false, source: 'mic' }).acts, []);
  const w = step(r.ctx(), { type: 'on', midi: 62, exact: false, source: 'mic' });
  assert.equal(w.acts[0].key, 'j1r>xa62');
  assert.equal(w.acts[0].msg, 'D4 is not part of C (both hands) (approximate: a microphone only hears one note at a time).');
});

test('timed: LEARN holds both keys then says the in-time line and refreshes; CHECK onsets too far apart fail and reset (reset after fail)', () => {
  const r = rig('j1t');
  assert.deepEqual(kinds(r.on(60)), []);
  const v = r.on(48);
  assert.deepEqual(kinds(v), ['say', 'refresh']);
  assert.equal(v.acts[0].msg, 'Good. Now in time: let go, then press both keys at the same moment and let go together.');
  assert.equal(r.pair.phase, 'check');
  assert.deepEqual(r.pair.on, {});
  r.off(60); r.off(48);
  r.at(2000).on(60);
  const f = r.at(2300).on(48);
  assert.equal(f.acts[0].key, 'j1t>t');
  assert.match(f.acts[0].msg, /^Left hand came in 300 ms after the right hand\./);
  assert.deepEqual(r.pair.on, {}, 'the failed attempt is wiped so the retry starts clean');
  assert.deepEqual(r.pair.off, {});
});

test('timed: CHECK passes only on the release, and a wrong key or a screen tap during CHECK does nothing useful', () => {
  const r = rig('j1t'); r.on(60); r.on(48); r.off(60); r.off(48);
  assert.deepEqual(kinds(r.at(2000).on(60, 'screen')), [], 'screen taps never complete a timing check');
  assert.equal(fails(r.on(62)).length, 1);
  r.at(3000).on(60); r.at(3020).on(48);
  assert.deepEqual(kinds(r.at(4000).off(60)), []);
  const v = r.at(4050).off(48);
  assert.deepEqual(v.acts, [{ t: 'pass', q: undefined, msg: 'C (both hands): together, in time.', assist: undefined, input: 'midi' }]);
  const rel = rig('j1t'); rel.on(60); rel.on(48); rel.off(60); rel.off(48); rel.at(3000).on(60); rel.at(3010).on(48);
  rel.at(4000).off(60);
  const f = rel.at(4400).off(48);
  assert.match(f.acts[0].msg, /^The right hand let go 400 ms before the left hand\./);
  assert.deepEqual(rel.pair.on, {});
});

test('LEARN (any stage): a wrong key fails and clears what LEARN had collected; a screen tap pair is practice only', () => {
  const r = rig('j1t'); r.on(60);
  assert.deepEqual(r.pair.learnOn, [60]);
  assert.equal(fails(r.on(62)).length, 1);
  assert.deepEqual(r.pair.learnOn, []);
  assert.equal(r.pair.phase, 'learn');
  const s = rig('j1t'); s.at(1000).on(60, 'screen');
  const v = s.at(1200).on(48, 'screen');
  assert.deepEqual(v.acts, [{ t: 'pass', q: undefined, msg: 'C (both hands): together. Practice only: held notes need a MIDI keyboard or computer keys.', assist: 'guided', input: 'screen' }]);
});

test('LEARN: a released key no longer counts toward the pair', () => {
  const r = rig('j1t'); r.on(60); r.off(60);
  assert.deepEqual(kinds(r.on(48)), [], 'the right hand was let go before the left came down');
  assert.equal(r.pair.phase, 'learn');
});

test('held bass: LEARN line differs; melody over a held bass passes on the bass release', () => {
  const r = rig('j1h'); r.on(60); const v = r.on(48);
  assert.equal(v.acts[0].msg, 'Good. Now let go, press the bass again and keep holding it, then play the melody over it.');
  r.off(60); r.off(48);
  r.at(2000).on(48);
  [60, 62, 60].forEach((m, k) => { assert.deepEqual(kinds(r.at(2100 + k * 100).on(m)), []); r.off(m); });
  assert.equal(r.pair.notes.length, 3); assert.ok(r.pair.notes.every(n => n.bassHeld));
  const done = r.at(2600).off(48);
  assert.deepEqual(done.acts, [{ t: 'pass', q: undefined, msg: 'C (both hands): bass held, melody played over it.', assist: undefined, input: 'midi' }]);
});

test('held bass release: letting go early fails on the release and resets everything', () => {
  const r = rig('j1h'); r.on(60); r.on(48); r.off(60); r.off(48);
  r.at(2000).on(48); r.at(2100).on(60); r.off(60);
  const f = r.at(2200).off(48);
  assert.equal(f.acts.length, 1); assert.equal(f.acts[0].key, 'j1h>h');
  assert.match(f.acts[0].msg, /^The left hand let go of C3 before the right hand finished\./);
  assert.deepEqual(r.pair.on, {}); assert.deepEqual(r.pair.notes, []);
});

test('held bass: a wrong melody note while the bass is still down keeps the bass onset and clears only the melody', () => {
  const r = rig('j1h'); r.on(60); r.on(48); r.off(60); r.off(48);
  r.at(2000).on(48);
  const f = r.at(2100).on(64);
  assert.equal(f.acts[0].key, 'j1h>h'); assert.match(f.acts[0].msg, /^E4 is not the next melody note\. Play C4 instead\./);
  assert.deepEqual(r.pair.notes, []);
  assert.equal(r.pair.on[48], 2000, 'bass onset kept');
  assert.deepEqual(kinds(r.at(2200).on(60)), []);
  assert.equal(r.pair.notes[0].bassHeld, true, 'the retry still reads the bass as held');
});

test('held bass: a melody note after the bass was let go clears the bass onset too', () => {
  const r = rig('j1h'); r.on(60); r.on(48); r.off(60); r.off(48);
  r.at(2000).on(48); r.ns.noteOff('midi', 0, 48); r.midiHeld.delete(48);
  const f = r.at(2100).on(60);
  assert.equal(f.acts[0].key, 'j1h>h'); assert.deepEqual(r.pair.on, {});
});

test('held bass release: another port still holding the bass defers the verdict', () => {
  const r = rig('j1h'); r.on(60); r.on(48); r.off(60); r.off(48);
  r.at(2000).on(48); r.ns.noteOn('other', 0, 48);
  [60, 62, 60].forEach((m, k) => { r.at(2100 + k * 100).on(m); r.off(m); });
  assert.deepEqual(r.at(2600).off(48).acts, []);
  assert.equal(r.pair.off[48], undefined);
});

test('split rhythm: bass then two right-hand notes, both hands released together, passes', () => {
  const r = rig('j1d'); r.on(60); const v = r.on(48);
  assert.equal(v.acts[0].msg, 'Good. Now let go, then hold the left hand under two even right-hand notes.');
  r.off(60); r.off(48);
  r.at(2000).on(48); r.at(2010).on(60);
  r.at(2400).off(60);
  r.at(2700).on(60);
  assert.deepEqual(r.pair.last, { rh: 'waiting', lh: 'waiting' });
  r.at(3000).off(60);
  const done = r.at(3010).off(48);
  assert.deepEqual(done.acts, [{ t: 'pass', q: undefined, msg: 'C (both hands): two even notes over one held bass.', assist: undefined, input: 'midi' }]);
  assert.deepEqual(r.pair.last, { rh: 'pass', lh: 'pass' });
});

test('split rhythm: a stray right-hand tap before the bass is dropped when the bass arrives balanced; an early right hand still down is kept', () => {
  const r = rig('j1d'); r.on(60); r.on(48); r.off(60); r.off(48);
  r.at(2000).on(60); r.at(2050).off(60);
  assert.deepEqual(r.pair.rhOns, [2000]); assert.deepEqual(r.pair.rhOffs, [2050]);
  r.at(3000).on(48);
  assert.deepEqual(r.pair.rhOns, [], 'balanced lists restart with the bass');
  const k = rig('j1d'); k.on(60); k.on(48); k.off(60); k.off(48);
  k.at(2000).on(60); k.at(2040).on(48);
  assert.deepEqual(k.pair.rhOns, [2000], 'right hand still down when the bass arrives is real evidence');
});

test('split rhythm: a late bass fails the left hand, resets all four lists, and a third right-hand note fails the right hand', () => {
  const r = rig('j1d'); r.on(60); r.on(48); r.off(60); r.off(48);
  r.at(2000).on(60);
  const f = r.at(2400).on(48);
  assert.equal(f.acts[0].key, 'j1d>d'); assert.match(f.acts[0].msg, /^The left hand came in 400 ms after the right hand started\./);
  assert.deepEqual([r.pair.on, r.pair.off, r.pair.rhOns, r.pair.rhOffs], [{}, {}, [], []]);
  const t = rig('j1d'); t.on(60); t.on(48); t.off(60); t.off(48);
  t.at(2000).on(48); t.at(2010).on(60); t.at(2100).off(60); t.at(2200).on(60); t.at(2300).off(60);
  const third = t.at(2400).on(60);
  assert.match(third.acts[0].msg, /^The right hand played more than two notes\./);
  assert.deepEqual(t.pair.rhOns, []);
});

test('split rhythm release: a right-hand release without a matching press, or while another port holds it, is ignored', () => {
  const r = rig('j1d'); r.on(60); r.on(48); r.off(60); r.off(48);
  r.at(2000).on(48);
  assert.deepEqual(r.at(2100).off(60).acts, []);
  assert.deepEqual(r.pair.rhOffs, []);
  assert.deepEqual(r.at(2200).off(62).acts, [], 'a key that is neither hand is ignored');
  r.at(2300).on(60); r.ns.noteOn('other', 0, 60);
  r.at(2400).off(60);
  assert.deepEqual(r.pair.rhOffs, []);
});

test('position change, two phases: old chord says move up and advances; old key afterwards fails; the new chord passes', () => {
  const r = rig('j1p');
  assert.deepEqual(kinds(r.on(48)), []);
  const v = r.on(60);
  assert.equal(r.pair.moved, true); assert.equal(r.pair.phase, 'check');
  assert.deepEqual(v.acts, [{ t: 'say', msg: 'Good. Now move your right hand up to F4 and play the same shape.', cls: '' }, { t: 'refresh' }]);
  const old = r.on(60);
  assert.equal(old.acts[0].msg, 'That is the old position -- move your right hand up to F4.'); assert.equal(old.acts[0].key, 'j1p>old');
  r.off(60);
  const ok = r.on(65);
  assert.deepEqual(ok.acts, [{ t: 'pass', q: undefined, msg: 'C (position change): position change complete. ' + ok.acts[0].msg.split('complete. ')[1], assist: undefined, input: 'midi' }]);
});

test('position change: the left hand lifting after the shift fails, un-moves, and returns to LEARN; before the shift a release means nothing', () => {
  const r = rig('j1p'); r.on(48); r.on(60);
  assert.deepEqual(r.off(60).acts, [], 'right hand release is not the one that matters');
  const f = r.off(48);
  assert.deepEqual(kinds(f), ['fail', 'refresh']);
  assert.equal(f.acts[0].key, 'j1p>l');
  assert.equal(f.acts[0].msg, 'The left hand let go of C3 during the move. Keep it down while your right hand moves up, then start again from the first position.');
  assert.equal(r.pair.moved, false); assert.equal(r.pair.phase, 'learn');
  const early = rig('j1p'); early.on(48);
  assert.deepEqual(early.off(48).acts, [], 'ignored outside CHECK');
});

test('position change: a wrong key fails; for a screen tap the window clears, for real MIDI it is left alone', () => {
  const m = rig('j1p'); const fm = m.on(62);
  assert.equal(fails(fm).length, 1); assert.equal(fm.held, undefined);
  const s = rig('j1p'); const fs = s.on(62, 'screen');
  assert.equal(fails(fs).length, 1); assert.deepEqual(fs.held, []);
  const ck = rig('j1p'); ck.on(62, 'computer-key');
  assert.deepEqual(step(ck.ctx(), { type: 'on', midi: 62, exact: true, source: 'computer-key' }).held, [], 'computer keys read the true held set but still clear the window');
});

test('note-offs outside a staged exercise do nothing', () => {
  const r = rig('j1');
  assert.deepEqual(r.off(60).acts, []);
});
