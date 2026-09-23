import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportMusicXml } from '../../src/song/export-musicxml.js';
import { importMusicXml } from '../../src/song/import-musicxml.js';
import { starterSongs } from '../../src/song/starter/index.js';

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
