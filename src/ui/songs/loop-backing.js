// Wiring between src/audio/stretch/loop.js's difficulty ladder (createTransport's
// setRate/onMiss/onCleanLoop, written but unconnected -- see that file's header
// comment) and the Songs practice lesson's tempo-ladder step: each attempt at
// a 'tempo-ladder' step feeds the transport (a judged miss -> onMiss(), a
// fully clean attempt -> onCleanLoop()), and the transport's current rate
// scales the step's own bpm for the next synth-backing playback and is shown
// to the learner in plain words. Pure functions only -- no DOM, no
// AudioContext -- src/ui/songs.js owns the createTransport instance (one per
// tempo-ladder step attempted) and calls these around its own playback and
// judging code, following the pattern src/ui/playalong.js already uses for
// createTransport + stretch().
//
// No WSOLA-stretched original recording here: the shared Song shape
// (src/song/model.js schema 'song/1') carries no original-audio field on any
// song source in this codebase (starter songs are MIDI-style note lists;
// imported songs -- .mid/.abc/.xml/.gp/.bandpack -- are also just note data),
// so there is nothing to feed src/audio/stretch/wsola.js's stretch() here.
// Only the synthesized backing (api.tone(), scheduled by src/ui/songs.js's
// playPhrase()) is scaled by the ladder's rate. If a future song source ever
// carries a real recording, wire stretch() the way playalong.js does.

import { createTransport } from '../../audio/stretch/loop.js';
import { passesRule } from './practice.js';

// One transport per tempo-ladder step attempt cycle. durationSec/beatTimes
// are irrelevant here -- this call site only ever uses getRate/setRate/
// onMiss/onCleanLoop, never positionAfter/loopCountAfter, so the transport
// is created with no loop points at all.
export function createLoopBackingTransport() {
  return createTransport({});
}

// judged: a judgeAttempt() result ({ hitCount, judgedCount, ... }, see
// src/ui/songs/practice.js). passRule: the step's own passRule (same object
// src/song/lesson.js's buildLessonPlan wrote, same one passesRule() judges
// the step's pass/fail against) -- a "clean" attempt now means the attempt
// actually PASSED that rule, not just hitCount === judgedCount: hitting
// every note while blowing the timing, hold/tune, or extra-notes rule is
// not clean, and should not speed the backing up. When passRule is
// null/undefined (a caller that has none, or an older call site) this falls
// back to the original hit-count-only check so nothing already using this
// without a passRule changes behaviour. A step with nothing judged yet
// (judgedCount 0) always counts as a miss -- there is no such thing as a
// "clean" attempt with nothing played. Returns the transport's new rate.
export function applyAttemptToTransport(transport, judged, passRule) {
  const hasJudged = !!judged && judged.judgedCount > 0;
  const clean = hasJudged && (passRule ? passesRule(judged, passRule) : judged.hitCount === judged.judgedCount);
  return clean ? transport.onCleanLoop() : transport.onMiss();
}

// Effective playback tempo for a tempo-ladder step: the step's own rung bpm
// scaled by the transport's current rate, rounded to the nearest whole bpm
// (matches how every other step already schedules a whole-number bpm) and
// floored at 1 so a pathologically low rate never yields a zero or negative
// tempo.
export function backingBpm(stepBpm, rate) {
  return Math.max(1, Math.round(stepBpm * rate));
}

// Plain-language rate readout for the learner, e.g. "Playing at 90% speed".
// Full speed (rate clamped at loop.js's own ceiling of 1.0) reads as "Full
// speed" rather than "Playing at 100% speed" -- shorter, and matches how the
// step passes once it gets there.
export function rateLabel(rate) {
  const pct = Math.round(rate * 100);
  return pct >= 100 ? 'Full speed' : 'Playing at ' + pct + '% speed';
}
