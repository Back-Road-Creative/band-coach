import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventsToNotes,
  estimateTempo,
  quantize,
  inferMetreAndBars,
  detectKey,
  transcribe,
} from '../../src/song/transcribe.js';

// Seeded LCG so synthesized performances are reproducible without Math.random.
function makeLcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Build dense per-frame pitch-tracker output for a sequence of notes given
// as { midi, beats } at a fixed bpm, with optional start-time jitter from a
// seeded rng (simulating a real capture) and optional single-frame glitches.
function synthesize({ notesSpec, bpm, frameRate = 200, jitterMs = 0, rng = null, glitchAt = [] }) {
  const beatSec = 60 / bpm;
  const frames = [];
  const onsets = [];
  const trueStarts = [];
  let t = 0;
  notesSpec.forEach((spec, idx) => {
    const jitter = rng ? (rng() - 0.5) * 2 * (jitterMs / 1000) : 0;
    const start = Math.max(0, t + jitter);
    trueStarts.push(t);
    const dur = spec.beats * beatSec;
    const sound = spec.sound != null ? spec.sound : dur * 0.95; // leave a small gap so notes don't merge
    onsets.push(start);
    const nFrames = Math.max(3, Math.round((sound * frameRate)));
    const conf = typeof spec.accent === 'number' ? spec.accent : 0.9;
    for (let i = 0; i < nFrames; i++) {
      frames.push({ t: start + i / frameRate, midi: spec.midi, confidence: conf });
    }
    t += dur;
  });
  glitchAt.forEach(({ noteIndex, frameOffset = 1, semitones = 12, runLen = 2 }) => {
    // find frames belonging to that note by matching midi run in order
    let count = -1;
    for (let i = 0; i < frames.length; i++) {
      if (i === 0 || frames[i].midi !== frames[i - 1].midi) count++;
      if (count === noteIndex) {
        for (let k = 0; k < runLen && i + frameOffset + k < frames.length; k++) {
          frames[i + frameOffset + k] = { ...frames[i + frameOffset + k], midi: frames[i + frameOffset + k].midi + semitones };
        }
        break;
      }
    }
  });
  return { frames, onsets, trueStarts, beatSec };
}

// ---- eventsToNotes -------------------------------------------------------

test('eventsToNotes merges dense frames of one pitch into a single note', () => {
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push({ t: i * 0.01, midi: 60, confidence: 1 });
  const notes = eventsToNotes(frames, { minNoteMs: 60 });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].midi, 60);
  assert.ok(notes[0].end - notes[0].start > 0.3);
});

test('eventsToNotes splits on pitch change and drops a short blip note', () => {
  const frames = [];
  for (let i = 0; i < 30; i++) frames.push({ t: i * 0.01, midi: 60 });
  // a 2-frame blip to an unrelated pitch with no matching pitch on both sides
  frames.push({ t: 0.30, midi: 67 });
  frames.push({ t: 0.31, midi: 67 });
  for (let i = 0; i < 30; i++) frames.push({ t: 0.35 + i * 0.01, midi: 64 });
  const notes = eventsToNotes(frames, { minNoteMs: 60 });
  const midis = notes.map((n) => n.midi);
  assert.ok(!midis.includes(67), `blip should be dropped, got ${JSON.stringify(midis)}`);
  assert.deepEqual(midis, [60, 64]);
});

test('eventsToNotes folds a short octave-error run back onto the surrounding pitch', () => {
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push({ t: i * 0.005, midi: 60 }); // 0-95ms
  for (let i = 0; i < 3; i++) frames.push({ t: 0.10 + i * 0.005, midi: 72 }); // octave glitch, 15ms
  for (let i = 0; i < 20; i++) frames.push({ t: 0.12 + i * 0.005, midi: 60 });
  const notes = eventsToNotes(frames, { minNoteMs: 60 });
  assert.equal(notes.length, 1, `expected the glitch folded into one note, got ${JSON.stringify(notes)}`);
  assert.equal(notes[0].midi, 60);
});

