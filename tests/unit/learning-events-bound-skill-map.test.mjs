// A song row that counts as "applied" ONLY through learning-events.js's
// skillMap bridge (its own skill is a step id like 'phrase-slow:0', never
// sharing an instrument|skill group with the drill skill the map credits it
// against) must survive history trimming the same way a native-rule song row
// already does -- boundEvents (below summarizeEvents in that file) has to
// apply the exact same map/qualifies rule when deciding what to keep, or
// Progress's "Applied in a song" count silently drops once history passes
// EVENT_HISTORY_MAX rows, with nothing in the UI ever saying so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_VERSION, summarizeEvents, boundEvents } from '../../src/core/learning-events.js';
import { KBD_SONG_SKILL_MAP } from '../../src/instruments/kbd-songs.js';

function row(overrides) {
  return Object.assign({
    v: EVENT_VERSION, id: 'a', at: 1, instrument: 'kbd', skill: 'n4', source: 'drill',
    assistance: 'none', dims: { pitch: 'ok' }, unassessed: [], activeMs: 400,
  }, overrides);
}

test('a song row credited only through skillMap survives trimming: applied count matches the untrimmed history', () => {
  // Two plays of the SAME song step id ('phrase-slow:0', its own group, which
  // never gets a non-song-ok row of its own): the first play is BEFORE the
  // mapped drill success (does not qualify), the second is AFTER it (does).
  // The plain per-group "earliest independent-ok" anchor keeps only the
  // FIRST of these two -- the one that never counted -- and drops the one
  // that actually earned the credit, unless boundEvents applies the same
  // skillMap/qualifies rule summarizeEvents does.
  const skillMap = { s1: ['n64'] };
  const songEarly = row({ id: 'song-early', at: 0, instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 's1', dims: { pitch: 'ok' } });
  const drill = row({ id: 'drill', at: 1, instrument: 'kbd', skill: 'n64', source: 'drill' });
  const songLate = row({ id: 'song-late', at: 2, instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 's1', dims: { pitch: 'ok' } });
  const filler = [];
  for (let i = 0; i < 600; i++) filler.push(row({ id: 'f' + i, at: 10 + i, instrument: 'kbd', skill: 'n99', dims: { pitch: 'miss' } }));
  const full = [songEarly, drill, songLate, ...filler];
  const opts = { skillMap, skillMapInstrument: 'kbd' };

  const fullSummary = summarizeEvents(full, opts);
  assert.equal(fullSummary.applied, 1, 'sanity: the later replay does count as applied in the untrimmed history');

  const trimmed = boundEvents(full, opts);
  const trimmedSummary = summarizeEvents(trimmed, opts);
  assert.equal(trimmedSummary.applied, fullSummary.applied);
});

test('the same, with the real KBD_SONG_SKILL_MAP and a real starter-song id', () => {
  const notes = KBD_SONG_SKILL_MAP['hot-cross-buns'];
  assert.ok(Array.isArray(notes) && notes.length > 0, 'sanity: the real map has an entry for hot-cross-buns');
  const songEarly = row({ id: 'song-early', at: 0, instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 'hot-cross-buns', dims: { pitch: 'ok' } });
  const drill = row({ id: 'drill', at: 1, instrument: 'kbd', skill: notes[0], source: 'drill' });
  const songLate = row({ id: 'song-late', at: 2, instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 'hot-cross-buns', dims: { pitch: 'ok' } });
  const filler = [];
  for (let i = 0; i < 600; i++) filler.push(row({ id: 'f' + i, at: 10 + i, instrument: 'kbd', skill: 'n999', dims: { pitch: 'miss' } }));
  const full = [songEarly, drill, songLate, ...filler];

  const opts = { skillMap: KBD_SONG_SKILL_MAP, skillMapInstrument: 'kbd' };
  const fullSummary = summarizeEvents(full, opts);
  assert.equal(fullSummary.applied, 1);

  const trimmed = boundEvents(full, opts);
  const trimmedSummary = summarizeEvents(trimmed, opts);
  assert.equal(trimmedSummary.applied, fullSummary.applied);
});

test('a song row that can never qualify (played before any drill success) never turns into a false "applied" after trimming', () => {
  // Neither replay of the song ever lands after the mapped drill's success,
  // so neither ever counts -- trimming must not manufacture a credit that
  // was never earned, however the anchor bookkeeping decides to spend its
  // budget on these dropped rows.
  const skillMap = { s1: ['n64'] };
  const songEarly = row({ id: 'song-early', at: 0, instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 's1', dims: { pitch: 'ok' } });
  const songStill = row({ id: 'song-still-early', at: 1, instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 's1', dims: { pitch: 'ok' } });
  const drill = row({ id: 'drill', at: 2, instrument: 'kbd', skill: 'n64', source: 'drill' });
  const filler = [];
  for (let i = 0; i < 600; i++) filler.push(row({ id: 'f' + i, at: 10 + i, instrument: 'kbd', skill: 'n99', dims: { pitch: 'miss' } }));
  const full = [songEarly, songStill, drill, ...filler];
  const opts = { skillMap, skillMapInstrument: 'kbd' };

  const fullSummary = summarizeEvents(full, opts);
  assert.equal(fullSummary.applied, 0, 'sanity: both plays came before the drill, so neither ever counted');

  const trimmed = boundEvents(full, opts);
  const trimmedSummary = summarizeEvents(trimmed, opts);
  assert.equal(trimmedSummary.applied, fullSummary.applied);
});

test('control: with no skillMap option, boundEvents output is unchanged from today\'s behaviour', () => {
  const first = row({ id: 'first', at: 0, instrument: 'kbd', skill: 'n60', source: 'drill' });
  const filler = [];
  for (let i = 0; i < 600; i++) filler.push(row({ id: 'f' + i, at: 10 + i, instrument: 'kbd', skill: 'n62', dims: { pitch: 'miss' } }));
  const events = [first, ...filler];
  const trimmed = boundEvents(events);
  assert.equal(trimmed.length, 501);
  assert.equal(trimmed[0].id, 'first');
  assert.deepEqual(trimmed.map((ev) => ev.id), ['first', ...events.slice(-500).map((ev) => ev.id)]);
});
