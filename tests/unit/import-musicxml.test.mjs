import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importMusicXml } from '../../src/song/import-musicxml.js';
import { validateSong } from '../../src/song/model.js';

const TPQ = 480;

function scoreXml(partsXml, { divisions = 1 } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Test Part</part-name></score-part>
  </part-list>
  <part id="P1">${partsXml}</part>
</score-partwise>`;
}

test('a garbage/incomplete .mxl (not a real zip) throws a plain "could not be read" message, not a dead end', () => {
  const zipBytes = 'PK\x03\x04rest of a fake zip';
  assert.throws(() => importMusicXml(zipBytes), /\.mxl.*could not be read/i);
});
test('an empty score-timewise document imports (no parts, no throw) — real .mxl coverage is in import-mxl.test.mjs', () => {
  const xml = '<?xml version="1.0"?><score-timewise version="3.1"></score-timewise>';
  const { song, warnings } = importMusicXml(xml);
  assert.equal(song.schema, 'song/1');
  assert.deepEqual(song.parts, []);
  assert.deepEqual(warnings, ['no tempo found; defaulted to 120 bpm']);
});
test('imports a one-octave C major scale with correct ticks and midi', () => {
  // Quarter notes, divisions=1 (so duration 1 == one quarter note == 480 ticks).
  const notes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].map(
    (step) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`
  );
  const xml = scoreXml(`
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <sound tempo="100"/>
      ${notes.join('\n')}
    </measure>
  `);
  const { song, warnings } = importMusicXml(xml);
  assert.equal(song.schema, 'song/1');
  assert.equal(song.ticksPerQuarter, TPQ);
  assert.equal(song.bpm, 100);
  assert.deepEqual(song.key, { tonic: 0, mode: 'major' });
  assert.deepEqual(song.metre, { num: 4, den: 4 });
  assert.equal(song.parts.length, 1);
  const expectedMidi = [60, 62, 64, 65, 67, 69, 71];
  song.parts[0].notes.forEach((n, i) => {
    assert.equal(n.start, i * TPQ, `note ${i} start`);
    assert.equal(n.dur, TPQ, `note ${i} dur`);
    assert.equal(n.midi, expectedMidi[i], `note ${i} midi`);
  });
  assert.equal(warnings.length, 0);
});
test('handles divisions, dotted/tuplet durations via <duration>, ties, rests and chords', () => {
  // divisions=24 -> one quarter = 24 divisions = 480 ticks, so 1 division = 20 ticks.
  const xml = scoreXml(`
    <measure number="1">
      <attributes><divisions>24</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>36</duration><type>quarter</type><dot/>
        <tie type="start"/></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><type>eighth</type>
        <tie type="stop"/></note>
      <note><rest/><duration>24</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><type>eighth</type>
        <chord/>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>
    </measure>
  `);
  const { song, warnings } = importMusicXml(xml);
  const notes = song.parts[0].notes;
  // dotted quarter (36 div) then tied eighth (12 div) at same pitch: two Song
  // notes, the second carrying tieFromPrev.
  assert.equal(notes[0].start, 0);
  assert.equal(notes[0].dur, 720); // 36 * 20
  assert.equal(notes[0].midi, 60);
  assert.equal(notes[1].start, 720);
  assert.equal(notes[1].dur, 240); // 12 * 20
  assert.equal(notes[1].midi, 60);
  assert.equal(notes[1].tieFromPrev, true);
  // rest (24 div = 480 ticks) advances the cursor without adding a note.
  // Triplet eighths (16 div each = 320 ticks) starting after the rest.
  const afterRestStart = 720 + 240 + 480;
  const tripletNotes = notes.slice(2);
  assert.equal(tripletNotes[0].start, afterRestStart);
  assert.equal(tripletNotes[0].dur, 320);
  assert.equal(tripletNotes[0].midi, 64);
  assert.equal(tripletNotes[1].start, afterRestStart + 320);
  assert.equal(tripletNotes[1].midi, 67);
  // The chord note shares the start of the previous (G) note, not its own slot.
  assert.equal(tripletNotes[2].start, afterRestStart + 320);
  assert.equal(tripletNotes[2].midi, 72);
  assert.deepEqual(warnings, ['no tempo found; defaulted to 120 bpm']);
});
test('transposing part stores SOUNDING midi', () => {
  // B-flat clarinet: written C4 sounds Bb3 (down a major second, -2 semitones).
  const xml = scoreXml(`
    <measure number="1">
      <attributes><divisions>1</divisions>
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  `);
  const { song } = importMusicXml(xml);
  assert.equal(song.parts[0].notes[0].midi, 58); // 60 - 2
});
test('handles a pickup (anacrusis) measure and multiple voices with a warning', () => {
  const xml = scoreXml(`
    <measure number="0" implicit="yes">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    </measure>
    <measure number="1">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
      <backup><duration>1</duration></backup>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type></note>
    </measure>
  `);
  const { song, warnings } = importMusicXml(xml);
  const notes = song.parts[0].notes;
  // pickup note at tick 0, then measure 1 voice-1 note at tick 480, voice-2
  // note (after backup) also at tick 480 (merged/flattened).
  assert.equal(notes[0].start, 0);
  assert.equal(notes[0].midi, 67);
  const atMeasure1 = notes.filter((n) => n.start === 480).map((n) => n.midi).sort((a, b) => a - b);
  assert.deepEqual(atMeasure1, [52, 60]); // E3=52, C4=60
  assert.ok(warnings.some((w) => /voices/.test(w)));
});
test('reads title, composer and key from a minor-key example', () => {
  const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <work><work-title>Example Tune</work-title></work>
  <identification><creator type="composer">A. Composer</creator></identification>
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>minor</mode></key></attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;
  const { song } = importMusicXml(xml);
  assert.equal(song.title, 'Example Tune');
  assert.equal(song.composer, 'A. Composer');
  assert.deepEqual(song.key, { tonic: 9, mode: 'minor' });
});
test('mid-song metre, key and tempo changes (the latter via <direction>) become sorted change lists at the right ticks', () => {
  const xml = scoreXml(`
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <sound tempo="100"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <attributes><key><fifths>-3</fifths><mode>major</mode></key>
      <time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <direction><sound tempo="140"/></direction>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  `);
  const { song, warnings } = importMusicXml(xml);
  assert.equal(song.bpm, 100, 'initial bpm stays the first tempo seen');
  assert.deepEqual(song.metre, { num: 4, den: 4 }, 'initial metre stays the first time signature seen');
  assert.deepEqual(song.key, { tonic: 0, mode: 'major' }, 'initial key stays the first key seen');
  assert.deepEqual(song.metreChanges, [{ tick: 4 * TPQ, num: 3, den: 4 }]);
  assert.deepEqual(song.keyChanges, [{ tick: 4 * TPQ, tonic: 3, mode: 'major' }]);
  assert.deepEqual(song.tempoMap, [{ tick: 5 * TPQ, bpm: 140 }]);
  const { ok, errors } = validateSong(song);
  assert.ok(ok, 'song with change lists must validate: ' + errors.join('; '));
  assert.equal(warnings.length, 0);
});
test('a <direction>-only tempo with no direct <sound> child still sets the initial bpm', () => {
  const xml = scoreXml(`
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <direction><direction-type><words>Andante</words></direction-type><sound tempo="90"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  `);
  const { song, warnings } = importMusicXml(xml);
  assert.equal(song.bpm, 90);
  assert.equal(song.tempoMap, undefined, 'no change, no tempoMap key at all');
  assert.deepEqual(warnings, []);
});
test('repeated identical <attributes> across measures produce no change entries; the keys stay absent', () => {
  const xml = scoreXml(`
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <sound tempo="100"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <attributes><key><fifths>0</fifths><mode>major</mode></key>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <sound tempo="100"/>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  `);
  const { song } = importMusicXml(xml);
  assert.equal(song.metreChanges, undefined);
  assert.equal(song.keyChanges, undefined);
  assert.equal(song.tempoMap, undefined);
});
