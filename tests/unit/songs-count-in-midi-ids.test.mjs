// Unit coverage for three pure helpers behind N2 (src/ui/songs.js):
//  - countInFor(): the click schedule for the four-beat count-in every
//    "Your turn" try now plays before it starts listening.
//  - pushMidiEvent()/closeOpenMidiEvents(): a MIDI note now carries a real
//    durSec, closed by the next same-note press or by the end of the try.
//  - withStoredIds(): a challenge/band-pack import reconciles library.add()'s
//    actually-assigned ids (collision-renamed to song-2, song-3, ...) back
//    onto the songs it shows afterward, instead of the ids the file carried.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countInFor, pushMidiEvent, closeOpenMidiEvents, withStoredIds } from '../../src/ui/songs.js';
import { DEFAULT_BPM, MIN_BPM, MAX_BPM } from '../../src/ui/learn/count-in.js';
import { createLibrary, memoryStore } from '../../src/song/library.js';

test('countInFor: a timed step counts in at its own effective bpm, four beats from 0', () => {
  const { bpm, times } = countInFor({ kind: 'phrase-slow', bpm: 120 }, 120);
  assert.equal(bpm, 120);
  assert.equal(times.length, 4);
  assert.deepEqual(times, [0, 0.5, 1, 1.5]);
});

test('countInFor: an untimed step (bpm 0, e.g. "pitches") falls back to DEFAULT_BPM', () => {
  const { bpm, times } = countInFor({ kind: 'pitches', bpm: 0 }, 0);
  assert.equal(bpm, DEFAULT_BPM);
  assert.equal(times.length, 4);
});

test('countInFor: a rhythm step counts in the same way as any other timed step', () => {
  const { bpm, times } = countInFor({ kind: 'rhythm', bpm: 100 }, 100);
  assert.equal(bpm, 100);
  assert.equal(times.length, 4);
});

test('countInFor: the effective bpm is clamped the same way the learn-panel count-in is', () => {
  const { bpm } = countInFor({ kind: 'phrase-slow', bpm: 400 }, 400);
  assert.equal(bpm, MAX_BPM);
  const low = countInFor({ kind: 'phrase-slow', bpm: 10 }, 10);
  assert.equal(low.bpm, MIN_BPM);
});

test('pushMidiEvent: two presses of the same note 0.5s apart close the first one at that gap', () => {
  const events = [];
  pushMidiEvent(events, 60, 0);
  pushMidiEvent(events, 60, 0.5);
  assert.equal(events.length, 2);
  assert.ok(Math.abs(events[0].durSec - 0.5) < 1e-9, 'first event closed at the second press: ' + events[0].durSec);
  assert.equal(events[1].durSec, null, 'the still-open second event has no durSec yet');
});

test('pushMidiEvent: a different note in between does not close the first note early', () => {
  const events = [];
  pushMidiEvent(events, 60, 0);
  pushMidiEvent(events, 64, 0.2);
  pushMidiEvent(events, 60, 0.7);
  assert.equal(events[0].durSec, 0.7, 'note 60 closed only by its own next press, not by note 64 in between');
  assert.equal(events[1].durSec, null);
});

test('closeOpenMidiEvents: closes whatever is still open when the try ends', () => {
  const events = [];
  pushMidiEvent(events, 60, 0);
  pushMidiEvent(events, 60, 0.5);
  pushMidiEvent(events, 62, 0.6);
  closeOpenMidiEvents(events, 1.2);
  assert.equal(events[0].durSec, 0.5, 'already closed by the second press of the same note, unaffected by finish');
  assert.equal(events[1].durSec, 0.7, 'still-open note 60 closed at the end of the try (1.2 - 0.5)');
  assert.equal(events[2].durSec, 0.6, 'still-open note 62 closed at the end of the try (1.2 - 0.6)');
});

test('withStoredIds: a song whose id collided in the library is reconciled to the id actually stored', async () => {
  const library = createLibrary(memoryStore());
  await library.add({ schema: 'song/1', id: 'song-1', title: 'First', composer: null, licence: null, source: null, key: null, metre: { num: 4, den: 4 }, bpm: 90, ticksPerQuarter: 480, parts: [], chords: [] }, { now: 1 });
  const incoming = [
    { schema: 'song/1', id: 'song-1', title: 'Collides', composer: null, licence: null, source: null, key: null, metre: { num: 4, den: 4 }, bpm: 90, ticksPerQuarter: 480, parts: [], chords: [] },
    { schema: 'song/1', id: 'song-9', title: 'No collision', composer: null, licence: null, source: null, key: null, metre: { num: 4, den: 4 }, bpm: 90, ticksPerQuarter: 480, parts: [], chords: [] },
  ];
  const storedIds = [];
  for (const s of incoming) storedIds.push(await library.add(s, { now: 2 }));
  assert.equal(storedIds[0], 'song-1-2', 'the colliding song was reassigned by library.add()');
  assert.equal(storedIds[1], 'song-9');
  const reconciled = withStoredIds(incoming, storedIds);
  assert.equal(reconciled[0].id, 'song-1-2', 'reconciled song now carries the id actually stored');
  assert.equal(reconciled[0].title, 'Collides', 'nothing else about the song changed');
  assert.equal(reconciled[1].id, 'song-9', 'a song with no collision keeps its own id, same object shape');
});
