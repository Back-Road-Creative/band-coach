import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportMusicXml } from '../../src/song/export-musicxml.js';
import { importMusicXml } from '../../src/song/import-musicxml.js';
import { starterSongs } from '../../src/song/starter/index.js';
import { barsOf } from '../../src/song/model.js';
import { parseXml, elements, element, childText, attr } from '../../src/song/xml-lite.js';

// Merge consecutive tied notes (same pitch, prev ends exactly where this one
// starts, tieFromPrev true) back into one logical note, so a note our
// exporter had to split at a barline compares equal to the original.
function mergeTies(notes) {
  const out = [];
  for (const note of notes) {
    const prev = out[out.length - 1];
    if (note.tieFromPrev && prev && prev.midi === note.midi && prev.start + prev.dur === note.start) {
      prev.dur += note.dur;
      continue;
    }
    out.push({ start: note.start, dur: note.dur, midi: note.midi });
  }
  return out;
}

for (const song of starterSongs) {
  test(`round-trips "${song.title}" through MusicXML export/import`, () => {
    const xml = exportMusicXml(song);
    const { song: reimported } = importMusicXml(xml);

    assert.equal(reimported.bpm, song.bpm);
    assert.deepEqual(reimported.metre, song.metre);
    assert.deepEqual(reimported.key, song.key);
    assert.equal(reimported.parts.length, song.parts.length);

    song.parts.forEach((part, i) => {
      const expected = mergeTies(part.notes);
      const got = mergeTies(reimported.parts[i].notes);
      assert.deepEqual(got, expected, `part ${i} (${part.id}) notes`);
    });
  });
}

test('a note crossing a barline is exported as tied notes, not one overlong note', () => {
  const song = {
    schema: 'song/1',
    id: 'barline-tie-fixture',
    title: 'Barline Tie Fixture',
    composer: null,
    licence: null,
    source: null,
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    ticksPerQuarter: 480,
    parts: [
      {
        id: 'melody',
        name: 'Melody',
        // One bar is 1920 ticks; this note starts at bar 1 and runs a bar
        // and a quarter, crossing into bar 2.
        notes: [{ start: 0, dur: 2400, midi: 60 }],
      },
    ],
    chords: [],
  };

  const xml = exportMusicXml(song);
  assert.ok(xml.includes('<tie type="start"/>'), 'exported XML should contain a tie start');
  assert.ok(xml.includes('<tie type="stop"/>'), 'exported XML should contain a tie stop');

  const { song: reimported } = importMusicXml(xml);
  const merged = mergeTies(reimported.parts[0].notes);
  assert.deepEqual(merged, [{ start: 0, dur: 2400, midi: 60 }]);
});

// A song without any mid-song changes should export exactly the same bytes
// as before this feature existed -- captured from the pre-change output of
// the barline-tie fixture above.
test('a song with no mid-song changes exports byte-identical XML', () => {
  const song = {
    schema: 'song/1',
    id: 'barline-tie-fixture',
    title: 'Barline Tie Fixture',
    composer: null,
    licence: null,
    source: null,
    key: { tonic: 0, mode: 'major' },
    metre: { num: 4, den: 4 },
    bpm: 100,
    ticksPerQuarter: 480,
    parts: [
      { id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 2400, midi: 60 }] },
    ],
    chords: [],
  };

  const xml = exportMusicXml(song);
  assert.equal(
    xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
    '<score-partwise version="4.0"><movement-title>Barline Tie Fixture</movement-title><part-list><score-part id="melody"><part-name>Melody</part-name></score-part></part-list><part id="melody"><measure number="1"><attributes><divisions>480</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><sound tempo="100"/><note><pitch><step>C</step><octave>4</octave></pitch><duration>1920</duration><tie type="start"/><type>whole</type><notations><tied type="start"/></notations></note></measure><measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><tie type="stop"/><type>quarter</type><notations><tied type="stop"/></notations></note><note><rest/><duration>1440</duration><type>half</type><dot/></note></measure></part></score-partwise>\n',
  );
});

