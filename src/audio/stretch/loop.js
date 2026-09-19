// Pure loop/transport maths for the "play along with your own recording"
// mode: A/B loop points snapped to beat times, count-in length, mapping an
// elapsed OUTPUT-timeline position (i.e. seconds of audio actually heard,
// after time-stretch) back to a source-timeline position with loop
// wraparound, and the difficulty ladder that adjusts playback rate after a
// miss or a clean loop.
//
// No DOM, no AudioContext, no Math.random, no Date.now() — this module only
// computes numbers from the arguments it is given. It does not touch
// src/audio/stretch/wsola.js at all; a later wiring pass is expected to:
//   1. call createTransport({ durationSec, beatTimes }) once the learner's
//      recording and its detected beat grid are known,
//      transport.setLoop(aSeconds, bSeconds) when the learner drags loop
//      handles, and transport.setCountInBeats(n) / .countInSeconds(bpm) to
//      size the pre-roll,
//   2. on every audio callback, read transport.getRate() and pass it as the
//      `rate` for src/audio/stretch/wsola.js's stretcher, then convert the
//      output sample position it is currently emitting to output-seconds
//      and call transport.positionAfter(outputSeconds) to know which
//      source-timeline sample to display / highlight,
//   3. call transport.onMiss() / transport.onCleanLoop() from the judging
//      logic to drive the ladder, and read transport.getRate() again for
//      the next stretch call.

const RATE_FLOOR = 0.5;
const RATE_CEIL = 1.0;
const SLOWDOWN_FACTOR = 0.9; // 10% slower after a miss
const SPEEDUP_FACTOR = 1.05; // 5% faster after a clean loop

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Nearest entry in a sorted-or-unsorted array of beat times (seconds).
// Returns `t` unchanged when `beatTimes` is empty.
function snapToNearest(t, beatTimes) {
  if (!beatTimes || beatTimes.length === 0) return t;
  let best = beatTimes[0];
  let bestDist = Math.abs(t - best);
  for (let i = 1; i < beatTimes.length; i++) {
    const d = Math.abs(t - beatTimes[i]);
    if (d < bestDist) {
      bestDist = d;
      best = beatTimes[i];
    }
  }
  return best;
}

export function createTransport(options) {
  const opts = options || {};
  const durationSec = opts.durationSec != null ? opts.durationSec : 0;
  const beatTimes = opts.beatTimes ? opts.beatTimes.slice().sort((a, b) => a - b) : [];

  let loopStart = 0;
  let loopEnd = durationSec;
  let countInBeats = 0;
  let rate = 1.0;

  function setLoop(aTime, bTime) {
    const a = snapToNearest(clamp(aTime, 0, durationSec), beatTimes);
    const b = snapToNearest(clamp(bTime, 0, durationSec), beatTimes);
    if (!(b > a)) {
      throw new Error('loop end must be after loop start');
    }
    loopStart = a;
    loopEnd = b;
    return { start: loopStart, end: loopEnd };
  }

  function getLoop() {
    return { start: loopStart, end: loopEnd };
  }

  function setCountInBeats(n) {
    countInBeats = Math.max(0, n);
    return countInBeats;
  }

  function getCountInBeats() {
    return countInBeats;
  }

  // Seconds of silent/click pre-roll before the loop starts, at the given tempo.
  function countInSeconds(bpm) {
    if (!bpm || bpm <= 0) return 0;
    return countInBeats * (60 / bpm);
  }

  function getRate() {
    return rate;
  }

  function setRate(r) {
    rate = clamp(r, RATE_FLOOR, RATE_CEIL);
    return rate;
  }

  // Ladder: back off after a miss, ramp back up after a clean pass through
  // the loop. Both moves are multiplicative and capped to [0.5, 1.0].
  function onMiss() {
    rate = clamp(rate * SLOWDOWN_FACTOR, RATE_FLOOR, RATE_CEIL);
    return rate;
  }

  function onCleanLoop() {
    rate = clamp(rate * SPEEDUP_FACTOR, RATE_FLOOR, RATE_CEIL);
    return rate;
  }

  // Maps elapsed OUTPUT-timeline seconds (time actually heard, after
  // time-stretch) to a source-timeline position inside the current loop,
  // wrapping at the loop boundaries. `rateArg` overrides the transport's
  // own rate for this call (useful for testing / precomputing a schedule)
  // and defaults to the current ladder rate.
  function positionAfter(outputSeconds, rateArg) {
    const r = rateArg != null ? rateArg : rate;
    const loopLen = loopEnd - loopStart;
    if (!(loopLen > 0)) return loopStart;
    const sourceElapsed = outputSeconds * r;
    const wrapped = ((sourceElapsed % loopLen) + loopLen) % loopLen;
    return loopStart + wrapped;
  }

  // How many full loop passes have completed by the given output-timeline
  // second (useful for deciding when "one clean loop" has actually elapsed).
  function loopCountAfter(outputSeconds, rateArg) {
    const r = rateArg != null ? rateArg : rate;
    const loopLen = loopEnd - loopStart;
    if (!(loopLen > 0)) return 0;
    const sourceElapsed = outputSeconds * r;
    return Math.floor(sourceElapsed / loopLen);
  }

  return {
    setLoop,
    getLoop,
    setCountInBeats,
    getCountInBeats,
    countInSeconds,
    getRate,
    setRate,
    onMiss,
    onCleanLoop,
    positionAfter,
    loopCountAfter,
  };
}