test('eventsToNotes honours an onset to split two notes at the same pitch', () => {
  const frames = [];
  for (let i = 0; i < 30; i++) frames.push({ t: i * 0.01, midi: 60 });
  for (let i = 0; i < 30; i++) frames.push({ t: 0.30 + i * 0.01, midi: 60 });
  const notes = eventsToNotes(frames, { onsets: [0.30], minNoteMs: 60 });
  assert.equal(notes.length, 2);
  assert.equal(notes[0].midi, 60);
  assert.equal(notes[1].midi, 60);
  assert.ok(Math.abs(notes[1].start - 0.30) < 0.02);
});

// ---- estimateTempo --------------------------------------------------------

for (const bpm of [72, 100, 132]) {
  test(`estimateTempo recovers ~${bpm} bpm from a jittery quarter-note performance`, () => {
    const rng = makeLcg(bpm * 7 + 3);
    const midis = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62];
    const notesSpec = midis.map((m) => ({ midi: m, beats: 1 }));
    const { frames } = synthesize({ notesSpec, bpm, jitterMs: 15, rng });
    const notes = eventsToNotes(frames, { minNoteMs: 60 });
    const tempo = estimateTempo(notes.map((n) => n.start));
    const errPct = Math.abs(tempo.bpm - bpm) / bpm;
    assert.ok(errPct <= 0.03, `expected bpm within 3% of ${bpm}, got ${tempo.bpm}`);
    assert.equal(notes.length, midis.length);
    assert.deepEqual(notes.map((n) => n.midi), midis);
  });
}

test('estimateTempo reports alternate half/double-time candidates', () => {
  const bpm = 100;
  const notesSpec = new Array(12).fill(0).map((_, i) => ({ midi: 60 + (i % 5), beats: 1 }));
  const { frames } = synthesize({ notesSpec, bpm });
  const notes = eventsToNotes(frames, { minNoteMs: 60 });
  const tempo = estimateTempo(notes.map((n) => n.start));
  assert.ok(tempo.candidates.length >= 1);
  assert.ok(tempo.candidates.some((c) => Math.abs(c.bpm - tempo.bpm) < 0.01));
});

test('estimateTempo with fewer than 2 note starts returns a zero-confidence default', () => {
  const tempo = estimateTempo([1.0]);
  assert.equal(tempo.confidence, 0);
  assert.equal(tempo.bpm, 120);
});

// ---- quantize --------------------------------------------------------

test('quantize snaps straight quarter notes onto the 480-tick grid with no zero-length notes', () => {
  const bpm = 120; // beatSec = 0.5
  const notes = [0, 1, 2, 3].map((i) => ({ start: i * 0.5, end: i * 0.5 + 0.48, midi: 60 + i }));
  const q = quantize(notes, { bpm });
  assert.deepEqual(q.map((n) => n.start), [0, 480, 960, 1440]);
  q.forEach((n) => assert.ok(n.dur > 0, 'no zero-length note'));
});

test('quantize prefers the triplet grid for a genuine triplet passage', () => {
  const bpm = 120; // beatSec = 0.5s, triplet = beatSec/3
  const beatSec = 0.5;
  const notes = [0, 1, 2].map((i) => ({ start: (i * beatSec) / 3, end: ((i + 1) * beatSec) / 3 - 0.01, midi: 60 + i }));
  const q = quantize(notes, { bpm });
  q.forEach((n) => assert.equal(n.start % 160, 0, `expected triplet-grid tick, got ${n.start}`));
});

test('quantize preserves a rest between notes rather than stretching the earlier note', () => {
  const bpm = 120;
  const notes = [{ start: 0, end: 0.2, midi: 60 }, { start: 0.5, end: 0.7, midi: 62 }];
  const q = quantize(notes, { bpm });
  assert.ok(q[0].start + q[0].dur < q[1].start, 'a rest should remain between the two notes');
});

test('quantize throws without a bpm', () => {
  assert.throws(() => quantize([{ start: 0, end: 0.2, midi: 60 }], {}));
});

// ---- inferMetreAndBars -----------------------------------------------------

