// Turns raw pitch-tracker output into a Song object (the shared shape from
// the author brief: schema 'song/1', ticksPerQuarter 480, one part) with a
// confidence score at every stage, so the UI can tell a learner "I'm not
// sure about the timing — check it" before they practise off a bad
// transcription.
//
// Wiring contract for the unit that connects this to the mic pipeline:
//   transcribe(frames, opts) -> { song, report }
//   `frames` is the RAW per-frame pitch-tracker output — NOT the merged
//   note list `capStop()` in src/app.js already builds (that merge keeps
//   only pitch, throwing away rhythm). Sample it as
//   [{ t: seconds, midi, rms?, confidence? }], continuously, at whatever
//   rate the tracker already runs. `onsets` (optional, seconds) can carry
//   an onset-detector's output to force note boundaries the pitch alone
//   would miss (e.g. a re-picked note at the same pitch).
//   This module is pure: no DOM, no `window`, no `AudioContext`, no
//   `Math.random`, no `Date.now()` — a caller passes frames it already
//   captured, never reads the clock itself.
//
// `report.needsCheck` always lists the Krumhansl-Schmuckler profile numbers
// as typed-from-memory (see detectKey below) and adds a line for every
// stage whose confidence is low. A mandatory fix-it UI step should show
// this list before letting the learner practise the transcribed song.

import { songIdentity } from './ident.js';

const TICKS_PER_QUARTER = 480;

// ---- eventsToNotes -----------------------------------------------------

export function eventsToNotes(frames, opts = {}) {
  const { onsets = [], minNoteMs = 60, glitchWindow = 5, glitchMaxRunMs = 90 } = opts;
  const fr = (Array.isArray(frames) ? frames : [])
    .filter((f) => f && typeof f.t === 'number' && typeof f.midi === 'number')
    // A live pitch track is a float that wobbles by cents on a steady note
    // (src/ui/editor/record.js); snap to the nearest semitone so grouping and
    // glitch folding compare notes, not cents.
    .map((f) => ({ ...f, midi: Math.round(f.midi) }))
    .sort((a, b) => a.t - b.t);
  if (!fr.length) return [];

  const corrected = correctGlitches(fr, glitchWindow, glitchMaxRunMs);
  const onsetTimes = (Array.isArray(onsets) ? onsets : []).slice().sort((a, b) => a - b);

  const notes = [];
  let cur = null;
  let onsetCursor = 0;

  const flush = (endT) => {
    if (!cur) return;
    const dur = endT - cur.start;
    if (dur * 1000 >= minNoteMs) {
      notes.push({ start: cur.start, end: endT, midi: cur.midi, confidence: cur.confSum / cur.n });
    }
    cur = null;
  };

  for (let i = 0; i < corrected.length; i++) {
    const f = corrected[i];
    let onsetHere = false;
    while (onsetCursor < onsetTimes.length && onsetTimes[onsetCursor] <= f.t + 1e-9) {
      onsetHere = true;
      onsetCursor++;
    }
    if (!cur) {
      cur = { start: f.t, midi: f.midi, confSum: conf(f), n: 1 };
    } else if (f.midi !== cur.midi || (onsetHere && f.t > cur.start + 1e-9)) {
      flush(f.t);
      cur = { start: f.t, midi: f.midi, confSum: conf(f), n: 1 };
    } else {
      cur.confSum += conf(f);
      cur.n += 1;
    }
  }

  const gaps = [];
  for (let i = 1; i < corrected.length; i++) gaps.push(corrected[i].t - corrected[i - 1].t);
  const lastDur = gaps.length ? median(gaps) : 0.05;
  flush(corrected[corrected.length - 1].t + lastDur);

  return notes;
}

function conf(f) {
  if (typeof f.confidence === 'number') return f.confidence;
  if (typeof f.rms === 'number') return Math.min(1, Math.max(0, f.rms));
  return 1;
}

