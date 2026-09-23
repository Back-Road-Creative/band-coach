// Pure count-in scheduler for the "Learn this" panel's mic door (src/ui/
// learn.js, plan §11.5.7, unit G1b): turns a tempo and a beat count into the
// click times themselves play at, so the timing lives in one place a test
// can check with no AudioContext, no timers, no DOM -- the caller (learn.js)
// hands these straight to panelApi.click(at, accent), the same clock every
// other click in the app already uses.
export const MIN_BPM = 40;
export const MAX_BPM = 200;
export const DEFAULT_BPM = 90;

// Clamps to the panel's tempo input range (40-200), defaulting anything
// missing or unusable (undefined, NaN, a non-numeric string) to 90 -- never
// lets a stray value schedule an unplayably fast or slow count-in.
export function clampBpm(bpm) {
  const n = Number(bpm);
  if (!Number.isFinite(n)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, n));
}

// beats click times, one per beat, `startSec` for the first and 60/bpm
// seconds apart after that -- the same "click(at, accent)" shape app.js's
// own count-ins (startBar/startGroove) already schedule with.
export function countInTimes(bpm, beats = 4, startSec = 0) {
  const n = Number(beats);
  if (!Number.isFinite(n) || n <= 0) return [];
  const spb = 60 / clampBpm(bpm);
  const times = [];
  for (let i = 0; i < n; i++) times.push(startSec + i * spb);
  return times;
}
