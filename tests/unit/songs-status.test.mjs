// song-status (src/ui/songs/song-status.js): the ledger Songs keeps in
// api.store('song-status') (plain object in DB.panels['song-status'], same
// pattern as api.store('songs-progress') in src/ui/songs.js) recording
// whether a saved song is still an unreviewed Draft or has been Checked.
// Every function here is pure: it takes a ledger and returns a new one, or
// reads one -- the panel owns calling api.store(...).get()/.set(...).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeStatusLedger,
  markDraft,
  markChecked,
  statusFor,
  statusLabel,
  forgetSong,
  reviewGate,
} from '../../src/ui/songs/song-status.js';
import { PANEL_DATA_MAX } from '../../src/ui/panels.js';

test('a new draft records how many notes need checking', () => {
  const ledger = markDraft({}, 'song-1', { needsCheck: 3, source: 'file', originalAudioKept: true });
  const entry = statusFor(ledger, 'song-1');
  assert.equal(entry.draft, true);
  assert.equal(entry.needsCheck, 3);
  assert.equal(entry.source, 'file');
  assert.equal(entry.originalAudioKept, true);
});

test('checking a song clears its draft status', () => {
  const drafted = markDraft({}, 'song-1', { needsCheck: 3, source: 'file', originalAudioKept: true });
  const checked = markChecked(drafted, 'song-1');
  const entry = statusFor(checked, 'song-1');
  assert.equal(entry.draft, false);
  assert.equal(entry.needsCheck, 0);
});

test('a song with no entry has no status', () => {
  assert.equal(statusFor({}, 'nope'), null);
});

test('a broken ledger is cleaned, not thrown', () => {
  assert.deepEqual(sanitizeStatusLedger(null), {});
  assert.deepEqual(sanitizeStatusLedger('nope'), {});
  assert.deepEqual(sanitizeStatusLedger([1, 2, 3]), {});
  const cleaned = sanitizeStatusLedger({
    '__proto__': { draft: true, needsCheck: 1 },
    'good-1': { draft: true, needsCheck: 2, source: 'file', originalAudioKept: true },
    'bad-entry': 'not an object',
    'bad-array': [1, 2],
  });
  assert.deepEqual(Object.keys(cleaned), ['good-1']);
  assert.equal(cleaned['good-1'].needsCheck, 2);
});

test('the label reads in plain words', () => {
  assert.equal(statusLabel({ draft: true, needsCheck: 3 }), 'Draft — 3 notes to check');
  assert.equal(statusLabel({ draft: true, needsCheck: 1 }), 'Draft — 1 note to check');
  assert.equal(statusLabel({ draft: false, needsCheck: 0 }), 'Checked');
  assert.equal(
    statusLabel({ draft: false, needsCheck: 0, originalAudioKept: false }),
    'Checked — Original recording not kept',
  );
  assert.equal(statusLabel(null), '');
});

test('the review gate blocks a song with open checks', () => {
  const blocked = reviewGate(['flagged note']);
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /1 flagged note/);
  const clear = reviewGate([]);
  assert.equal(clear.allowed, true);
  assert.equal(clear.reason, null);
});

test('forgetSong removes a song and leaves the rest untouched', () => {
  let ledger = markDraft({}, 'song-1', { needsCheck: 1, source: 'file', originalAudioKept: true });
  ledger = markDraft(ledger, 'song-2', { needsCheck: 0, source: 'mic', originalAudioKept: false });
  const after = forgetSong(ledger, 'song-1');
  assert.equal(statusFor(after, 'song-1'), null);
  assert.ok(statusFor(after, 'song-2'));
});

test('a ledger stays under the 256 KB panel limit', () => {
  let ledger = {};
  for (let i = 0; i < 1000; i++) {
    ledger = markDraft(ledger, 'song-' + i, { needsCheck: 3, source: 'file', originalAudioKept: true });
  }
  assert.ok(JSON.stringify(ledger).length < PANEL_DATA_MAX);
});