function median(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// A pitch tracker's most common failure is a short run that reads a whole
// number of octaves (or a single stray semitone) away from the pitch
// immediately before AND after it, then snaps back — an octave error or a
// one-frame glitch. If a run is short and bounded on both sides by frames
// that agree with each other, fold it onto that surrounding pitch. This
// covers octave jumps as the common case (diff is a multiple of 12) and
// any other short surrounded glitch the same way.
function correctGlitches(frames, _windowSize, maxRunMs) {
  const out = frames.map((f) => ({ ...f }));
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (j + 1 < out.length && out[j + 1].midi === out[i].midi) j++;
    const runDurMs = (out[j].t - out[i].t) * 1000 + 1;
    const beforePitch = i > 0 ? out[i - 1].midi : null;
    const afterPitch = j + 1 < out.length ? out[j + 1].midi : null;
    if (
      runDurMs <= maxRunMs &&
      beforePitch !== null &&
      beforePitch === afterPitch &&
      out[i].midi !== beforePitch
    ) {
      for (let k = i; k <= j; k++) out[k].midi = beforePitch;
    }
    i = j + 1;
  }
  return out;
}

// ---- estimateTempo -------------------------------------------------------

export function estimateTempo(noteStarts) {
  const starts = (Array.isArray(noteStarts) ? noteStarts : []).slice().sort((a, b) => a - b);
  if (starts.length < 2) return { bpm: 120, confidence: 0, candidates: [] };

  const iois = [];
  for (let i = 1; i < starts.length; i++) {
    const d = starts[i] - starts[i - 1];
    if (d > 0.05 && d < 4) iois.push(d);
  }
  if (!iois.length) return { bpm: 120, confidence: 0, candidates: [] };

  // IOI-histogram tempo induction: score each candidate beat period by how
  // well it explains the observed inter-onset intervals (an IOI close to a
  // whole-number multiple of the period supports it).
  const minPeriod = 60 / 300;
  const maxPeriod = 60 / 40;
  const step = 0.005;
  let bestScore = -1;
  let bestPeriod = iois[0];
  for (let p = minPeriod; p <= maxPeriod; p += step) {
    let score = 0;
    for (const ioi of iois) {
      const k = Math.max(1, Math.round(ioi / p));
      const err = Math.abs(ioi - k * p) / p;
      score += Math.max(0, 1 - err * 4);
    }
    if (score > bestScore) {
      bestScore = score;
      bestPeriod = p;
    }
  }

  const fold = (period) => {
    let p = period;
    let bpm = 60 / p;
    while (bpm < 60) {
      p /= 2;
      bpm = 60 / p;
    }
    while (bpm > 140) {
      p *= 2;
      bpm = 60 / p;
    }
    return { period: p, bpm };
  };

  const primary = fold(bestPeriod);
  const altPeriods = [bestPeriod * 2, bestPeriod / 2].filter((p) => p >= minPeriod && p <= maxPeriod);
  const candidates = [{ bpm: primary.bpm, period: primary.period }]
    .concat(altPeriods.map((p) => ({ bpm: 60 / p, period: p })))
    .filter((c, i, arr) => arr.findIndex((x) => Math.abs(x.bpm - c.bpm) < 0.5) === i)
    .map((c) => ({ bpm: Math.round(c.bpm * 100) / 100, period: c.period }));

  const confidence = Math.max(0, Math.min(1, bestScore / iois.length));

  return { bpm: Math.round(primary.bpm * 100) / 100, confidence, candidates };
}

// ---- quantize --------------------------------------------------------

const STRAIGHT_UNIT = TICKS_PER_QUARTER / 4; // 120 ticks: straight 16th
const TRIPLET_UNIT = TICKS_PER_QUARTER / 3; // 160 ticks: triplet 8th

function snapTo(tick, beatStartTick, unit) {
  const rel = tick - beatStartTick;
  return beatStartTick + Math.round(rel / unit) * unit;
}

