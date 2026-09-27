import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pathwayState, DAY_MS } from '../../src/core/pathway.js';
import { reviewItems, outcomeReviewed } from '../../src/instruments/kbd-pathway.js';

const NOW = 1_700_000_000_000;

function whole(over) {
  return Object.assign({
    instrument: 'kbd', skill: 'whole:null', source: 'song', input: 'midi', assistance: 'none',
    dims: { pitch: 'ok', rhythm: 'ok' }, at: NOW - 1000,
  }, over);
}

test('no proof, empty history -> setup', () => {
  const s = pathwayState({ events: [], sessions: [], midiProof: false, level: 3, now: NOW });
  assert.equal(s.step, 'setup');
  assert.equal(s.action.kind, 'connect-midi');
});

test('midiProof true, level 1 -> lesson', () => {
  const s = pathwayState({ events: [], sessions: [], midiProof: true, level: 1, now: NOW });
  assert.equal(s.step, 'lesson');
  assert.equal(s.action.kind, 'trainer');
});

test('midiProof true, level 3, no song session or event -> song', () => {
  const s = pathwayState({ events: [], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'song');
  assert.equal(s.action.kind, 'open-song');
});

test('level 3, one kbd sessions row source:song -> check', () => {
  const s = pathwayState({ events: [], sessions: [{ mod: 'kbd', source: 'song' }], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'check');
  assert.equal(s.action.kind, 'check-song');
});

test('a non-kbd song session alone -> still song', () => {
  const s = pathwayState({ events: [], sessions: [{ mod: 'gtr', source: 'song' }], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'song');
});

test('sessions list with no song row but a kbd source:song event -> check (sessions cap)', () => {
  const s = pathwayState({ events: [{ instrument: 'kbd', source: 'song', skill: 'listen:0', at: NOW - 5000 }], sessions: [{ mod: 'kbd', source: 'drill' }], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'check');
});

test('song session plus independent whole-step rows with non-midi input -> still check', () => {
  const sessions = [{ mod: 'kbd', source: 'song' }];
  ['computer-key', 'mixed', undefined].forEach((input) => {
    const ev = whole({ input });
    if (input === undefined) delete ev.input;
    const s = pathwayState({ events: [ev], sessions, midiProof: true, level: 3, now: NOW });
    assert.equal(s.step, 'check', 'input=' + input);
  });
});

test('midi row with assistance shown -> still check', () => {
  const s = pathwayState({ events: [whole({ assistance: 'shown' })], sessions: [{ mod: 'kbd', source: 'song' }], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'check');
});

test('midi row with one assessed dim miss -> still check', () => {
  const s = pathwayState({ events: [whole({ dims: { pitch: 'ok', rhythm: 'miss' } })], sessions: [{ mod: 'kbd', source: 'song' }], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'check');
});

test('midi, assistance-none, all-ok row on phrase-slow:0 -> still check', () => {
  const s = pathwayState({ events: [whole({ skill: 'phrase-slow:0' })], sessions: [{ mod: 'kbd', source: 'song' }], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'check');
});

test('the same qualifying row on whole:null -> return, wait, when recent', () => {
  const s = pathwayState({ events: [whole({ at: NOW - 1000 })], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'wait');
  assert.equal(s.action.dueAt, (NOW - 1000) + DAY_MS);
});

test('the same qualifying row, more than a day old -> return, recheck', () => {
  const s = pathwayState({ events: [whole({ at: NOW - DAY_MS - 1000 })], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'recheck');
});

test('midiProof false but history holds the qualifying midi row -> return, not setup', () => {
  const s = pathwayState({ events: [whole({ at: NOW - 1000 })], sessions: [], midiProof: false, level: 3, now: NOW });
  assert.equal(s.step, 'return');
});

test('a non-kbd instrument midi row never qualifies', () => {
  const s = pathwayState({ events: [whole({ instrument: 'gtr', at: NOW - 1000 })], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.notEqual(s.step, 'return');
});

test('tolerates missing/empty/non-object rows without throwing', () => {
  assert.doesNotThrow(() => pathwayState({ events: undefined, sessions: undefined, midiProof: false, level: 3, now: NOW }));
  assert.doesNotThrow(() => pathwayState({ events: [null, 1, 'x'], sessions: [null, 1, 'x'], midiProof: false, level: 3, now: NOW }));
});

test('kbd-pathway.js: every step has exactly one outcome id starting kbd.pathway., listed by reviewItems, all unreviewed', () => {
  const items = reviewItems();
  assert.equal(items.length, 5);
  const steps = new Set();
  items.forEach((it) => {
    assert.match(it.id, /^kbd\.pathway\./);
    assert.ok(!steps.has(it.id), 'duplicate id ' + it.id);
    steps.add(it.id);
    assert.equal(outcomeReviewed(it.id), false);
  });
});
