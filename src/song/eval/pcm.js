// Real-audio evaluation runner: unlike src/song/eval/roundtrip.js (synthetic
// per-frame pitch input, never touches a real waveform), this module runs an
// actual PCM clip through the SAME real-audio path Learn this uses for an
// audio file -- src/audio/file-frames.js's framesFromPCM() followed by
// src/song/transcribe.js's transcribe() -- and scores the result against
// hand-labelled ground truth (tests/fixtures/audio/README.md documents the
// manifest format). This is the only harness in the repo that can tell you
// whether the detector actually works on a real recording rather than on a
// clean synthetic approximation of one.
//
// Pure-ish: the scoring functions take PCM/labels in and return numbers out,
// no AudioContext, no DOM. evaluateManifest is the one function that touches
// the filesystem (reading a corpus directory), same pattern as build/*.mjs.
//
// No corpus ships in this repo (tests/fixtures/audio/ starts empty --
// clips are personal/CC0 recordings with independent labels, never
// downloaded by the app or committed test fixtures) so this module also
// hand-rolls a minimal WAV reader/writer: no npm dependency, and the corpus
// itself never needs one either.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { framesFromPCM } from '../../audio/file-frames.js';
import { transcribe } from '../transcribe.js';
import { ticksToSeconds } from '../model.js';
import { rangeForInstrument } from '../../audio/range.js';

// How close an estimated note's onset must land to a label's onset (or vice
// versa) to count as the same note. 50ms matches note-f1.js's own default
// tolerance (src/song/eval/note-f1.js) -- the same standard the synthetic
// harness already scores against, so a real-audio F1 and a synthetic F1 are
// at least comparable in what "close enough" means.
const DEFAULT_ONSET_TOLERANCE_SEC = 0.05;

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

function summarizeMs(valuesSec) {
  if (!valuesSec.length) return { mean: 0, p90: 0 };
  const ms = valuesSec.map((s) => s * 1000).sort((a, b) => a - b);
  const mean = ms.reduce((sum, v) => sum + v, 0) / ms.length;
  return { mean, p90: percentile(ms, 0.9) };
}

// Greedily pairs ref[i]/est[j] within `tol` seconds of onset, restricted to
// pairs `predicate` allows, closest-onset-first so one note never
// double-claims two matches on either side -- same greedy strategy as
// note-f1.js's scoreNotes, generalised here to also allow an octave-only
// predicate for a second pass.
function greedyMatch(ref, est, tol, predicate, excludeRef, excludeEst) {
  const candidates = [];
  for (let i = 0; i < ref.length; i++) {
    if (excludeRef.has(i)) continue;
    for (let j = 0; j < est.length; j++) {
      if (excludeEst.has(j)) continue;
      if (!predicate(ref[i], est[j])) continue;
      const dist = Math.abs(ref[i].onset - est[j].onset);
      if (dist <= tol) candidates.push({ i, j, dist });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  const pairs = [];
  const usedRef = new Set();
  const usedEst = new Set();
  for (const c of candidates) {
    if (usedRef.has(c.i) || usedEst.has(c.j)) continue;
    usedRef.add(c.i);
    usedEst.add(c.j);
    pairs.push(c);
  }
  return { pairs, usedRef, usedEst };
}

// pcm: Float32Array mono samples. sampleRate: the clip's real rate.
// labels: [{ midi, startSec, durSec }], the ground truth for this clip.
// opts: { instrument } (an instrument record, see src/audio/range.js) OR an
// explicit { fmin, fmax } pair -- exactly what Learn this passes
// (src/ui/learn.js's transcribeAudioFile), plus optional { hopMs,
// onsetToleranceSec }. Falls back to the app's own generic search band
// (rangeForInstrument's FALLBACK_RANGE) when neither is given, same as any
// caller with no instrument picked yet.
export function evaluateClip(pcm, sampleRate, labels, opts = {}) {
  const { instrument, hopMs, onsetToleranceSec = DEFAULT_ONSET_TOLERANCE_SEC } = opts;
  const range =
    typeof opts.fmin === 'number' && typeof opts.fmax === 'number'
      ? { fmin: opts.fmin, fmax: opts.fmax }
      : rangeForInstrument(instrument);

  const { frames, onsets } = framesFromPCM(pcm, sampleRate, { fmin: range.fmin, fmax: range.fmax, hopMs });
  const { song } = transcribe(frames, { onsets });

  const ref = (labels || []).map((l) => ({ onset: l.startSec, dur: l.durSec, midi: l.midi }));
  const est = song.parts[0].notes.map((n) => ({
    onset: ticksToSeconds(n.start, song.bpm),
    dur: ticksToSeconds(n.dur, song.bpm),
    midi: n.midi,
  }));

  if (!ref.length && !est.length) {
    return {
      precision: 1,
      recall: 1,
      f1: 1,
      onsetErrorMs: { mean: 0, p90: 0 },
      releaseErrorMs: { mean: 0, p90: 0 },
      falsePositives: 0,
      misses: 0,
      octaveErrors: 0,
    };
  }

  // Phase 1: exact-pitch matches within tolerance -- the only pairs counted
  // as a correct transcription.
  const hits = greedyMatch(ref, est, onsetToleranceSec, (r, e) => r.midi === e.midi, new Set(), new Set());
  // Phase 2, among whatever phase 1 left unmatched: same onset, pitch off by
  // a whole number of octaves -- a real, distinct failure mode (YIN locking
  // onto a harmonic/subharmonic, see src/audio/range.js's own header) that a
  // caller tuning the search band wants visibility into separately from a
  // note that was simply never heard or wholly invented.
  const octave = greedyMatch(
    ref,
    est,
    onsetToleranceSec,
    (r, e) => r.midi !== e.midi && (r.midi - e.midi) % 12 === 0,
    hits.usedRef,
    hits.usedEst
  );

  const matched = hits.pairs.length;
  const precision = est.length ? matched / est.length : 1;
  const recall = ref.length ? matched / ref.length : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const onsetErrors = hits.pairs.map((p) => Math.abs(ref[p.i].onset - est[p.j].onset));
  const releaseErrors = hits.pairs.map((p) => Math.abs(ref[p.i].onset + ref[p.i].dur - (est[p.j].onset + est[p.j].dur)));

  const falsePositives = est.length - hits.usedEst.size - octave.usedEst.size;
  const misses = ref.length - hits.usedRef.size - octave.usedRef.size;

  return {
    precision,
    recall,
    f1,
    onsetErrorMs: summarizeMs(onsetErrors),
    releaseErrorMs: summarizeMs(releaseErrors),
    falsePositives,
    misses,
    octaveErrors: octave.pairs.length,
  };
}

// ---- Minimal WAV reader/writer (PCM16 and 32-bit float, mono or multi- ---
// channel downmixed to mono by averaging) -- no npm dependency, since the
// corpus this reads never needs one either. Handles exactly the two common
// `fmt ` codes a recorder or `ffmpeg -c:a pcm_s16le`/`pcm_f32le` produces:
// 1 (integer PCM) and 3 (IEEE float). Anything else throws a plain-language
// error naming the unsupported code, rather than silently misreading it.
export function readWav(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('readWav: not a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === 'fmt ') {
      fmt = {
        formatCode: buf.readUInt16LE(chunkStart),
        channels: buf.readUInt16LE(chunkStart + 2),
        sampleRate: buf.readUInt32LE(chunkStart + 4),
        bitsPerSample: buf.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      dataOffset = chunkStart;
      dataLength = chunkSize;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }
  if (!fmt) throw new Error('readWav: missing fmt chunk');
  if (dataOffset < 0) throw new Error('readWav: missing data chunk');

  const bytesPerSample = fmt.bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * fmt.channels));
  const pcm = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const sampleOffset = dataOffset + (i * fmt.channels + c) * bytesPerSample;
      let v;
      if (fmt.formatCode === 1 && fmt.bitsPerSample === 16) {
        v = buf.readInt16LE(sampleOffset) / 32768;
      } else if (fmt.formatCode === 3 && fmt.bitsPerSample === 32) {
        v = buf.readFloatLE(sampleOffset);
      } else {
        throw new Error(`readWav: unsupported format code ${fmt.formatCode} at ${fmt.bitsPerSample}-bit`);
      }
      sum += v;
    }
    pcm[i] = sum / fmt.channels;
  }
  return { pcm, sampleRate: fmt.sampleRate };
}

