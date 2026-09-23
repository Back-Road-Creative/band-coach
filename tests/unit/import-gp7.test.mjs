import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importGp7 } from '../../src/song/import-gp7.js';
import { validateSong } from '../../src/song/model.js';

// Self-authored fixtures: a hand-written minimal score.gpif (Guitar Pro 7/8's
// internal XML), zipped with the same tiny stored/deflate zip writer used by
// tests/unit/unzip-lite.test.mjs and tests/unit/import-mxl.test.mjs (kept
// local here too, so this file stands alone as a proof of the import path).

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

function buildZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const stored = f.data;
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(stored.length), u32(f.data.length),
      u16(nameBuf.length), u16(0),
      nameBuf,
    ]);
    const localOffset = offset;
    localChunks.push(localHeader, stored);
    offset += localHeader.length + stored.length;

    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(stored.length), u32(f.data.length),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(localOffset),
      nameBuf,
    ]);
    centralChunks.push(centralHeader);
  }
  const centralStart = offset;
  const central = Buffer.concat(centralChunks);
  offset += central.length;
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(centralStart), u16(0),
  ]);
  return new Uint8Array(Buffer.concat([...localChunks, central, eocd]));
}

// 2 tracks (Guitar, Bass), 3 bars: bar 0 is 4/4 with a key of C major, bar 1
// carries the 4/4 forward with nothing re-stated, bar 2 switches to 3/4 (the
// time-signature change). Track 0 (Guitar) ties a quarter note into a dotted
// quarter of the same pitch across beats 0-1, rests a quarter in beat 2, then
// a chord (two notes on one beat) in beat 3; bar 1 is a whole rest; bar 2 is
// a single dotted-half note. Track 1 (Bass) mirrors the bar/rest shape with
// its own tuning and pitches. Two tempo automations (120 at bar 0, 90 at
// bar 2) exercise the tempoMap.
const SCORE_GPIF = `<?xml version="1.0" encoding="UTF-8"?>
<GPIF>
  <Score>
    <Title>Test Tune</Title>
    <Artist>Test Artist</Artist>
  </Score>
  <MasterTrack>
    <Automations>
      <Automation>
        <Type>Tempo</Type>
        <Bar>0</Bar>
        <Position>0</Position>
        <Value>120 2</Value>
      </Automation>
      <Automation>
        <Type>Tempo</Type>
        <Bar>2</Bar>
        <Position>0</Position>
        <Value>90 2</Value>
      </Automation>
    </Automations>
    <Tracks>0 1</Tracks>
  </MasterTrack>
  <Tracks>
    <Track id="0">
      <Name>Guitar</Name>
      <GeneralMidi><Program>25</Program></GeneralMidi>
      <Staves><Staff><Properties><Property name="Tuning"><Pitches>64 59 55 50 45 40</Pitches></Property></Properties></Staff></Staves>
    </Track>
    <Track id="1">
      <Name>Bass</Name>
      <GeneralMidi><Program>33</Program></GeneralMidi>
      <Staves><Staff><Properties><Property name="Tuning"><Pitches>43 38 33 28</Pitches></Property></Properties></Staff></Staves>
    </Track>
  </Tracks>
  <MasterBars>
    <MasterBar>
      <Time>4/4</Time>
      <Key><AccidentalCount>0</AccidentalCount><Mode>Major</Mode></Key>
      <Bars>0 1</Bars>
    </MasterBar>
    <MasterBar>
      <Bars>2 3</Bars>
    </MasterBar>
    <MasterBar>
      <Time>3/4</Time>
      <Bars>4 5</Bars>
    </MasterBar>
  </MasterBars>
  <Bars>
    <Bar id="0"><Voices>0 -1 -1 -1</Voices></Bar>
    <Bar id="1"><Voices>1 -1 -1 -1</Voices></Bar>
    <Bar id="2"><Voices>2 -1 -1 -1</Voices></Bar>
    <Bar id="3"><Voices>3 -1 -1 -1</Voices></Bar>
    <Bar id="4"><Voices>4 -1 -1 -1</Voices></Bar>
    <Bar id="5"><Voices>5 -1 -1 -1</Voices></Bar>
  </Bars>
  <Voices>
    <Voice id="0"><Beats>0 1 2 3</Beats></Voice>
    <Voice id="1"><Beats>4</Beats></Voice>
    <Voice id="2"><Beats>5</Beats></Voice>
    <Voice id="3"><Beats>6</Beats></Voice>
    <Voice id="4"><Beats>7</Beats></Voice>
    <Voice id="5"><Beats>8</Beats></Voice>
  </Voices>
  <Beats>
    <Beat id="0"><Rhythm ref="0"/><Notes>0</Notes></Beat>
    <Beat id="1"><Rhythm ref="1"/><Notes>1</Notes></Beat>
    <Beat id="2"><Rhythm ref="0"/></Beat>
    <Beat id="3"><Rhythm ref="2"/><Notes>2 3</Notes></Beat>
    <Beat id="4"><Rhythm ref="3"/><Notes>4</Notes></Beat>
    <Beat id="5"><Rhythm ref="3"/></Beat>
    <Beat id="6"><Rhythm ref="3"/></Beat>
    <Beat id="7"><Rhythm ref="4"/><Notes>5</Notes></Beat>
    <Beat id="8"><Rhythm ref="4"/><Notes>6</Notes></Beat>
  </Beats>
  <Notes>
    <Note id="0"><Properties><Property name="String"><String>0</String></Property><Property name="Fret"><Fret>0</Fret></Property></Properties><Tie type="start"/></Note>
    <Note id="1"><Properties><Property name="String"><String>0</String></Property><Property name="Fret"><Fret>0</Fret></Property></Properties><Tie type="end"/></Note>
    <Note id="2"><Properties><Property name="String"><String>1</String></Property><Property name="Fret"><Fret>2</Fret></Property></Properties></Note>
    <Note id="3"><Properties><Property name="String"><String>2</String></Property><Property name="Fret"><Fret>0</Fret></Property></Properties></Note>
    <Note id="4"><Properties><Property name="String"><String>0</String></Property><Property name="Fret"><Fret>2</Fret></Property></Properties></Note>
    <Note id="5"><Properties><Property name="String"><String>0</String></Property><Property name="Fret"><Fret>4</Fret></Property></Properties></Note>
    <Note id="6"><Properties><Property name="String"><String>1</String></Property><Property name="Fret"><Fret>0</Fret></Property></Properties></Note>
  </Notes>
  <Rhythms>
    <Rhythm id="0"><NoteValue>Quarter</NoteValue></Rhythm>
    <Rhythm id="1"><NoteValue>Quarter</NoteValue><AugmentationDot count="1"/></Rhythm>
    <Rhythm id="2"><NoteValue>Eighth</NoteValue></Rhythm>
    <Rhythm id="3"><NoteValue>Whole</NoteValue></Rhythm>
    <Rhythm id="4"><NoteValue>Half</NoteValue><AugmentationDot count="1"/></Rhythm>
  </Rhythms>
</GPIF>`;

