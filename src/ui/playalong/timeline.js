// Pure timeline maths for the "play along with a recording" panel: turning
// analyse()'s per-beat chord output into time-ranged segments for display,
// the low-confidence threshold that gates the plain "I'm not sure" label,
// and clamping a drag/keyboard loop selection to the recording's length.
// No DOM — src/ui/playalong.js draws from these.

const DEFAULT_LOW_CONFIDENCE = 0.35;
const MIN_LOOP_SECONDS = 0.25;

// chords: [{ startBeat, symbol, confidence }] as returned by
// src/audio/analysis/chords.js (one entry per beat, `beats[startBeat]` is
// its time in seconds). Consecutive beats sharing a symbol are merged into
// one segment; each segment's confidence is the mean of the beats it spans.
export function chordSegments(chords, beats, durationSec) {
  if (!chords || chords.length === 0) return [];
  const segments = [];
  let cur = null;
  for (const c of chords) {
    const start = beats[c.startBeat] ?? 0;
    if (cur && cur.symbol === c.symbol) {
      cur._sum += c.confidence;
      cur._n += 1;
    } else {
      if (cur) segments.push(cur);
      cur = { start, symbol: c.symbol, _sum: c.confidence, _n: 1 };
    }
  }
  if (cur) segments.push(cur);
  for (let i = 0; i < segments.length; i++) {
    segments[i].end = i + 1 < segments.length ? segments[i + 1].start : durationSec;
  }
  return segments.map((s) => ({
    start: s.start,
    end: s.end,
    symbol: s.symbol,
    confidence: s._sum / s._n,
  }));
}

// Below this, the panel shows a plain "I'm not sure" instead of the guess.
export function isLowConfidence(confidence, threshold = DEFAULT_LOW_CONFIDENCE) {
  return confidence < threshold;
}

// Orders a raw (possibly reversed, out-of-range) drag-or-keyboard selection,
// clamps it to [0, durationSec], and nudges it to at least minLen seconds so
// a click (zero-length drag) never produces an unplayable loop.
export function clampLoopSelection(aRaw, bRaw, durationSec, minLen = MIN_LOOP_SECONDS) {
  const clamp = (v) => Math.min(durationSec, Math.max(0, v));
  const a = clamp(aRaw);
  const b = clamp(bRaw);
  let start = Math.min(a, b);
  let end = Math.max(a, b);
  if (end - start < minLen) {
    end = start + minLen;
    if (end > durationSec) {
      end = durationSec;
      start = Math.max(0, end - minLen);
    }
  }
  return { start, end };
}
