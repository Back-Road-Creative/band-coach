// Pure judging for one song-practice step (src/song/lesson.js
// buildLessonPlan): compares what a learner actually played against what
// the step expected, and decides pass/fail against the step's passRule.
// No DOM, no AudioContext, no clock reads — every timestamp is a parameter,
// so this runs under plain `node --test` and the UI layer (src/ui/songs.js)
// supplies real clocks and real detected notes.

import { judgePitch } from '../../core/judge.js';
import { noteName } from '../fingerings/notes.js';

function ticksToSec(ticks, bpm, ticksPerQuarter) {
  return (ticks / ticksPerQuarter) * (60 / bpm);
}

// Shared with judgeAttempt's own opts.durationTolerance default below and
// holdTuneFeedback()'s per-hit direction check -- one number, not two, so a
// hit that reads "outside the band" in the score always means the same
// thing it means in the feedback text.
const DEFAULT_DURATION_TOLERANCE = { min: 0.6, max: 1.5 };

// The ONE phrase-local clock (BC-01): seconds from a step's originTick (its
// phrase's segment start -- the bar src/song/lesson.js cut the phrase at,
// so a pickup rest before the first note is kept) to `tick`. src/ui/songs.js
// schedules playback with this, starts capture at this clock's zero, and
// judgeAttempt() below computes every expected onset with it -- so what the
// learner hears, when they are told to start, and what they are judged
// against can never disagree.
export function phraseSec(tick, originTick, bpm, ticksPerQuarter) {
  return ticksToSec(tick - (originTick || 0), bpm, ticksPerQuarter);
}

// A keyboard player's MIDI events for a chord (several expected notes at the
// same `start` tick) arrive in whatever order fingers land — reverse order,
// or a few ms apart (a "rolled" chord) — never guaranteed to match the order
// the notes are listed in the song. CHORD_SPREAD_MS is how far apart (from
// the first matched note of the chord) a played event can still count as
// "part of this chord" rather than the start of the next thing.
const CHORD_SPREAD_MS = 80;

// Group expected notes into chords: consecutive notes sharing the same
// `start` tick are one chord (a single note is a chord of size 1, and takes
// the exact old forward-only path so single-note judging never changes).
function groupIntoChords(notes) {
  const groups = [];
  for (const note of notes) {
    const last = groups[groups.length - 1];
    if (last && last[0].start === note.start) last.push(note);
    else groups.push([note]);
  }
  return groups;
}

function matchOneNote(note, hit, timed, expectedAt, bpm, ticksPerQuarter) {
  const errorMs = timed ? (hit.atSec - expectedAt) * 1000 : null;
  let durRatio = null;
  if (hit.durSec != null && note.dur != null) {
    const expectedDurSec = ticksToSec(note.dur, bpm, ticksPerQuarter);
    durRatio = expectedDurSec > 0 ? hit.durSec / expectedDurSec : null;
  }
  const cents = hit.cents != null ? hit.cents : null;
  const velocityError = hit.velocity != null && note.velocity != null ? hit.velocity - note.velocity : null;
  return { note, played: hit, ok: true, errorMs, durRatio, cents, velocityError };
}

function missedNote(note) {
  return { note, played: null, ok: false, errorMs: null, durRatio: null, cents: null, velocityError: null };
}

// Onset-only matching for a "rhythm" step: every played event is assigned to
// the expected onset (chord) nearest it in time; each onset keeps its nearest
// assigned event, which then counts for every note of that chord (one clap
// covers a chord). Unclaimed events are extras. Order-free and pitch-free, so
// one stray clap never shifts every later beat, and a missed beat is a miss.
function judgeOnsets(chords, played, onsetAt, matches, extraList, bpm, ticksPerQuarter, policy) {
  const times = chords.map((c) => onsetAt(c[0].start));
  const best = times.map(() => -1);
  played.forEach((ev, i) => {
    let k = -1;
    times.forEach((t, j) => { if (k === -1 || Math.abs(ev.atSec - t) < Math.abs(ev.atSec - times[k])) k = j; });
    if (k === -1) return;
    if (best[k] === -1 || Math.abs(ev.atSec - times[k]) < Math.abs(played[best[k]].atSec - times[k])) best[k] = i;
  });
  const used = new Set(best);
  played.forEach((ev, i) => { if (!used.has(i)) extraList.push(ev); });
  // pitchOk: whether the hit also had this note's pitch (false for a clap) --
  // never part of passing, only so a caller credits pitch practice truthfully.
  chords.forEach((chord, k) => chord.forEach((note) => {
    if (best[k] === -1) { matches.push(missedNote(note)); return; }
    const hit = played[best[k]];
    const m = matchOneNote(note, hit, true, times[k], bpm, ticksPerQuarter);
    m.pitchOk = hit.midi != null && judgePitch({ heardMidi: hit.midi, targetMidi: note.midi, policy }).ok;
    matches.push(m);
  }));
}

