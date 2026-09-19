// Pure timing math for rhythm judging. No DOM, no AudioContext, no Math.random.
//
// The bug this exists to fix: a tap was timestamped when the `pointerdown`/
// `keydown` HANDLER RAN (main-thread time, sampled with the AudioContext's
// own clock), not when the input actually happened. Any main-thread jank
// between the physical tap and the handler running — GC, layout, a slow
// frame — got silently counted as lateness. On top of that, nothing ever
// accounted for output latency (the delay between scheduling a sound and it
// reaching the speaker), so a perfectly-timed tap against what the learner
// actually HEARD could be judged early or late by tens of milliseconds,
// differently per machine.
//
// toAudioTime() converts a DOM event's own `timeStamp` (a performance-clock
// reading taken by the browser when the event was captured, not when the
// handler ran) into AudioContext seconds, using a same-instant sample of
// (performance.now(), audioContext.currentTime) as the conversion anchor.
// judgeTap() then compares that corrected time to the nearest scheduled
// beat, after subtracting a calibrated output-latency figure.

export function toAudioTime({ eventTimeStamp, perfNow, audioNow }) {
  const offset = audioNow - perfNow / 1000;
  return eventTimeStamp / 1000 + offset;
}

export function judgeTap({ tapTime, beatTimes, latencyMs, windowMs }) {
  if (!Array.isArray(beatTimes) || !beatTimes.length) {
    return { ok: false, errorMs: null, beatIndex: -1 };
  }
  const adjusted = tapTime - (latencyMs || 0) / 1000;
  let beatIndex = 0;
  let best = Infinity;
  for (let i = 0; i < beatTimes.length; i++) {
    const d = Math.abs(adjusted - beatTimes[i]);
    if (d < best) {
      best = d;
      beatIndex = i;
    }
  }
  const errorMs = (adjusted - beatTimes[beatIndex]) * 1000;
  const ok = Math.abs(errorMs) <= windowMs;
  return { ok, errorMs, beatIndex };
}

export function medianLatency(samples) {
  const arr = (Array.isArray(samples) ? samples : [])
    .filter((x) => typeof x === 'number' && isFinite(x))
    .slice()
    .sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  const med = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  return Math.min(300, Math.max(0, med));
}