// pattern: array of { beat, dur, accent } spanning exactly one bar (beats
// sum to the bar length); accent (0..1) is carried as frame confidence,
// which is what the downbeat-weighting heuristic keys off.
const PITCH_CYCLE = [0, 2, 4, 5, 7, 9, 11]; // distinct consecutive degrees so adjacent notes never share a pitch
function accentedBar(pattern, barCount) {
  const notesSpec = [];
  for (let b = 0; b < barCount; b++) {
    pattern.forEach((p, idx) => notesSpec.push({ midi: 60 + PITCH_CYCLE[idx % PITCH_CYCLE.length], beats: p.dur, accent: p.accent }));
  }
  return notesSpec;
}

test('inferMetreAndBars finds 4/4 from a strongly accented downbeat', () => {
  const bpm = 100;
  const pattern = [
    { beat: 0, dur: 1, accent: 1.0 },
    { beat: 1, dur: 1, accent: 0.3 },
    { beat: 2, dur: 1, accent: 0.3 },
    { beat: 3, dur: 1, accent: 0.3 },
  ];
  const notesSpec = accentedBar(pattern, 8);
  const { frames } = synthesize({ notesSpec, bpm });
  const notes = eventsToNotes(frames, { minNoteMs: 30 });
  const metre = inferMetreAndBars(notes, bpm);
  assert.equal(metre.metre.num, 4);
  assert.equal(metre.metre.den, 4);
});

test('inferMetreAndBars finds 3/4 from a strongly accented downbeat every three beats', () => {
  const bpm = 100;
  const pattern = [
    { beat: 0, dur: 1, accent: 1.0 },
    { beat: 1, dur: 1, accent: 0.3 },
    { beat: 2, dur: 1, accent: 0.3 },
  ];
  const notesSpec = accentedBar(pattern, 8);
  const { frames } = synthesize({ notesSpec, bpm });
  const notes = eventsToNotes(frames, { minNoteMs: 30 });
  const metre = inferMetreAndBars(notes, bpm);
  assert.equal(metre.metre.num, 3);
  assert.equal(metre.metre.den, 4);
});

test('inferMetreAndBars finds 6/8 from a compound (grouped-in-3) accent pattern', () => {
  const bpm = 120;
  // 6 eighth notes per bar, accents on eighth 0 and eighth 3 (two dotted-quarter beats)
  const pattern = [
    { beat: 0, dur: 0.5, accent: 1.0 },
    { beat: 0.5, dur: 0.5, accent: 0.2 },
    { beat: 1, dur: 0.5, accent: 0.2 },
    { beat: 1.5, dur: 0.5, accent: 0.8 },
    { beat: 2, dur: 0.5, accent: 0.2 },
    { beat: 2.5, dur: 0.5, accent: 0.2 },
  ];
  const notesSpec = accentedBar(pattern, 8);
  const { frames } = synthesize({ notesSpec, bpm });
  const notes = eventsToNotes(frames, { minNoteMs: 30 });
  const metre = inferMetreAndBars(notes, bpm);
  assert.equal(metre.metre.num, 6);
  assert.equal(metre.metre.den, 8);
});

test('inferMetreAndBars finds the pickup length before the first full bar', () => {
  const bpm = 100;
  const pickupBeats = 1; // one-beat anacrusis
  const pattern = [
    { beat: 0, dur: 1, accent: 1.0 },
    { beat: 1, dur: 1, accent: 0.3 },
    { beat: 2, dur: 1, accent: 0.3 },
    { beat: 3, dur: 1, accent: 0.3 },
  ];
  const bars = accentedBar(pattern, 6);
  const notesSpec = [{ midi: 62, beats: pickupBeats, accent: 0.3 }].concat(bars);
  const { frames } = synthesize({ notesSpec, bpm });
  const notes = eventsToNotes(frames, { minNoteMs: 30 });
  const metre = inferMetreAndBars(notes, bpm);
  const expectedPickupTicks = pickupBeats * 480;
  assert.ok(
    Math.abs(metre.pickupTicks - expectedPickupTicks) < 20,
    `expected pickup ~${expectedPickupTicks} ticks, got ${metre.pickupTicks}`
  );
});