// expectedNotes: [{ start, dur, midi, velocity? }] in ticks (a step's
// `notes`, already fitted to the instrument by buildLessonPlan/fitToInstrument).
// playedEvents: [{ midi, atSec, durSec?, cents?, velocity? }], in the order
// they were detected, atSec measured from the moment the learner was told
// to start playing. durSec/cents/velocity are optional — a MIDI keyboard
// supplies durSec (closed by that same note's next press, or by the end of
// the try; see songs.js's pushMidiEvent/closeOpenMidiEvents), but cents and
// velocity, and durSec from the mic pipeline (which only reports pitch and
// onset time), are not supplied yet, so every field they alone feed (cents,
// velocityError, meanAbsCents, dynamicsScore) stays null until a caller
// starts passing them, and every existing field is computed exactly as before.
// opts.originTick: the step's phrase origin (see phraseSec above); playedEvents'
// atSec are seconds from that same origin. Defaults to 0 (song start).
// opts.onsetsOnly: true for the "rhythm" step kind (Clap the rhythm) --
// pitch is ignored, so any pitch or an unpitched clap ({ midi: null }) counts;
// each expected onset takes the played event nearest to it in time (see
// judgeOnsets below) and early/late still fails through passRule's timing.
// opts.timed: false for the "pitches" step kind (out of time; matched by
// order only, no timing error computed) — every other kind is timed.
// opts.policy: the instrument's octave policy (src/core/judge.js), so e.g.
// a singer's octave is never marked wrong.
// opts.durationTolerance: { min, max } durRatio band counted as "held about
// right" for durationScore (default 0.6..1.5 — a note held clearly too short
// or too long should not read as in tune/in time but wrong duration).
// opts.velocityTolerance: max |velocityError| (MIDI 0-127 units) counted as
// "about as loud as asked" for dynamicsScore (default 24 — roughly one
// dynamic step; no spec value was given, chosen as a first pass).
export function judgeAttempt(expectedNotes, playedEvents, opts = {}) {
  const {
    bpm,
    ticksPerQuarter = 480,
    policy = 'exact',
    timed = true,
    durationTolerance = DEFAULT_DURATION_TOLERANCE,
    velocityTolerance = 24,
    originTick = 0,
    onsetsOnly = false,
  } = opts;
  const notes = expectedNotes || [];
  const played = playedEvents || [];
  const matches = [];
  const extraList = [];
  const onsetAt = (tick) => phraseSec(tick, originTick, bpm, ticksPerQuarter);
  let cursor = 0;
  if (onsetsOnly) judgeOnsets(groupIntoChords(notes), played, onsetAt, matches, extraList, bpm, ticksPerQuarter, policy);
  for (const chord of onsetsOnly ? [] : groupIntoChords(notes)) {
    if (chord.length === 1) {
      // Single expected note at this tick: the original forward-only
      // search, unchanged — no chord window, no extras.
      const note = chord[0];
      const expectedAt = timed ? onsetAt(note.start) : null;
      let foundAt = -1;
      for (let i = cursor; i < played.length; i++) {
        if (judgePitch({ heardMidi: played[i].midi, targetMidi: note.midi, policy }).ok) {
          foundAt = i;
          break;
        }
      }
      if (foundAt === -1) {
        matches.push(missedNote(note));
        continue;
      }
      matches.push(matchOneNote(note, played[foundAt], timed, expectedAt, bpm, ticksPerQuarter));
      cursor = foundAt + 1;
      continue;
    }
    // A chord: several expected notes share this tick. Find the first
    // played event (from cursor onward) that matches any still-unmatched
    // chord note — that is the "anchor" that fixes the chord's window in
    // time. Every played event up to CHORD_SPREAD_MS after the anchor is
    // eligible to match any chord note, in any order.
    let anchorIndex = -1;
    for (let i = cursor; i < played.length && anchorIndex === -1; i++) {
      for (const note of chord) {
        if (judgePitch({ heardMidi: played[i].midi, targetMidi: note.midi, policy }).ok) {
          anchorIndex = i;
          break;
        }
      }
    }
    if (anchorIndex === -1) {
      for (const note of chord) matches.push(missedNote(note));
      continue;
    }
    const windowEnd = played[anchorIndex].atSec + CHORD_SPREAD_MS / 1000;
    let windowEndIdx = anchorIndex;
    for (let i = anchorIndex + 1; i < played.length && played[i].atSec <= windowEnd; i++) windowEndIdx = i;
    const usedIdx = new Set();
    const expectedAt = timed ? onsetAt(chord[0].start) : null;
    for (const note of chord) {
      let foundIdx = -1;
      for (let i = anchorIndex; i <= windowEndIdx; i++) {
        if (usedIdx.has(i)) continue;
        if (judgePitch({ heardMidi: played[i].midi, targetMidi: note.midi, policy }).ok) {
          foundIdx = i;
          break;
        }
      }
      if (foundIdx === -1) {
        matches.push(missedNote(note));
        continue;
      }
      usedIdx.add(foundIdx);
      matches.push(matchOneNote(note, played[foundIdx], timed, expectedAt, bpm, ticksPerQuarter));
    }
    // Anything struck inside the chord's window that no expected note
    // claimed is a wrong extra note, not a miss — it does not lower
    // hitRate, but the learner should still be told they played it.
    for (let i = anchorIndex; i <= windowEndIdx; i++) {
      if (!usedIdx.has(i)) extraList.push(played[i]);
    }
    cursor = windowEndIdx + 1;
  }
  const hits = matches.filter((m) => m.ok);
  const hitRate = notes.length ? hits.length / notes.length : 0;
  const errored = hits.map((m) => m.errorMs).filter((e) => e !== null).map(Math.abs);
  const meanErrorMs = errored.length ? errored.reduce((a, b) => a + b, 0) / errored.length : null;
  const centsHits = hits.map((m) => m.cents).filter((c) => c !== null);
  const absCents = centsHits.map(Math.abs);
  const meanAbsCents = absCents.length ? absCents.reduce((a, b) => a + b, 0) / absCents.length : null;
  // meanCents: the SIGNED mean (sharp positive, flat negative), unlike
  // meanAbsCents above -- passesRule() judges the absolute value (a phrase
  // that wanders equally sharp and flat is not "in tune" just because the
  // errors cancel out), but the feedback line below needs a direction to
  // tell the learner which way to correct.
  const meanCents = centsHits.length ? centsHits.reduce((a, b) => a + b, 0) / centsHits.length : null;
  const durRatios = hits.map((m) => m.durRatio).filter((d) => d !== null);
  const durationScore = durRatios.length
    ? durRatios.filter((d) => d >= durationTolerance.min && d <= durationTolerance.max).length / durRatios.length
    : null;
  // dynamicsScore only exists when the phrase itself carries velocity
  // targets — a song with no dynamics markings has nothing to judge here.
  const notesHaveVelocity = notes.some((n) => n.velocity != null);
  const velocityErrors = hits.map((m) => m.velocityError).filter((v) => v !== null);
  const dynamicsScore = notesHaveVelocity && velocityErrors.length
    ? velocityErrors.filter((v) => Math.abs(v) <= velocityTolerance).length / velocityErrors.length
    : notesHaveVelocity ? null : null;
  return {
    matches,
    judgedCount: notes.length,
    hitCount: hits.length,
    hitRate,
    meanErrorMs,
    meanAbsCents,
    meanCents,
    durationScore,
    dynamicsScore,
    // Wrong notes struck alongside a chord, inside its spread window —
    // reported so the learner sees what they actually played, but never
    // counted against hitRate (see the chord-matching loop above).
    extras: { count: extraList.length, list: extraList },
  };
}

