// Pure metronome maths: no DOM, no AudioContext, the caller owns the clock.
export const MIN_BPM = 30;
export const MAX_BPM = 240;
export const DEFAULT_BPM = 80;

// Whole-number tempo inside 30..240; anything that is not a finite number falls back to 80.
export function clampBpm(n) {
  const v = typeof n === 'string' && n.trim() !== '' ? Number(n) : n;
  if (typeof v !== 'number' || !isFinite(v)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(v)));
}

// `count` beats from startTime (seconds), 60/bpm apart; beat 0 of each bar is the accent.
export function beatTimes(startTime, bpm, beatsPerBar, count, firstBeat = 0) {
  const step = 60 / clampBpm(bpm);
  const per = Math.max(1, Math.floor(beatsPerBar) || 4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const beat = (firstBeat + i) % per;
    out.push({ time: startTime + i * step, beat, accent: beat === 0 });
  }
  return out;
}
