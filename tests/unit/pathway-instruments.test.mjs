// F19: the first-week path for every instrument, not only the keyboard.
// src/instruments/first-week.js builds six steps from an instrument's own
// record (its name and input), each labelled practice-grade because the
// microphone path has not been checked by a player; src/core/pathway.js's
// pathwayState judges the same steps for that instrument's own rows. The
// keyboard keeps its five-step path untouched (tests/unit/pathway.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pathwayState, DAY_MS } from '../../src/core/pathway.js';
import { firstWeekFor, firstWeekSong, PRACTICE_GRADE } from '../../src/instruments/first-week.js';
import { reviewItems as kbdOutcomes } from '../../src/instruments/kbd-pathway.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { starterSongs } from '../../src/song/starter/index.js';
import { feasibility } from '../../src/song/feasibility.js';

const NOW = 1_700_000_000_000;

function whole(over) {
  return Object.assign({
    instrument: 'flute', skill: 'whole:null', source: 'song', input: 'mic', assistance: 'none',
    dims: { pitch: 'ok', rhythm: 'ok' }, at: NOW - 1000, songId: 'hot-cross-buns',
  }, over);
}
const flute = (over) => pathwayState(Object.assign({ instrument: 'flute', input: 'mic', events: [], sessions: [], proof: false, level: 3, now: NOW }, over));

test('flute: six steps, every one labelled practice-grade, text from the record', () => {
  const fw = firstWeekFor('flute');
  assert.ok(fw, 'flute has a first-week path');
  assert.deepEqual(fw.steps.map((s) => s.value.step), ['setup', 'lesson', 'song', 'check', 'return', 'transfer']);
  assert.equal(PRACTICE_GRADE, 'practice-grade (mic, not yet checked by a player)');
  fw.steps.forEach((s) => {
    assert.equal(s.value.label, PRACTICE_GRADE, s.id);
    assert.equal(s.id, 'flute.firstWeek.' + s.value.step);
  });
  assert.match(fw.steps[0].value.text, /Flute/);
  assert.equal(fw.name, 'Flute');
});

test('keyboard: no generic path, its own five steps unchanged', () => {
  assert.equal(firstWeekFor('kbd'), null);
  assert.deepEqual(kbdOutcomes().map((o) => o.value.step), ['setup', 'lesson', 'song', 'check', 'return']);
  assert.equal(firstWeekFor('no-such-instrument'), null);
});

test('every mic instrument with a starter song that fits gets a path; one with none gets null', () => {
  const fits = (rec) => starterSongs.some((s) => ['as-written', 'transposed'].includes(feasibility(s, s.parts[0].id, rec).level));
  const mic = INSTRUMENTS.filter((rec) => rec.input === 'mic');
  assert.ok(mic.length >= 20);
  mic.forEach((rec) => assert.equal(!!firstWeekFor(rec.id), fits(rec), rec.id));
  assert.ok(mic.filter((rec) => firstWeekFor(rec.id)).length >= 20, 'most mic instruments have a path today');
});

test('firstWeekSong: the first starter that fits, then the next unseen one for the transfer', () => {
  assert.deepEqual(firstWeekSong('flute'), { songId: 'hot-cross-buns', partId: 'melody' });
  assert.deepEqual(firstWeekSong('flute', ['hot-cross-buns']), { songId: 'mary-had-a-little-lamb', partId: 'melody' });
  assert.equal(firstWeekSong('oboe'), null);
});

test('flute pathwayState: setup, lesson, song, check from the flute\'s own rows', () => {
  assert.deepEqual(flute({}).action, { kind: 'connect-mic' });
  assert.equal(flute({}).step, 'setup');
  assert.equal(flute({ proof: true, level: 1 }).step, 'lesson');
  // History proof: any flute row heard on the mic keeps a returning learner past setup.
  const heard = [{ instrument: 'flute', source: 'drill', input: 'mic', skill: 'w60', at: NOW - 5000 }];
  assert.equal(flute({ events: heard }).step, 'song');
  // A keyboard MIDI row is not proof the flute mic works.
  assert.equal(flute({ events: [{ instrument: 'kbd', source: 'drill', input: 'midi', at: NOW - 5000 }] }).step, 'setup');
  assert.equal(flute({ proof: true, sessions: [{ mod: 'kbd', source: 'song' }] }).step, 'song');
  assert.equal(flute({ proof: true, sessions: [{ mod: 'flute', source: 'song' }] }).step, 'check');
});

test('flute pathwayState: a clean mic whole-piece check -> return, then transfer, then complete', () => {
  const sessions = [{ mod: 'flute', source: 'song' }];
  const s = flute({ proof: true, sessions, events: [whole()] });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'wait');
  // A keyboard check or a flute row on another route never counts for the flute.
  assert.equal(flute({ proof: true, sessions, events: [whole({ instrument: 'kbd', input: 'midi' })] }).step, 'check');
  assert.equal(flute({ proof: true, sessions, events: [whole({ input: 'computer-key' })] }).step, 'check');
  const later = whole({ at: NOW - 1000 + DAY_MS });
  assert.equal(flute({ proof: true, sessions, events: [whole(), later], now: NOW + DAY_MS }).action.kind, 'transfer');
  const other = whole({ at: NOW + DAY_MS, songId: 'mary-had-a-little-lamb' });
  assert.equal(flute({ proof: true, sessions, events: [whole(), other], now: NOW + DAY_MS + 5 }).step, 'complete');
});

test('keyboard pathwayState unchanged when no instrument is named', () => {
  const s = pathwayState({ events: [], sessions: [], midiProof: false, level: 3, now: NOW });
  assert.deepEqual(s.action, { kind: 'connect-midi' });
});