// Whether a judgeAttempt() result satisfies a step's passRule. A null
// passRule (the "listen" step kind) always passes — there is nothing to
// judge, the learner just heard the phrase.
export function passesRule(result, passRule) {
  if (!passRule) return true;
  if (result.hitRate < passRule.hitRate) return false;
  if (passRule.maxMeanErrorMs != null) {
    if (result.meanErrorMs == null) { if (result.judgedCount !== 0) return false; }
    else if (result.meanErrorMs > passRule.maxMeanErrorMs) return false;
  }
  if (passRule.maxMeanAbsCents != null && result.meanAbsCents != null) {
    if (result.meanAbsCents > passRule.maxMeanAbsCents) return false;
  }
  if (passRule.minDurationScore != null && result.durationScore != null) {
    if (result.durationScore < passRule.minDurationScore) return false;
  }
  // A wrong note struck alongside a chord (judgeAttempt's extras, above)
  // never lowers hitRate -- that is deliberate chord-spread leniency, not a
  // pass on its own -- so a step whose passRule sets maxExtras still has to
  // gate on it separately here.
  if (passRule.maxExtras != null && result.extras && result.extras.count > passRule.maxExtras) return false;
  return true;
}

// Plain-word feedback for a FAILED step that fell down ONLY on hold or tune
// -- everything else about it (hit rate, timing) was fine, so telling the
// learner the one concrete thing to fix beats the generic "try that again"
// src/ui/songs.js falls back to otherwise. Returns null when there is no
// hold/tune rule to judge, or when hit rate or timing is what actually
// failed (those keep the existing generic message -- singling out hold/tune
// there would be misleading).
export function holdTuneFeedback(result, passRule) {
  if (!passRule) return null;
  if (result.hitRate < passRule.hitRate) return null;
  if (passRule.maxMeanErrorMs != null) {
    if (result.meanErrorMs == null) { if (result.judgedCount !== 0) return null; }
    else if (result.meanErrorMs > passRule.maxMeanErrorMs) return null;
  }
  const holdFailed = passRule.minDurationScore != null && result.durationScore != null
    && result.durationScore < passRule.minDurationScore;
  const tuneFailed = passRule.maxMeanAbsCents != null && result.meanAbsCents != null
    && result.meanAbsCents > passRule.maxMeanAbsCents;
  if (!holdFailed && !tuneFailed) return null;
  const holdWords = holdFailed ? holdDirectionWords(result) : null;
  const capitalized = holdWords ? holdWords.charAt(0).toUpperCase() + holdWords.slice(1) : null;
  if (holdFailed && tuneFailed) return capitalized + ', right in the middle of the pitch.';
  if (holdFailed) return capitalized + '.';
  const sharp = result.meanCents == null || result.meanCents >= 0;
  return sharp
    ? 'A little sharp — aim for the middle of the note.'
    : 'A little flat — aim for the middle of the note.';
}

