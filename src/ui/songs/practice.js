// Pure judging for one song-practice step (src/song/lesson.js
// buildLessonPlan): compares what a learner actually played against what
// the step expected, and decides pass/fail against the step's passRule.
// No DOM, no AudioContext, no clock reads — every timestamp is a parameter,
// so this runs under plain `node --test` and the UI layer (src/ui/songs.js)
// supplies real clocks and real detected notes.

import { judgePitch } from '../../core/judge.js';

function ticksToSec(ticks, bpm, ticksPerQuarter) {
  return (ticks / ticksPerQuarter) * (60 / bpm);
}

// expectedNotes: [{ start, dur, midi }] in ticks (a step's `notes`, already
// fitted to the instrument by buildLessonPlan/fitToInstrument).
// playedEvents: [{ midi, atSec }], in the order they were detected, atSec
// measured from the moment the learner was told to start playing.
// opts.timed: false for the "pitches" step kind (out of time; matched by
// order only, no timing error computed) — every other kind is timed.
// opts.policy: the instrument's octave policy (src/core/judge.js), so e.g.
// a singer's octave is never marked wrong.
export function judgeAttempt(expectedNotes, playedEvents, opts = {}) {
  const { bpm, ticksPerQuarter = 480, policy = 'exact', timed = true } = opts;
  const notes = expectedNotes || [];
  const played = playedEvents || [];
  const matches = [];
  let cursor = 0;
  for (const note of notes) {
    const expectedAt = timed ? ticksToSec(note.start, bpm, ticksPerQuarter) : null;
    let foundAt = -1;
    for (let i = cursor; i < played.length; i++) {
      if (judgePitch({ heardMidi: played[i].midi, targetMidi: note.midi, policy }).ok) {
        foundAt = i;
        break;
      }
    }
    if (foundAt === -1) {
      matches.push({ note, played: null, ok: false, errorMs: null });
      continue;
    }
    const errorMs = timed ? (played[foundAt].atSec - expectedAt) * 1000 : null;
    matches.push({ note, played: played[foundAt], ok: true, errorMs });
    cursor = foundAt + 1;
  }
  const hits = matches.filter((m) => m.ok);
  const hitRate = notes.length ? hits.length / notes.length : 0;
  const errored = hits.map((m) => m.errorMs).filter((e) => e !== null).map(Math.abs);
  const meanErrorMs = errored.length ? errored.reduce((a, b) => a + b, 0) / errored.length : null;
  return { matches, judgedCount: notes.length, hitCount: hits.length, hitRate, meanErrorMs };
}

// Whether a judgeAttempt() result satisfies a step's passRule. A null
// passRule (the "listen" step kind) always passes — there is nothing to
// judge, the learner just heard the phrase.
export function passesRule(result, passRule) {
  if (!passRule) return true;
  if (result.hitRate < passRule.hitRate) return false;
  if (passRule.maxMeanErrorMs != null) {
    if (result.meanErrorMs == null) return result.judgedCount === 0;
    if (result.meanErrorMs > passRule.maxMeanErrorMs) return false;
  }
  return true;
}
