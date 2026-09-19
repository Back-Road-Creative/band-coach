// Every module that produces a Song was written separately against the
// shape in the brief. This test is the one place they all meet the single
// validator, so a producer that drifts from the shape fails here and not in
// front of a learner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSong } from '../../src/song/model.js';
import { starterSongs } from '../../src/song/starter/index.js';
import { importAbc } from '../../src/song/import-abc.js';
import { importMusicXml } from '../../src/song/import-musicxml.js';
import { importMidi } from '../../src/song/import-midi.js';
import { transcribe } from '../../src/song/transcribe.js';
import { halveDurations, repitch, shiftBarline } from '../../src/song/edit.js';

function assertValid(result, label) {
  const song = result && result.song ? result.song : result; // edit ops return a Song or { song, changed }
  const { ok, errors } = validateSong(song);
  assert.ok(ok, label + ' is not a valid song: ' + errors.join('; '));
}

test('every starter tune passes the song validator', () => {
  assert.ok(starterSongs.length > 0);
  starterSongs.forEach(song => assertValid(song, 'starter tune ' + song.id));
});

test('an ABC import passes the song validator', () => {
  const { song } = importAbc('X:1\nT:Scale\nM:3/4\nL:1/8\nK:G\nG |: GABcde | (3fgf e2 d2 :|\n');
  assertValid(song, 'ABC import');
});

test('a MusicXML import passes the song validator', () => {
  const note = (step, octave) => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type></note>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Tune</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    ${note('G', 4)}${note('A', 4)}${note('B', 4)}${note('C', 5)}
  </measure></part>
</score-partwise>`;
  const { song } = importMusicXml(xml);
  assertValid(song, 'MusicXML import');
});

test('a MIDI import passes the song validator', () => {
  const str = s => [...s].map(c => c.charCodeAt(0));
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const events = [0, 0x90, 60, 80, 0x83, 0x60, 0x80, 60, 64, 0, 0x90, 64, 80, 0x83, 0x60, 0x80, 64, 64, 0, 0xff, 0x2f, 0];
  const bytes = new Uint8Array([...str('MThd'), ...u32(6), 0, 0, 0, 1, 0x01, 0xe0, ...str('MTrk'), ...u32(events.length), ...events]);
  const { song } = importMidi(bytes, { fileName: 'two-notes.mid' });
  assert.equal(song.parts[0].notes.length, 2);
  assertValid(song, 'MIDI import');
});

test('a mic transcription passes the song validator, with and without notes', () => {
  const frames = [];
  [60, 62, 64, 65].forEach((midi, i) => {
    for (let k = 0; k < 40; k++) frames.push({ t: i * 0.5 + k * 0.01, midi: midi, rms: 0.2, confidence: 0.9 });
  });
  assertValid(transcribe(frames, {}).song, 'transcription');
  assertValid(transcribe([], {}).song, 'empty transcription');
});

test('an edited song still passes the song validator', () => {
  const tune = starterSongs[0];
  assertValid(halveDurations(tune), 'halved tune');
  assertValid(repitch(tune, 0, 0, { octaves: 1 }), 'repitched tune');
  assertValid(shiftBarline(tune, 480), 'tune with a pickup');
});
