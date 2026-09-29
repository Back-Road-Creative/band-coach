// transcribe(frames, { beats, onsets }): the beat track sets song.tempoMap (the
// music is quantized against the tempo actually played, not one flat bpm) and
// estimateSwing's ratio lands on song.swing with a plain swung/straight line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe } from '../../src/song/transcribe.js';
import { validateSong, normalizeSong } from '../../src/song/model.js';

// notes: [{ t, midi }] each sounding 0.12 s; frames at 200 Hz.
function framesFor(notes) {
  const frames = [];
  notes.forEach((n) => { for (let i = 0; i < 24; i++) frames.push({ t: n.t + i / 200, midi: n.midi, confidence: 0.9 }); });
  return { frames, onsets: notes.map((n) => n.t) };
}

test('a beat track that speeds up gives the transcribed song a multi-entry tempoMap', () => {
  const beats = []; let t = 0; let gap = 0.6;
  for (let i = 0; i < 24; i++) { beats.push(t); t += gap; gap = Math.max(0.3, gap - 0.02); }
  const { frames, onsets } = framesFor(beats.slice(0, 20).map((b, i) => ({ t: b, midi: 60 + (i % 2) * 2 })));
  const { song } = transcribe(frames, { onsets, beats });
  assert.ok(Array.isArray(song.tempoMap) && song.tempoMap.length > 1, 'tempoMap has several entries: ' + JSON.stringify(song.tempoMap));
  assert.ok(song.tempoMap[song.tempoMap.length - 1].bpm > song.tempoMap[0].bpm, 'it speeds up');
  song.parts[0].notes.slice(0, 20).forEach((n, i) => assert.equal(n.start, i * 480, 'note ' + i + ' lands on beat ' + i));
  assert.equal(song.bpm, song.tempoMap[0].bpm);
  assert.ok(validateSong(song).ok);
});

function pairs(offsetFrac, n = 16) {
  const beats = []; const notes = [];
  for (let i = 0; i < n; i++) {
    beats.push(i * 0.5);
    notes.push({ t: i * 0.5, midi: 60 }, { t: i * 0.5 + 0.5 * offsetFrac, midi: 64 });
  }
  return { beats, ...framesFor(notes) };
}

test('swung eighths set song.swing near 2 and the result line says swung', () => {
  const { beats, frames, onsets } = pairs(2 / 3);
  const { song, report } = transcribe(frames, { onsets, beats });
  assert.ok(Math.abs(song.swing - 2) < 0.15, 'swing ' + song.swing);
  assert.match(report.feelLine, /swung/i);
  assert.ok(validateSong(song).ok);
});

test('straight eighths set song.swing near 1 and the line says straight', () => {
  const { beats, frames, onsets } = pairs(0.5);
  const { song, report } = transcribe(frames, { onsets, beats });
  assert.ok(Math.abs(song.swing - 1) < 0.15, 'swing ' + song.swing);
  assert.match(report.feelLine, /straight/i);
});

test('with no beat track nothing changes: flat tempo, no swing field, no feel line', () => {
  const { frames, onsets } = framesFor([{ t: 0, midi: 60 }, { t: 0.5, midi: 62 }, { t: 1, midi: 64 }]);
  const { song, report } = transcribe(frames, { onsets });
  assert.equal(song.tempoMap, undefined);
  assert.equal(song.swing, undefined);
  assert.equal(report.feelLine, undefined);
});

test('swing survives normalizeSong and rejects nonsense', () => {
  const { beats, frames, onsets } = pairs(2 / 3);
  const { song } = transcribe(frames, { onsets, beats });
  const round = normalizeSong(JSON.parse(JSON.stringify(song)));
  assert.equal(round.swing, song.swing);
  assert.equal(validateSong({ ...song, swing: -1 }).ok, false);
  assert.equal(validateSong({ ...song, swing: 'lots' }).ok, false);
  assert.equal(normalizeSong({ ...JSON.parse(JSON.stringify(song)), swing: 'lots' }).swing, undefined);
});