function buildGpZip(gpif) {
  return buildZip([{ name: 'Content/score.gpif', data: Buffer.from(gpif, 'utf8') }]);
}

test('a .gp file imports title, artist, tempo, key, two tracks and their notes', () => {
  const { song, warnings } = importGp7(buildGpZip(SCORE_GPIF), { fileName: 'tune.gp' });
  assert.equal(song.title, 'Test Tune');
  assert.equal(song.composer, 'Test Artist');
  assert.equal(song.bpm, 120);
  assert.deepEqual(song.key, { tonic: 0, mode: 'major' });
  assert.deepEqual(song.metre, { num: 4, den: 4 });
  assert.equal(song.parts.length, 2);
  assert.equal(song.parts[0].name, 'Guitar');
  assert.equal(song.parts[1].name, 'Bass');
  assert.deepEqual(warnings, []);
  const { ok, errors } = validateSong(song);
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
});

test('a time-signature change becomes a metreChanges entry at the bar it starts', () => {
  const { song } = importGp7(buildGpZip(SCORE_GPIF));
  assert.deepEqual(song.metreChanges, [{ tick: 3840, num: 3, den: 4 }]);
});

test('a later tempo automation becomes a tempoMap entry, the first stays the initial bpm', () => {
  const { song } = importGp7(buildGpZip(SCORE_GPIF));
  assert.deepEqual(song.tempoMap, [{ tick: 3840, bpm: 90 }]);
});

test('a dotted note (AugmentationDot) gets 1.5x its base duration', () => {
  const { song } = importGp7(buildGpZip(SCORE_GPIF));
  const guitar = song.parts[0].notes;
  // note 1 (id "1"): dotted quarter tied from the quarter before it (note 0)
  const tied = guitar.find((n) => n.tieFromPrev === true);
  assert.ok(tied, 'expected a tied note');
  assert.equal(tied.dur, 720); // 480 * 1.5
  assert.equal(tied.midi, 64);
});