export function quantize(notes, opts = {}) {
  const { bpm, grid = 'auto' } = opts;
  if (!bpm || bpm <= 0) throw new Error('quantize requires a positive bpm');
  const list = Array.isArray(notes) ? notes : [];
  if (!list.length) return [];

  const beatSec = 60 / bpm;
  const ticksPerSec = TICKS_PER_QUARTER / beatSec;
  const sorted = list.slice().sort((a, b) => a.start - b.start);
  const maxBeat = Math.max(0, Math.ceil(sorted[sorted.length - 1].end / beatSec));

  const beatGrid = [];
  for (let b = 0; b <= maxBeat; b++) {
    if (grid === 'straight' || grid === 'triplet') {
      beatGrid[b] = grid;
      continue;
    }
    const beatStartTick = b * TICKS_PER_QUARTER;
    const inBeat = sorted.filter((n) => n.start >= b * beatSec - 1e-9 && n.start < (b + 1) * beatSec - 1e-9);
    if (!inBeat.length) {
      beatGrid[b] = 'straight';
      continue;
    }
    let errS = 0;
    let errT = 0;
    inBeat.forEach((n) => {
      const tick = beatStartTick + (n.start - b * beatSec) * ticksPerSec;
      errS += Math.abs(tick - snapTo(tick, beatStartTick, STRAIGHT_UNIT));
      errT += Math.abs(tick - snapTo(tick, beatStartTick, TRIPLET_UNIT));
    });
    beatGrid[b] = errT < errS ? 'triplet' : 'straight';
  }

  return sorted.map((n) => {
    const b = Math.max(0, Math.floor(n.start / beatSec + 1e-9));
    const unit = beatGrid[Math.min(b, maxBeat)] === 'triplet' ? TRIPLET_UNIT : STRAIGHT_UNIT;
    const beatStartTick = b * TICKS_PER_QUARTER;
    const startTick = Math.round(snapTo(n.start * ticksPerSec, beatStartTick, unit));
    let endTick = Math.round(snapTo(n.end * ticksPerSec, beatStartTick, unit));
    if (endTick <= startTick) endTick = startTick + unit; // never zero-length
    const out = { start: startTick, dur: endTick - startTick, midi: n.midi };
    if (typeof n.confidence === 'number') out.confidence = n.confidence;
    return out;
  });
}

// ---- inferMetreAndBars -------------------------------------------------

export function inferMetreAndBars(notes, bpm) {
  const list = Array.isArray(notes) ? notes : [];
  if (!list.length || !bpm) return { metre: { num: 4, den: 4 }, pickupTicks: 0, confidence: 0 };

  const beatSec = 60 / bpm;
  const pulseSec = beatSec / 4; // sixteenth-note pulse grid
  const pulseTicks = TICKS_PER_QUARTER / 4;
  const t0 = list[0].start;

  const events = list.map((n) => ({
    pulse: Math.round((n.start - t0) / pulseSec),
    weight: Math.max(1e-6, (n.end - n.start) || 0) * (typeof n.confidence === 'number' ? Math.max(0.05, n.confidence) : 1),
  }));
  const totalWeight = events.reduce((s, e) => s + e.weight, 0) || 1;

  function downbeatRatio(barPulses, shift) {
    let onWeight = 0;
    events.forEach((e) => {
      const rel = ((e.pulse - shift) % barPulses + barPulses) % barPulses;
      if (rel === 0) onWeight += e.weight;
    });
    const notesPerBar = barPulses / 4; // assumes a quarter-note pulse grid
    return (onWeight / totalWeight) * notesPerBar; // 1.0 == chance for evenly spaced notes
  }

  function bestShift(barPulses) {
    let best = { shift: 0, ratio: -1 };
    for (let shift = 0; shift < barPulses; shift++) {
      const ratio = downbeatRatio(barPulses, shift);
      if (ratio > best.ratio) best = { shift, ratio };
    }
    return best;
  }

  const four = { ...bestShift(16), barPulses: 16, metre: { num: 4, den: 4 } };
  const three = { ...bestShift(12), barPulses: 12, metre: { num: 3, den: 4 } };

  // 3/4 and 6/8 share a 12-pulse bar; tell them apart by whether the
  // secondary accent (beyond the downbeat) groups in 3s (compound, 6/8:
  // one extra accent at pulse 6) or in 4s (simple, 3/4: two extra accents
  // at pulses 4 and 8), relative to the downbeat shift already found.
  const midWeightAt = (stride) => {
    let w = 0;
    events.forEach((e) => {
      const rel = ((e.pulse - three.shift) % 12 + 12) % 12;
      if (rel !== 0 && rel % stride === 0) w += e.weight;
    });
    return w;
  };
  const compoundWeight = midWeightAt(6) * 2; // 1 slot/bar, normalize per-slot
  const simpleWeight = midWeightAt(4); // 2 slots/bar
  const threeOrSix = compoundWeight > simpleWeight ? { ...three, metre: { num: 6, den: 8 } } : three;

  const winner = four.ratio >= threeOrSix.ratio ? four : threeOrSix;
  const runnerUpRatio = four.ratio >= threeOrSix.ratio ? threeOrSix.ratio : four.ratio;
  const margin = winner.ratio - runnerUpRatio;

  let confidence = Math.max(0, Math.min(1, margin / 2));
  let metre = winner.metre;
  let pickupTicks = winner.shift * pulseTicks;

  const MIN_CONFIDENCE = 0.08;
  if (confidence < MIN_CONFIDENCE) {
    metre = { num: 4, den: 4 };
    pickupTicks = 0;
    confidence = 0;
  }
  return { metre, pickupTicks, confidence };
}