// Encodes a mono Float32Array (samples in [-1, 1]) as a PCM-16 mono WAV
// buffer. Only used by the test that proves readWav round-trips correctly
// and, optionally, by anyone recording a fixture clip -- the corpus itself
// is expected to arrive as real recordings, not synthesized here.
export function encodeWavPCM16(pcm, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // format code: PCM integer
  buf.writeUInt16LE(1, 22); // channels: mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buf.writeUInt16LE(bytesPerSample, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]));
    const int16 = clamped < 0 ? clamped * 32768 : clamped * 32767;
    buf.writeInt16LE(Math.round(int16), 44 + i * bytesPerSample);
  }
  return buf;
}

// manifestDir: a directory holding manifest.json (tests/fixtures/audio/
// README.md documents the shape) plus the WAV clips it references, each
// path relative to manifestDir. Returns { clips: [{ file, instrument,
// ...evaluateClip's result }], perInstrument: { <instrument>: { meanF1,
// clipCount } } }, or { clips: [], skipped: 'no corpus' } when the manifest
// is absent, unreadable or empty -- the honest state of this repo today,
// since no clips ship with it (tests/fixtures/audio/README.md).
export function evaluateManifest(manifestDir, opts = {}) {
  const manifestPath = join(manifestDir, 'manifest.json');
  if (!existsSync(manifestPath)) return { clips: [], skipped: 'no corpus' };

  const raw = readFileSync(manifestPath, 'utf8');
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries) || !entries.length) return { clips: [], skipped: 'no corpus' };

  const clips = entries.map((entry) => {
    const wavPath = join(manifestDir, entry.file);
    const { pcm, sampleRate } = readWav(readFileSync(wavPath));
    const result = evaluateClip(pcm, entry.sampleRate || sampleRate, entry.notes, {
      instrument: entry.instrument ? { range: entry.instrument.range } : undefined,
      ...opts,
    });
    return { file: entry.file, instrument: entry.instrument, ...result };
  });

  const perInstrument = {};
  for (const clip of clips) {
    const key = typeof clip.instrument === 'string' ? clip.instrument : clip.instrument?.name || 'unknown';
    if (!perInstrument[key]) perInstrument[key] = { meanF1: 0, clipCount: 0 };
    perInstrument[key].clipCount += 1;
  }
  for (const key of Object.keys(perInstrument)) {
    const matching = clips.filter(
      (c) => (typeof c.instrument === 'string' ? c.instrument : c.instrument?.name || 'unknown') === key
    );
    perInstrument[key].meanF1 = matching.reduce((sum, c) => sum + c.f1, 0) / matching.length;
  }

  return { clips, perInstrument };
}
