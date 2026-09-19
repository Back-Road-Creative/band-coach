import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  transposeByInterval, writtenToConcert, concertToWritten, transposeBetweenInstruments,
  chooseEnharmonicKey, transposeKey, transposePhraseForInstrument,
} from '../../src/core/theory/transpose.js';
import { byId } from '../../src/instruments/index.js';

function n(midi) { return { start: 0, dur: 480, midi }; }

test('transposeByInterval shifts midi, leaves timing alone', () => {
  const out = transposeByInterval([{ start: 10, dur: 20, midi: 60 }], 3);
  assert.deepEqual(out, [{ start: 10, dur: 20, midi: 63 }]);
});

test('B flat trumpet: written is a major second above concert (transposition -2)', () => {
  const concert = [n(60)];
  const written = concertToWritten(concert, byId['trumpet-bb']);
  assert.equal(written[0].midi, 62);
  const back = writtenToConcert(written, byId['trumpet-bb']);
  assert.equal(back[0].midi, 60);
});

test('E flat alto sax: written is a major sixth above concert (transposition -9)', () => {
  const written = concertToWritten([n(60)], byId['sax-alto-eb']);
  assert.equal(written[0].midi, 69);
});

test('transposeBetweenInstruments round-trips through concert pitch', () => {
  const bbWritten = [n(62)]; // concert C, written for Bb trumpet
  const forSax = transposeBetweenInstruments(bbWritten, byId['trumpet-bb'], byId['sax-alto-eb']);
  assert.equal(forSax[0].midi, 69); // same concert pitch (C), written for Eb alto sax
});

test('chooseEnharmonicKey prefers fewer accidentals, ties toward sharps', () => {
  assert.equal(chooseEnharmonicKey(0, 'major').name, 'C');
  assert.equal(chooseEnharmonicKey(6, 'major').name, 'F#'); // F#(6 sharps) ties Gb(6 flats) -> sharp wins
  assert.equal(chooseEnharmonicKey(1, 'major').name, 'Db'); // Db(5 flats) beats C#(7 sharps)
});

test('transposeKey moves a Song-shape key by an interval, respelling sensibly', () => {
  const up2 = transposeKey({ tonic: 0, mode: 'major' }, 2);
  assert.equal(up2.name, 'D');
});

test('transposePhraseForInstrument: a C D E concert phrase reads correctly on Bb trumpet and Eb alto sax', () => {
  const concertKey = { tonic: 0, mode: 'major' };
  const phrase = [n(60), n(62), n(64)];
  const cases = [
    ['trumpet-bb', 'D', ['D', 'E', 'F#'], [62, 64, 66]],
    ['sax-alto-eb', 'A', ['A', 'B', 'C#'], [69, 71, 73]],
  ];
  for (const [id, keyName, letters, midis] of cases) {
    const result = transposePhraseForInstrument(phrase, concertKey, byId[id]);
    assert.equal(result.key.name, keyName, id);
    assert.deepEqual(result.notes.map(x => x.letter + x.accidental), letters, id);
    assert.deepEqual(result.notes.map(x => x.midi), midis, id);
  }
});