test('inferMetreAndBars defaults to 4/4 with zero confidence when the pattern is ambiguous', () => {
  const bpm = 100;
  // perfectly uniform notes carry no accent information at all
  const notesSpec = new Array(16).fill(0).map((_, i) => ({ midi: 60 + (i % 3), beats: 1 }));
  const { frames } = synthesize({ notesSpec, bpm });
  const notes = eventsToNotes(frames, { minNoteMs: 30 });
  const metre = inferMetreAndBars(notes, bpm);
  assert.equal(metre.metre.num, 4);
  assert.equal(metre.metre.den, 4);
  assert.equal(metre.confidence, 0);
});

// ---- detectKey -------------------------------------------------------

test('detectKey finds C major from a duration-weighted C major scale', () => {
  const notes = [0, 2, 4, 5, 7, 9, 11, 12].map((pc, i) => ({ start: i, end: i + (pc === 0 ? 2 : 0.8), midi: 60 + pc }));
  const key = detectKey(notes);
  assert.equal(key.tonic, 0);
  assert.equal(key.mode, 'major');
  assert.ok(key.confidence > 0);
});

test('detectKey finds A minor from a duration-weighted natural-minor scale', () => {
  const pcs = [9, 11, 0, 2, 4, 5, 7, 9]; // A B C D E F G A
  const notes = pcs.map((pc, i) => ({ start: i, end: i + (i === 0 ? 2 : 0.8), midi: 57 + ((pc - 9 + 12) % 12) }));
  const key = detectKey(notes);
  assert.equal(key.tonic, 9);
  assert.equal(key.mode, 'minor');
});

test('detectKey with no notes returns a zero-confidence default', () => {
  const key = detectKey([]);
  assert.equal(key.confidence, 0);
});

// ---- transcribe (full pipeline) -----------------------------------------

test('transcribe ties note recovery, tempo, metre and key together with a report', () => {
  const bpm = 100;
  const rng = makeLcg(42);
  const pcs = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0];
  const pattern = pcs.map((pc) => ({ midi: 60 + pc, beats: 1 }));
  const { frames } = synthesize({ notesSpec: pattern, bpm, jitterMs: 10, rng });
  const { song, report } = transcribe(frames, {});
  assert.equal(song.schema, 'song/1');
  assert.equal(song.ticksPerQuarter, 480);
  assert.equal(song.parts.length, 1);
  assert.equal(song.parts[0].notes.length, pattern.length);
  song.parts[0].notes.forEach((n) => assert.ok(n.dur > 0));
  assert.ok(report.needsCheck.length >= 1);
  assert.ok(report.needsCheck.some((s) => /Krumhansl/.test(s)));
  assert.equal(report.notesCaptured, pattern.length);
  const errPct = Math.abs(report.tempo.bpm - bpm) / bpm;
  assert.ok(errPct <= 0.05, `expected recovered bpm near ${bpm}, got ${report.tempo.bpm}`);
});

test('transcribe with no frames returns an empty song and says so', () => {
  const { song, report } = transcribe([], {});
  assert.equal(song.parts[0].notes.length, 0);
  assert.equal(report.notesCaptured, 0);
  assert.ok(report.needsCheck.some((s) => /No notes/.test(s)));
});

// The live recorder (src/ui/editor/record.js) reports each frame's pitch as
// 69 + 12*log2(freq/440) -- a float that wobbles by a few cents from frame to
// frame even on a steady note. Grouping must treat a wobbling C4 as one C4,
// not as a run of one-frame notes that minNoteMs then throws away.
test('eventsToNotes groups a real, cent-wobbly pitch track into whole notes', () => {
  const rng = makeLcg(7);
  const frames = [];
  const spec = [{ midi: 60, from: 0, to: 0.4 }, { midi: 62, from: 0.4, to: 0.8 }];
  for (const s of spec) {
    for (let t = s.from; t < s.to - 1e-9; t += 0.005) {
      frames.push({ t, midi: s.midi + (rng() - 0.5) * 0.3, rms: 0.1, confidence: 0.9 });
    }
  }
  const notes = eventsToNotes(frames);
  assert.deepEqual(notes.map((n) => n.midi), [60, 62]);
  assert.ok(notes[0].end - notes[0].start > 0.35, 'the first note spans its whole 0.4 s');
});