test('a tie links two same-pitch notes into one held note, and a rest advances the cursor without adding a note', () => {
  const { song } = importGp7(buildGpZip(SCORE_GPIF));
  const guitar = song.parts[0].notes;
  assert.equal(guitar[0].start, 0);
  assert.equal(guitar[0].dur, 480);
  assert.equal(guitar[0].midi, 64);
  assert.equal(guitar[1].start, 480);
  assert.equal(guitar[1].tieFromPrev, true);
  // beat 2 (a quarter rest) contributes no note, so the chord in beat 3
  // starts a full rest-quarter after the tied note ends (1200 + 480 = 1680)
  const chordNotes = guitar.filter((n) => n.start === 1680);
  assert.equal(chordNotes.length, 2);
  assert.deepEqual(chordNotes.map((n) => n.midi).sort((a, b) => a - b), [55, 61]);
});

test('String/Fret notes resolve to MIDI pitch via the track\'s tuning', () => {
  const { song } = importGp7(buildGpZip(SCORE_GPIF));
  const bass = song.parts[1].notes;
  assert.equal(bass[0].midi, 45); // tuning[0]=43 + fret 2
  assert.equal(bass[0].start, 0);
  assert.equal(bass[0].dur, 1920);
  const last = bass[bass.length - 1];
  assert.equal(last.midi, 38); // tuning[1]=38 + fret 0
  assert.equal(last.dur, 1440); // dotted half, 3/4 bar
});

test('a bar in a track with no explicit tempo has 120bpm defaulted and a warning', () => {
  const gpif = `<?xml version="1.0"?><GPIF><Score><Title>No Tempo</Title></Score>
    <Tracks><Track id="0"><Name>Solo</Name>
      <Staves><Staff><Properties><Property name="Tuning"><Pitches>64 59 55 50 45 40</Pitches></Property></Properties></Staff></Staves>
    </Track></Tracks>
    <MasterBars><MasterBar><Bars>0</Bars></MasterBar></MasterBars>
    <Bars><Bar id="0"><Voices>0 -1 -1 -1</Voices></Bar></Bars>
    <Voices><Voice id="0"><Beats>0</Beats></Voice></Voices>
    <Beats><Beat id="0"><Rhythm ref="0"/><Notes>0</Notes></Beat></Beats>
    <Notes><Note id="0"><Properties><Property name="String"><String>0</String></Property><Property name="Fret"><Fret>0</Fret></Property></Properties></Note></Notes>
    <Rhythms><Rhythm id="0"><NoteValue>Quarter</NoteValue></Rhythm></Rhythms>
  </GPIF>`;
  const { song, warnings } = importGp7(buildGpZip(gpif));
  assert.equal(song.bpm, 120);
  assert.ok(warnings.some((w) => /tempo/i.test(w)));
});

test('a triplet (PrimaryTuplet) shortens a note to 2/3 of its base duration', () => {
  const gpif = `<?xml version="1.0"?><GPIF><Score><Title>Triplet</Title></Score>
    <Tracks><Track id="0"><Name>Solo</Name>
      <Staves><Staff><Properties><Property name="Tuning"><Pitches>64 59 55 50 45 40</Pitches></Property></Properties></Staff></Staves>
    </Track></Tracks>
    <MasterBars><MasterBar><Bars>0</Bars></MasterBar></MasterBars>
    <Bars><Bar id="0"><Voices>0 -1 -1 -1</Voices></Bar></Bars>
    <Voices><Voice id="0"><Beats>0</Beats></Voice></Voices>
    <Beats><Beat id="0"><Rhythm ref="0"/><Notes>0</Notes></Beat></Beats>
    <Notes><Note id="0"><Properties><Property name="String"><String>0</String></Property><Property name="Fret"><Fret>0</Fret></Property></Properties></Note></Notes>
    <Rhythms><Rhythm id="0"><NoteValue>Eighth</NoteValue><PrimaryTuplet num="3" den="2"/></Rhythm></Rhythms>
  </GPIF>`;
  const { song } = importGp7(buildGpZip(gpif));
  assert.equal(song.parts[0].notes[0].dur, 160); // 240 * 2/3
});

test('a .gp file with no score.gpif inside is a clear error, not a silent failure', () => {
  const zip = buildZip([{ name: 'META-INF/container.xml', data: Buffer.from('<container/>', 'utf8') }]);
  assert.throws(() => importGp7(zip), /score\.gpif/i);
});