// ---- detectKey -----------------------------------------------------------

// Krumhansl & Kessler (1982) key-profile weights, typed from memory — list
// this under "needs a musician's check" in every caller's report rather
// than trusting it silently.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a, b) {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

export function detectKey(notes) {
  const list = Array.isArray(notes) ? notes : [];
  const durations = new Array(12).fill(0);
  list.forEach((n) => {
    const pc = ((Math.round(n.midi) % 12) + 12) % 12;
    const dur = typeof n.end === 'number' ? n.end - n.start : n.dur;
    durations[pc] += Math.max(0, dur || 0);
  });
  const total = durations.reduce((a, b) => a + b, 0);
  if (!total) return { tonic: 0, mode: 'major', confidence: 0 };

  const results = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [
      ['major', MAJOR_PROFILE],
      ['minor', MINOR_PROFILE],
    ]) {
      const rotated = profile.map((_, i) => profile[(i - tonic + 12) % 12]);
      results.push({ tonic, mode, corr: pearson(durations, rotated) });
    }
  }
  results.sort((a, b) => b.corr - a.corr);
  const best = results[0];
  const margin = best.corr - (results[1] ? results[1].corr : 0);
  const confidence = Math.max(0, Math.min(1, margin * 3));
  return { tonic: best.tonic, mode: best.mode, confidence };
}

// ---- transcribe ----------------------------------------------------------

function emptySong(opts) {
  return {
    schema: 'song/1',
    ...songIdentity({ title: opts.title, fallback: 'My recording' }),
    composer: null,
    licence: null,
    source: null,
    key: null,
    metre: { num: 4, den: 4 },
    bpm: 120,
    ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'melody', name: 'Melody', notes: [] }],
    chords: [],
  };
}

const KEY_PROFILE_CAVEAT =
  'Krumhansl-Schmuckler key-profile numbers (typed from memory) — verify against the published paper.';

export function transcribe(frames, opts = {}) {
  const { onsets, minNoteMs, grid } = opts;
  const rawNotes = eventsToNotes(frames, { onsets, minNoteMs });

  if (!rawNotes.length) {
    return {
      song: emptySong(opts),
      report: {
        tempo: { bpm: 120, confidence: 0, candidates: [] },
        metre: { metre: { num: 4, den: 4 }, pickupTicks: 0, confidence: 0 },
        key: { tonic: 0, mode: 'major', confidence: 0 },
        notesCaptured: 0,
        needsCheck: [KEY_PROFILE_CAVEAT, 'No notes were captured — nothing was transcribed.'],
      },
    };
  }

  const tempo = estimateTempo(rawNotes.map((n) => n.start));
  const metre = inferMetreAndBars(rawNotes, tempo.bpm);
  const key = detectKey(rawNotes);
  const quantized = quantize(rawNotes, { bpm: tempo.bpm, grid });

  const song = {
    schema: 'song/1',
    ...songIdentity({ title: opts.title, fallback: 'My recording' }),
    composer: null,
    licence: null,
    source: null,
    key: key.confidence > 0 ? { tonic: key.tonic, mode: key.mode } : null,
    metre: metre.metre,
    bpm: tempo.bpm,
    ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'melody', name: 'Melody', notes: quantized }],
    chords: [],
  };

  const needsCheck = [KEY_PROFILE_CAVEAT];
  if (tempo.confidence < 0.5) needsCheck.push("Tempo is uncertain — confirm the beat before practising to it.");
  if (metre.confidence < 0.3) needsCheck.push('Metre defaulted or low-confidence — check the bar lines.');
  if (key.confidence < 0.3) needsCheck.push('Key detection is low-confidence — check the key signature.');

  return {
    song,
    report: { tempo, metre, key, notesCaptured: rawNotes.length, needsCheck },
  };
}