// A song with one mid-song metre change, one key change and one tempo
// change should place each at the measure where it falls (following
// bar boundaries that themselves follow the metre change), not just at
// the top of the song.
test('mid-song tempo, metre and key changes are written at the measure where they fall', () => {
  const song = {
    schema: 'song/1',
    id: 'mid-song-changes-fixture',
    title: 'Mid-Song Changes Fixture',
    composer: null,
    licence: null,
    source: null,
    key: { tonic: 0, mode: 'major' }, // C major, 0 sharps/flats
    metre: { num: 4, den: 4 },
    bpm: 100,
    ticksPerQuarter: 480,
    parts: [
      {
        id: 'melody',
        name: 'Melody',
        notes: [
          // Measure 1 (4/4, 0..1920): one half note tied across two quarters.
          { start: 0, dur: 960, midi: 60 },
          { start: 960, dur: 960, midi: 62 },
          // Measure 2 (3/4, 1920..3360): three quarter notes.
          { start: 1920, dur: 480, midi: 64 },
          { start: 2400, dur: 480, midi: 65 },
          { start: 2880, dur: 480, midi: 67 },
          // Measure 3 (3/4, 3360..4800): three quarter notes.
          { start: 3360, dur: 480, midi: 69 },
          { start: 3840, dur: 480, midi: 71 },
          { start: 4320, dur: 480, midi: 72 },
        ],
      },
    ],
    chords: [],
    // The metre change lands exactly on a 4/4 bar boundary (measure 2).
    metreChanges: [{ tick: 1920, num: 3, den: 4 }],
    // The key change lands on the same tick as the metre change.
    keyChanges: [{ tick: 1920, tonic: 7, mode: 'major' }], // G major, 1 sharp
    // The tempo change lands mid-measure (measure 2 spans 1920..3360).
    tempoMap: [{ tick: 2500, bpm: 140 }],
  };

  const xml = exportMusicXml(song);
  const root = parseXml(xml);
  const part = elements(root, 'part').find((p) => attr(p, 'id') === 'melody');
  const measures = elements(part, 'measure');
  assert.equal(measures.length, 3);

  const m1 = measures[0];
  const m1Attrs = element(m1, 'attributes');
  assert.equal(childText(element(m1Attrs, 'time'), 'beats'), '4');
  assert.equal(childText(element(m1Attrs, 'key'), 'fifths'), '0');
  assert.equal(attr(element(m1, 'sound'), 'tempo'), '100');

  const m2 = measures[1];
  const m2Attrs = element(m2, 'attributes');
  assert.ok(m2Attrs, 'measure 2 should carry updated <attributes> for the metre/key change');
  assert.equal(childText(element(m2Attrs, 'time'), 'beats'), '3');
  assert.equal(childText(element(m2Attrs, 'time'), 'beat-type'), '4');
  assert.equal(childText(element(m2Attrs, 'key'), 'fifths'), '1');
  assert.equal(childText(element(m2Attrs, 'key'), 'mode'), 'major');
  const m2Sounds = elements(m2, 'sound');
  assert.ok(m2Sounds.some((s) => attr(s, 'tempo') === '140'), 'measure 2 should carry the mid-measure tempo change');

  const m3 = measures[2];
  assert.equal(element(m3, 'attributes'), undefined, 'measure 3 has no changes, so no <attributes> block');
});

test('a mid-bar metre change splits measures exactly where barsOf does', () => {
  // 2400 falls inside the second 4/4 bar (1920..3840): barsOf closes that
  // bar at the change, so the export must write a short measure there too.
  const song = {
    schema: 'song/1', id: 'mid-bar-metre', title: 'Mid-Bar Metre', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes: [
      { start: 0, dur: 1920, midi: 60 }, { start: 1920, dur: 480, midi: 62 }, { start: 2400, dur: 1440, midi: 64 },
    ] }],
    chords: [],
    metreChanges: [{ tick: 2400, num: 3, den: 4 }],
  };
  const part = elements(parseXml(exportMusicXml(song)), 'part')[0];
  assert.equal(elements(part, 'measure').length, barsOf(song).length - 1);
});
