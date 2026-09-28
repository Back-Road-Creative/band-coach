// E5c: a song step counts as "applied" for a drill skill it uses even when
// the song and the drill never share an instrument|skill group (a drill row
// is 'kbd'/'n64', a song row is 'kbd'/'phrase-slow:0' with songId set) --
// summarizeEvents' native applied rule (learning-events.js:149-159) can never
// see that link on its own. This tests the optional skillMap/skillMapInstrument
// bridge, and the kbd-songs.js map it is meant to be called with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEvents } from '../../src/core/learning-events.js';
import { KBD_SONG_SKILL_MAP } from '../../src/instruments/kbd-songs.js';

const BASE = { v: 1, assistance: 'none', dims: { pitch: 'ok' }, unassessed: [], activeMs: 1 };
const row = (fields) => Object.assign({}, BASE, fields);

test('a drilled note credits a later song play as applied, via skillMap', () => {
  const events = [
    row({ instrument: 'kbd', skill: 'n64', source: 'drill', at: 1 }),
    row({ instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 'hot-cross-buns', at: 2 }),
  ];
  const withMap = summarizeEvents(events, { skillMap: { 'hot-cross-buns': ['n60', 'n62', 'n64'] } });
  assert.equal(withMap.applied, 1);
  const withoutMap = summarizeEvents(events);
  assert.equal(withoutMap.applied, 0);
});

test('a replayed song, or a second step of the same song, only credits applied once', () => {
  const events = [
    row({ instrument: 'kbd', skill: 'n64', source: 'drill', at: 1 }),
    row({ instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 'hot-cross-buns', at: 2 }),
    row({ instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 'hot-cross-buns', at: 3 }),
    row({ instrument: 'kbd', skill: 'pitches:0', source: 'song', songId: 'hot-cross-buns', at: 4 }),
  ];
  const out = summarizeEvents(events, { skillMap: { 'hot-cross-buns': ['n60', 'n62', 'n64'] } });
  assert.equal(out.applied, 1);
});

test('a song played before the drill is not evidence of transfer', () => {
  const events = [
    row({ instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 'hot-cross-buns', at: 1 }),
    row({ instrument: 'kbd', skill: 'n64', source: 'drill', at: 2 }),
  ];
  const out = summarizeEvents(events, { skillMap: { 'hot-cross-buns': ['n60', 'n62', 'n64'] } });
  assert.equal(out.applied, 0);
});

test('a drill attempt that only passed with help is not evidence of transfer', () => {
  const events = [
    row({ instrument: 'kbd', skill: 'n64', source: 'drill', assistance: 'shown', at: 1 }),
    row({ instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 'hot-cross-buns', at: 2 }),
  ];
  const out = summarizeEvents(events, { skillMap: { 'hot-cross-buns': ['n60', 'n62', 'n64'] } });
  assert.equal(out.applied, 0);
});

test('a song row whose pitch was not itself checked ok is not counted (the pitch-ok guard)', () => {
  const events = [
    row({ instrument: 'kbd', skill: 'n64', source: 'drill', at: 1 }),
    row({ instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 'hot-cross-buns', at: 2, dims: { timing: 'ok' } }),
  ];
  const out = summarizeEvents(events, { skillMap: { 'hot-cross-buns': ['n60', 'n62', 'n64'] } });
  assert.equal(out.applied, 0);
});

test('skillMapInstrument restricts the bridge to one instrument; omitted, it applies to all', () => {
  const events = [
    row({ instrument: 'flute', skill: 'n64', source: 'drill', at: 1 }),
    row({ instrument: 'flute', skill: 'phrase-slow:0', source: 'song', songId: 'hot-cross-buns', at: 2 }),
  ];
  const restricted = summarizeEvents(events, { skillMap: { 'hot-cross-buns': ['n60', 'n62', 'n64'] }, skillMapInstrument: 'kbd' });
  assert.equal(restricted.applied, 0);
  const unrestricted = summarizeEvents(events, { skillMap: { 'hot-cross-buns': ['n60', 'n62', 'n64'] } });
  assert.equal(unrestricted.applied, 1);
});

test('drilling all three of a song\'s notes still only credits applied once', () => {
  const events = [
    row({ instrument: 'kbd', skill: 'n60', source: 'drill', at: 1 }),
    row({ instrument: 'kbd', skill: 'n62', source: 'drill', at: 2 }),
    row({ instrument: 'kbd', skill: 'n64', source: 'drill', at: 3 }),
    row({ instrument: 'kbd', skill: 'phrase-slow:0', source: 'song', songId: 'hot-cross-buns', at: 4 }),
  ];
  const out = summarizeEvents(events, { skillMap: { 'hot-cross-buns': ['n60', 'n62', 'n64'] } });
  assert.equal(out.applied, 1);
});

test('KBD_SONG_SKILL_MAP maps hot-cross-buns to its drill note ids', () => {
  assert.deepEqual(KBD_SONG_SKILL_MAP['hot-cross-buns'], ['n60', 'n62', 'n64']);
});

test('the native applied rule (same instrument|skill group) is unaffected by skillMap', () => {
  const events = [
    row({ instrument: 'kbd', skill: 's1', source: 'drill', at: 1 }),
    row({ instrument: 'kbd', skill: 's1', source: 'song', songId: 'song1', at: 2 }),
  ];
  assert.equal(summarizeEvents(events).applied, 1);
  assert.equal(summarizeEvents(events, { skillMap: { 'hot-cross-buns': ['n60', 'n62', 'n64'] } }).applied, 1);
});
