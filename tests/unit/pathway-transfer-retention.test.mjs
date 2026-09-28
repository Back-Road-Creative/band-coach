// P3: past 'return', the pathway asks for two more pieces of evidence -- a
// transfer song (a different starter song than the one the first
// independent check passed on, played the same way) and, from a day later,
// that the original check still holds. Both count only rows with input
// 'midi' and assistance 'none' -- the same qualifying rule 'return' already
// uses -- so this file proves the two new evaluators src/core/pathway.js
// adds, plus kbd-pathway.js's transfer-song choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pathwayState, DAY_MS } from '../../src/core/pathway.js';
import { transferSongFor } from '../../src/instruments/kbd-pathway.js';

const NOW = 1_700_000_000_000;
const CHECK_SONG = 'mary-had-a-little-lamb';
const TRANSFER_SONG = 'ode-to-joy';

function whole(over) {
  return Object.assign({
    instrument: 'kbd', skill: 'whole:null', source: 'song', input: 'midi', assistance: 'none',
    songId: CHECK_SONG, dims: { pitch: 'ok', rhythm: 'ok' }, at: NOW - DAY_MS - 1000,
  }, over);
}

test('a qualifying check row plus a qualifying midi check-mode row on a different song, a day later -> complete', () => {
  const checkRow = whole({ at: NOW - DAY_MS });
  const transferRow = whole({ songId: TRANSFER_SONG, at: NOW });
  const s = pathwayState({ events: [checkRow, transferRow], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'complete');
  assert.equal(s.action.kind, 'complete');
  assert.equal(s.checkAt, checkRow.at);
  assert.equal(s.transferAt, transferRow.at);
  assert.equal(s.transferSongId, TRANSFER_SONG);
});

test('a transfer-song row before a day has passed does not complete it -- still return, wait', () => {
  const checkRow = whole({ at: NOW - 1000 });
  const transferRow = whole({ songId: TRANSFER_SONG, at: NOW });
  const s = pathwayState({ events: [checkRow, transferRow], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'wait');
});

test('a day has passed but no transfer-song row yet -- still return, recheck', () => {
  const checkRow = whole({ at: NOW - DAY_MS - 1000 });
  const s = pathwayState({ events: [checkRow], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'recheck');
});

test('a computer-key row on the transfer song, a day later, does not advance it', () => {
  const checkRow = whole({ at: NOW - DAY_MS });
  const transferRow = whole({ songId: TRANSFER_SONG, at: NOW, input: 'computer-key' });
  const s = pathwayState({ events: [checkRow, transferRow], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'recheck');
});

test('an unknown-input row (no input field) on the transfer song, a day later, does not advance it', () => {
  const checkRow = whole({ at: NOW - DAY_MS });
  const transferRow = whole({ songId: TRANSFER_SONG, at: NOW });
  delete transferRow.input;
  const s = pathwayState({ events: [checkRow, transferRow], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'recheck');
});

test('a second qualifying row on the SAME song does not count as a transfer -- it just refreshes the wait/recheck date', () => {
  const checkRow = whole({ at: NOW - DAY_MS });
  const sameSongRow = whole({ songId: CHECK_SONG, at: NOW });
  const s = pathwayState({ events: [checkRow, sameSongRow], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'wait');
  assert.equal(s.action.dueAt, NOW + DAY_MS);
});

test('an assisted midi row on the transfer song does not count', () => {
  const checkRow = whole({ at: NOW - DAY_MS });
  const transferRow = whole({ songId: TRANSFER_SONG, at: NOW, assistance: 'shown' });
  const s = pathwayState({ events: [checkRow, transferRow], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'recheck');
});

test('transferSongFor(level, excludeSongId): the next unlocked starter song other than the excluded one', () => {
  const entry = transferSongFor(3, CHECK_SONG);
  assert.ok(entry, 'expected a transfer song entry');
  assert.notEqual(entry.songId, CHECK_SONG);
  assert.equal(entry.songId, TRANSFER_SONG);
});

test('transferSongFor(level, excludeSongId): null when nothing else is unlocked yet', () => {
  const entry = transferSongFor(1, 'hot-cross-buns');
  assert.equal(entry, null);
});
