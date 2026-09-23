import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importGp7 } from '../../src/song/import-gp7.js';
import { validateSong } from '../../src/song/model.js';

// Real Guitar Pro 7 files, not self-authored fixtures: tests/unit/import-gp7.test.mjs
// only proves the importer against a hand-written score.gpif, which can't catch a
// shape a real Guitar Pro export uses that our fixture never happened to include.
// See tests/fixtures/gp7/README.md for source/licence.
//
// Expected values below were read directly from each file's Content/score.gpif via
// `unzip -p tests/fixtures/gp7/<file>.gp Content/score.gpif`, independent of
// import-gp7.js -- never derived from the importer's own output.

function loadFixture(name) {
  const path = fileURLToPath(new URL(`../fixtures/gp7/${name}`, import.meta.url));
  return readFileSync(path);
}

test('score-info.gp: title/artist/tempo/tuning/GM program read from a real GP7 export', () => {
  // gpif: <Score><Title><![CDATA[Title]]></Title> ... <Artist><![CDATA[Artist]]>
  // <MasterTrack><Automations><Automation><Type>Tempo</Type><Bar>0</Bar>
  //   <Value>120 2</Value> -> bpm 120
  // <Track id="0"> and id="1">: <Staves><Staff><Properties><Property name="Tuning">
  //   <Pitches>40 45 50 55 59 64</Pitches> (standard 6-string tuning) on both tracks
  // Neither track has a <GeneralMidi> element (that element does not exist anywhere
  // in this file) -- the GM program is instead under
  // <Sounds><Sound><Role>User</Role><MIDI><Program>25</Program></MIDI></Sound>
  const { song, warnings } = importGp7(loadFixture('score-info.gp'), { fileName: 'score-info.gp' });
  assert.equal(song.title, 'Title');
  assert.equal(song.composer, 'Artist');
  assert.equal(song.bpm, 120);
  assert.equal(song.parts.length, 2);
  assert.equal(song.parts[0].name, 'Track 1');
  assert.equal(song.parts[1].name, 'Track 2');
  // Real files carry GM program under Sounds/Sound/MIDI/Program, not the
  // <GeneralMidi> element the importer previously only looked for.
  assert.equal(song.parts[0].instrumentHint, 'General MIDI program 25');
  const { ok, errors } = validateSong(song);
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
  assert.deepEqual(warnings, []);
});

test('time-signatures.gp: a MasterBar restating the same time signature is not a spurious metreChanges entry', () => {
  // gpif: 6 <MasterBar> elements, each restating <Time>: 4/4, 3/4, 2/4, 1/4,
  // 20/32, 20/32 (the 6th repeats the 5th unchanged).
  // Bar start ticks (TICKS_PER_QUARTER=480, ticks = num*(4/den)*480):
  //   bar0 4/4=1920 tick@0; bar1 3/4=1440 tick@1920; bar2 2/4=960 tick@3360;
  //   bar3 1/4=480 tick@4320; bar4 20/32=1200 tick@4800; bar5 20/32 tick@6000 (no change)
  const { song } = importGp7(loadFixture('time-signatures.gp'), { fileName: 'time-signatures.gp' });
  assert.deepEqual(song.metre, { num: 4, den: 4 });
  assert.deepEqual(song.metreChanges, [
    { tick: 1920, num: 3, den: 4 },
    { tick: 3360, num: 2, den: 4 },
    { tick: 4320, num: 1, den: 4 },
    { tick: 4800, num: 20, den: 32 },
  ]);
});

test('notes.gp: real String/Fret notes carry an explicit Midi property the importer must prefer', () => {
  // gpif: single track, single bar (4/4), one voice with 35 beats.
  // <Rhythms>: id 0 = Whole (1920 ticks), id 1 = Half (960 ticks), no tuplets/dots.
  // First 4 beats (ids 0-3) each reference Rhythm 0 (Whole) and one note each
  // (ids 0-3); beat 4 (Rhythm 0) has no <Notes> (a rest). Each <Note> carries
  // both a String/Fret pair AND an explicit <Property name="Midi"><Number>:
  //   note 0: String 0, Fret 1, Midi 41 (F3)
  //   note 1: String 0, Fret 2, Midi 42 (F#3)
  //   note 2: String 0, Fret 3, Midi 43 (G3)
  //   note 3: String 0, Fret 4, Midi 44 (G#3)
  // Track tuning: <Pitches>40 45 50 55 59 64</Pitches> -> tuning[0]=40, so
  // String/Fret math alone would also give 40+1=41 etc; this only proves the
  // importer reads a real file's explicit Midi property without choking on
  // the extra String/Fret data sitting alongside it.
  const { song } = importGp7(loadFixture('notes.gp'), { fileName: 'notes.gp' });
  const notes = song.parts[0].notes.slice(0, 4);
  assert.deepEqual(notes.map((n) => n.midi), [41, 42, 43, 44]);
  assert.deepEqual(notes.map((n) => n.start), [0, 1920, 3840, 5760]);
  assert.deepEqual(notes.map((n) => n.dur), [1920, 1920, 1920, 1920]);
  const { ok, errors } = validateSong(song);
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
});
