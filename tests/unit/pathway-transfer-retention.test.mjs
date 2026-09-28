// P3: past 'return', the pathway asks for two more pieces of evidence --
// retained (any qualifying row, at/after a day since the first independent
// check) and transfer (a qualifying row on a DIFFERENT song than that
// first check, any time after it). Both count only rows with input 'midi'
// and assistance 'none' -- the same qualifying rule 'return' already uses.
// Either piece of evidence landing alone keeps 'return' going (with a
// different action); only both together give 'complete'. This file proves
// those evaluators in src/core/pathway.js, plus kbd-pathway.js's
// transfer-song choice.
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
  assert.equal(s.retainedAt, transferRow.at, 'the transfer row itself proves retention too -- it landed at/after dueAt');
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

test('a transfer-song row landing before dueAt, with nothing after it, never completes -- still return, recheck once the day passes', () => {
  const checkRow = whole({ at: NOW - 2 * DAY_MS });
  const earlyTransferRow = whole({ songId: TRANSFER_SONG, at: checkRow.at + 3600 * 1000 }); // an hour after the check, well before dueAt
  const s = pathwayState({ events: [checkRow, earlyTransferRow], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return', 'a transfer row alone, with no row at/after dueAt, is not retained evidence');
  assert.equal(s.action.kind, 'recheck');
});

test('a same-song recheck at exactly dueAt sets retainedAt without moving dueAt (the anchor stays fixed)', () => {
  const checkRow = whole({ at: NOW - DAY_MS });
  const dueAt = checkRow.at + DAY_MS;
  const sameSongRecheck = whole({ songId: CHECK_SONG, at: dueAt });
  const s = pathwayState({ events: [checkRow, sameSongRecheck], sessions: [], midiProof: true, level: 3, now: dueAt });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'transfer', 'retained but not transferred -- offer the transfer song, not another recheck');
  assert.equal(s.checkAt, checkRow.at, 'the anchor -- and so dueAt -- never moves for a same-song recheck');
  assert.equal(s.retainedAt, sameSongRecheck.at);
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

test('a second qualifying row on the SAME song does not count as a transfer -- once at/after dueAt it is retained, offering the transfer song next', () => {
  const checkRow = whole({ at: NOW - DAY_MS });
  const sameSongRow = whole({ songId: CHECK_SONG, at: NOW });
  const s = pathwayState({ events: [checkRow, sameSongRow], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'transfer');
  assert.equal(s.checkAt, checkRow.at);
  assert.equal(s.retainedAt, sameSongRow.at);
});

test('an assisted midi row on the transfer song does not count', () => {
  const checkRow = whole({ at: NOW - DAY_MS });
  const transferRow = whole({ songId: TRANSFER_SONG, at: NOW, assistance: 'shown' });
  const s = pathwayState({ events: [checkRow, transferRow], sessions: [], midiProof: true, level: 3, now: NOW });
  assert.equal(s.step, 'return');
  assert.equal(s.action.kind, 'recheck');
});

test('transferSongFor(level, anchorSongId, seenSongIds): the next unlocked starter song, excluding every seen song plus the anchor', () => {
  const entry = transferSongFor(3, CHECK_SONG, []);
  assert.ok(entry, 'expected a transfer song entry');
  assert.notEqual(entry.songId, CHECK_SONG);
  assert.equal(entry.songId, TRANSFER_SONG);
});

test('transferSongFor: a song already seen (per seenSongIds) is skipped even though it is otherwise unlocked', () => {
  const entry = transferSongFor(3, CHECK_SONG, [TRANSFER_SONG]);
  assert.ok(entry);
  assert.notEqual(entry.songId, TRANSFER_SONG);
  assert.notEqual(entry.songId, CHECK_SONG);
});

test('transferSongFor: falls back to excluding only the anchor when every unlocked song has been seen', () => {
  const entry = transferSongFor(3, CHECK_SONG, ['hot-cross-buns', 'au-clair-de-la-lune', TRANSFER_SONG]);
  assert.ok(entry, 'expected a fallback song even though everything unlocked has been seen');
  assert.notEqual(entry.songId, CHECK_SONG);
});

test('transferSongFor: null when nothing is unlocked at all, not even the anchor', () => {
  const entry = transferSongFor(1, 'hot-cross-buns', []);
  assert.equal(entry, null);
});