// Plain-word feedback for a FAILED step, naming the FIRST thing passesRule
// (above) found wrong -- same order passesRule checks in -- instead of the
// generic "try that again" src/ui/songs.js used to always fall back to.
// Returns null when the try passed, or when there is no passRule to judge
// against (the "listen" step kind).
export function firstCorrection(result, passRule) {
  if (!passRule) return null;
  if (passesRule(result, passRule)) return null;
  if (result.hitRate < passRule.hitRate) {
    const miss = (result.matches || []).find((m) => !m.ok);
    if (miss) {
      const midi = miss.note && miss.note.midi;
      // A rhythm step's ("Clap the rhythm") missed onset has no pitch of its
      // own worth naming -- it is a missed beat, not a missed note.
      if (midi == null) return 'Missed a beat — ' + result.hitCount + ' of ' + result.judgedCount + '.';
      return 'Missed the ' + noteName(midi) + ' — ' + result.hitCount + ' of ' + result.judgedCount + ' notes.';
    }
  }
  if (passRule.maxMeanErrorMs != null) {
    const timingFailed = result.meanErrorMs == null
      ? result.judgedCount !== 0
      : result.meanErrorMs > passRule.maxMeanErrorMs;
    if (timingFailed) {
      const timed = (result.matches || []).filter((m) => m.ok && m.errorMs != null);
      if (timed.length) {
        const worst = timed.reduce((a, b) => (Math.abs(b.errorMs) > Math.abs(a.errorMs) ? b : a));
        const midi = worst.note && worst.note.midi;
        if (midi != null) {
          const ms = Math.round(Math.abs(worst.errorMs));
          const direction = worst.errorMs >= 0 ? 'late' : 'early';
          return noteName(midi) + ' was ' + direction + ' by ' + ms + ' ms — aim for the beat.';
        }
      }
    }
  }
  const holdTune = holdTuneFeedback(result, passRule);
  if (holdTune) return holdTune;
  if (passRule.maxExtras != null && result.extras && result.extras.count > passRule.maxExtras) {
    const first = result.extras.list && result.extras.list[0];
    const midi = first && first.midi;
    return midi != null
      ? 'An extra ' + noteName(midi) + ' crept in — just the written notes.'
      : 'An extra note crept in — just the written notes.';
  }
  // Nothing above pinned down a concrete cause -- keep the old generic line
  // as the explicit, tested fallback rather than a silent null.
  return 'Not quite yet — try that again.';
}

// durationScore (judgeAttempt, above) drops both for notes cut off early
// (durRatio below durationTolerance.min) AND notes over-held into the next
// one (durRatio above .max) -- the SAME low score either way, so telling the
// learner to hold "longer" when they are actually running long sends them
// the wrong direction. Looks at the judged hits' own durRatio (result.matches,
// see matchOneNote above) that fall outside the band and picks a direction;
// falls back to the old always-"longer" wording when no per-hit data is
// available (a result built by hand, or every hit's durRatio was null).
function holdDirectionWords(result) {
  const outside = (result.matches || [])
    .filter((m) => m.ok && m.durRatio != null)
    .filter((m) => m.durRatio < DEFAULT_DURATION_TOLERANCE.min || m.durRatio > DEFAULT_DURATION_TOLERANCE.max);
  if (outside.length === 0) return 'hold each note a little longer';
  const long = outside.filter((m) => m.durRatio > DEFAULT_DURATION_TOLERANCE.max).length;
  const short = outside.filter((m) => m.durRatio < DEFAULT_DURATION_TOLERANCE.min).length;
  if (long > 0 && short === 0) return "let each note go a little sooner — it's running into the next one";
  if (short > 0 && long === 0) return 'hold each note a little longer';
  return "match each note's length — some ran short, some ran long";
}
