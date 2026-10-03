// Pure judging for one song-practice step (src/song/lesson.js
// buildLessonPlan): compares what a learner actually played against what
// the step expected, and decides pass/fail against the step's passRule.
// No DOM, no AudioContext, no clock reads — every timestamp is a parameter,
// so this runs under plain `node --test` and the UI layer (src/ui/songs.js)
// supplies real clocks and real detected notes.

import { judgePitch } from '../../core/judge.js';
import { noteName } from '../fingerings/notes.js';
import { DEFAULT_DURATION_TOLERANCE, passesRule, failedDimension } from '../../core/pass-rule.js';
// Re-exported so existing importers (src/ui/songs.js, loop-backing.js) keep one import site.
export { passesRule, failedDimension };

function ticksToSec(ticks, bpm, ticksPerQuarter) {
  return (ticks / ticksPerQuarter) * (60 / bpm);
}

// The ONE phrase-local clock (BC-01): seconds from a step's originTick (its
// phrase's segment start -- the bar src/song/lesson.js cut the phrase at,
// so a pickup rest before the first note is kept) to `tick`. src/ui/songs.js
// schedules playback with this, starts capture at this clock's zero, and
// judgeAttempt() below computes every expected onset with it -- so what the
// learner hears, when they are told to start, and what they are judged
// against can never disagree.
// opts's fifth argument, `clock` (src/song/clock.js's createSongClock(song)),
// is optional: when given, a phrase spanning a tempoMap change is timed on
// the clock's own tempo profile between originTick and tick, scaled by how
// much slower/faster than the clock's natural tempo this step is asking for
// (bpm / clock.bpmAt(originTick) -- e.g. 0.55 for a phrase-slow step, 1 for
// full speed) rather than one flat bpm for the whole phrase. No clock: the
// original flat-tempo calculation, byte-identical to before this unit.
export function phraseSec(tick, originTick, bpm, ticksPerQuarter, clock) {
  const from = originTick || 0;
  if (clock) return clock.sec(from, tick, bpm / clock.bpmAt(from));
  return ticksToSec(tick - from, bpm, ticksPerQuarter);
}

// A keyboard player's MIDI events for a chord (several expected notes at the
// same `start` tick) arrive in whatever order fingers land — reverse order,
// or a few ms apart (a "rolled" chord) — never guaranteed to match the order
// the notes are listed in the song. CHORD_SPREAD_MS is how far apart (from
// the first matched note of the chord) a played event can still count as
// "part of this chord" rather than the start of the next thing.
const CHORD_SPREAD_MS = 80;

// A drum-name a mic hit cannot give (toms, crash, ride -- the mic's onset
// classifier only tells kick/snare/hihat apart, see src/audio/drum-classify.js
// and app.js's own KIT_MIC_UNNAMED, app.js:1347, which this copies) is judged
// leniently rather than pretending the mic can name it: a mic hit on one of
// these pieces leaves pieceOk null (below) instead of false, so it is never
// held against the learner, only the onset timing is.
export const MIC_UNNAMEABLE = new Set(['tom-floor', 'tom-mid', 'tom-high', 'crash', 'ride']);

// Whether a played drum's piece id counts as hitting `expectedPiece`. A MIDI
// kit names the exact piece (hihat-closed vs hihat-open vs hihat-pedal), but
// the mic's onset classifier only ever reports the generic 'hihat' kind (it
// cannot tell foot from stick, open from closed) -- so a mic 'hihat' matches
// any of the three expected hi-hat pieces, while a MIDI hit still has to name
// the exact one.
function pieceMatches(expectedPiece, playedPiece) {
  if (playedPiece === expectedPiece) return true;
  if (playedPiece === 'hihat' && typeof expectedPiece === 'string' && expectedPiece.indexOf('hihat') === 0) return true;
  return false;
}

// pieceOk for one matched onset: null (not assessed) when the hit named no
// piece at all, or when it came from the mic and the expected piece is one
// the mic cannot tell apart from the others (MIC_UNNAMEABLE) -- checked
// before the null-piece check since a mic hit on one of those pieces is
// unassessed even on the rare tick its classifier happens to report a kind.
// true/false otherwise, from pieceMatches above.
function pieceOkFor(note, hit) {
  if (!hit) return null;
  if (hit.source === 'mic' && MIC_UNNAMEABLE.has(note.piece)) return null;
  if (hit.piece == null) return null;
  return pieceMatches(note.piece, hit.piece);
}

// Plain words for a piece id, for firstCorrection's "That was the X — this
// beat wants the Y." (below); named to match src/instruments/drum-kit.js's
// own PIECES names, lowercased to sit mid-sentence. An id not listed here
// (there is none in drum-kit.js today) falls back to the id itself rather
// than throwing.
const PIECE_WORDS = {
  kick: 'bass drum', snare: 'snare',
  'hihat-closed': 'hi-hat', 'hihat-open': 'hi-hat', 'hihat-pedal': 'hi-hat', hihat: 'hi-hat',
  'tom-floor': 'floor tom', 'tom-mid': 'mid tom', 'tom-high': 'high tom',
  crash: 'crash cymbal', ride: 'ride cymbal',
};
function pieceWord(piece) {
  return PIECE_WORDS[piece] || piece || 'drum';
}

// Group expected notes into chords: consecutive notes sharing the same
// `start` tick are one chord (a single note is a chord of size 1; a step of
// only single notes goes through judgeSingleNotes below).
function groupIntoChords(notes) {
  const groups = [];
  for (const note of notes) {
    const last = groups[groups.length - 1];
    if (last && last[0].start === note.start) last.push(note);
    else groups.push([note]);
  }
  return groups;
}

// onsetAt/clock: when a clock is present, a held note's expected duration is
// onsetAt(note.start + note.dur) - onsetAt(note.start) -- the clock's own
// tempo profile across the note's span, not the step's single bpm -- so a
// note that starts right after a tempoMap change is expected to last as
// long as the tempo THERE says, not the tempo the phrase began at. No
// clock: the original flat ticksToSec(note.dur, bpm, ticksPerQuarter).
function matchOneNote(note, hit, timed, expectedAt, bpm, ticksPerQuarter, onsetAt, clock) {
  const errorMs = timed ? (hit.atSec - expectedAt) * 1000 : null;
  let durRatio = null;
  if (hit.durSec != null && note.dur != null) {
    const expectedDurSec = clock ? (onsetAt(note.start + note.dur) - onsetAt(note.start)) : ticksToSec(note.dur, bpm, ticksPerQuarter);
    durRatio = expectedDurSec > 0 ? hit.durSec / expectedDurSec : null;
  }
  const cents = hit.cents != null ? hit.cents : null;
  const velocityError = hit.velocity != null && note.velocity != null ? hit.velocity - note.velocity : null;
  return { note, played: hit, ok: true, errorMs, durRatio, cents, velocityError };
}

function missedNote(note) {
  // pieceOk: null (not applicable, nothing was played -- pieceOk only ever
  // exists on a matched onset) so a percussion caller's pieceRate math
  // (judgeAttempt below) never sees a missed onset as evidence either way.
  return { note, played: null, ok: false, errorMs: null, durRatio: null, cents: null, velocityError: null, pieceOk: null };
}

// Onset-only matching for a "rhythm" step: every played event is assigned to
// the expected onset (chord) nearest it in time; each onset keeps its nearest
// assigned event, which then counts for every note of that chord (one clap
// covers a chord). Unclaimed events are extras. Order-free and pitch-free, so
// one stray clap never shifts every later beat, and a missed beat is a miss.
// percussion: true for a drum step (opts.percussion, judgeAttempt below) --
// the hit carries a `piece` (which drum), not a pitch, so this scores
// pieceOk (pieceOkFor above) instead of pitchOk.
function judgeOnsets(chords, played, onsetAt, matches, extraList, bpm, ticksPerQuarter, policy, clock, percussion) {
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
    const m = matchOneNote(note, hit, true, times[k], bpm, ticksPerQuarter, onsetAt, clock);
    if (percussion) { m.pieceOk = pieceOkFor(note, hit); }
    else { m.pitchOk = hit.midi != null && judgePitch({ heardMidi: hit.midi, targetMidi: note.midi, policy }).ok; }
    matches.push(m);
  }));
}

// Single expected note at this tick: the original forward-only search
// (no chord window) -- but anything skipped over on the way to the
// match is, by construction, a non-match under this note's pitch (the
// loop breaks on the FIRST match), so once the right note is found,
// every played event between cursor and it is a wrong note struck
// before the right one -- an extra, same as the chord path's unclaimed
// window events. A totally missed note (foundAt === -1) leaves cursor
// where it was, so nothing here is "unclaimed" yet -- a later step
// may still match these same events. A mic-heard event (src/ui/songs.js
// tags these `source: 'mic'`) is exempt -- a pitch tracker often emits
// a short wrong-pitch blip or an octave jump right at a note's attack,
// and mic pitch is already treated as approximate everywhere else, so a
// guitar or voice learner's correctly played note should not fail a
// maxExtras: 0 step on detection noise. Any exact input (MIDI, or an
// event with no source at all) still counts.
// Pushes this note's match (or miss) onto `matches`, its skipped events onto
// `extraList`, and returns the new cursor.
function greedySingle(note, played, cursor, timed, onsetAt, policy, bpm, ticksPerQuarter, clock, matches, extraList) {
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
    return cursor;
  }
  for (let i = cursor; i < foundAt; i++) { if (played[i].source !== 'mic') extraList.push(played[i]); }
  matches.push(matchOneNote(note, played[foundAt], timed, expectedAt, bpm, ticksPerQuarter, onsetAt, clock));
  return foundAt + 1;
}

// A step of single notes only (no chord, not an onset-only or drum step).
// The forward-only search above takes the FIRST pitch match, so a wrong note
// that happens to equal a later expected pitch (D D C D E E E for E D C D E E E:
// the first E found is the fifth event) eats every note before it and the
// learner is told they missed a D they played. So: run that search; when it
// already hits every note (checked first, so a clean try never pays for the
// table), or as many as any order-keeping match can, keep its result untouched. Otherwise redo the step on the longest in-order matching
// (suffix LCS, same judgePitch test): each note takes a played event that keeps
// that best total, so only the notes the learner truly did not play are missed.
// A timed step takes the event nearest the note's expected onset (so a D played
// on the beat is not matched to an earlier D and called early); an untimed
// step takes the earliest. Events skipped over are extras, with the mic exempt
// as in greedySingle.
function judgeSingleNotes(notes, played, timed, onsetAt, policy, bpm, ticksPerQuarter, clock, matches, extraList) {
  const greedyMatches = [];
  const greedyExtras = [];
  let cursor = 0;
  for (const note of notes) cursor = greedySingle(note, played, cursor, timed, onsetAt, policy, bpm, ticksPerQuarter, clock, greedyMatches, greedyExtras);
  const greedyHits = greedyMatches.filter((m) => m.ok).length;
  const n = notes.length;
  const p = played.length;
  if (greedyHits === n) { matches.push(...greedyMatches); extraList.push(...greedyExtras); return; }
  const same = notes.map((note) => played.map((ev) => judgePitch({ heardMidi: ev.midi, targetMidi: note.midi, policy }).ok));
  const L = Array.from({ length: n + 1 }, () => new Array(p + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = p - 1; j >= 0; j--) L[i][j] = same[i][j] ? 1 + L[i + 1][j + 1] : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  if (greedyHits === L[0][0]) {
    matches.push(...greedyMatches);
    extraList.push(...greedyExtras);
    return;
  }
  cursor = 0;
  for (let i = 0; i < n; i++) {
    const note = notes[i];
    const expectedAt = timed ? onsetAt(note.start) : null;
    let pick = -1;
    for (let j = cursor; j < p; j++) {
      if (!same[i][j] || 1 + L[i + 1][j + 1] !== L[i][cursor]) continue;
      if (pick === -1 || (timed && Math.abs(played[j].atSec - expectedAt) < Math.abs(played[pick].atSec - expectedAt))) pick = j;
      if (!timed) break;
    }
    if (pick === -1) {
      matches.push(missedNote(note));
      continue;
    }
    for (let j = cursor; j < pick; j++) { if (played[j].source !== 'mic') extraList.push(played[j]); }
    matches.push(matchOneNote(note, played[pick], timed, expectedAt, bpm, ticksPerQuarter, onsetAt, clock));
    cursor = pick + 1;
  }
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
// opts.clock: a song clock (src/song/clock.js's createSongClock(song)); when
// given, every expected onset and held-note duration is timed on the clock's
// tempo profile (see phraseSec/matchOneNote above), so a phrase crossing a
// tempoMap change is judged at the tempo in force at each tick, not at one
// flat opts.bpm for the whole phrase. Omitted: the original flat-tempo path.
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
    // percussion: a drum step (P4-11) -- there is no pitch to match in
    // order, only an onset and, maybe, which piece of the kit sounded it, so
    // this always takes the onset-matching path below (judgeOnsets), same as
    // onsetsOnly, and scores pieceOk instead of pitchOk on each match.
    percussion = false,
    clock,
  } = opts;
  const notes = expectedNotes || [];
  const played = playedEvents || [];
  const matches = [];
  const extraList = [];
  const onsetAt = (tick) => phraseSec(tick, originTick, bpm, ticksPerQuarter, clock);
  let cursor = 0;
  const onsetMatched = onsetsOnly || percussion;
  const allSingle = !onsetMatched && groupIntoChords(notes).every((g) => g.length === 1);
  if (onsetMatched) judgeOnsets(groupIntoChords(notes), played, onsetAt, matches, extraList, bpm, ticksPerQuarter, policy, clock, percussion);
  if (allSingle) judgeSingleNotes(notes, played, timed, onsetAt, policy, bpm, ticksPerQuarter, clock, matches, extraList);
  for (const chord of onsetMatched || allSingle ? [] : groupIntoChords(notes)) {
    if (chord.length === 1) {
      // Single expected note inside a step that also holds a chord: the
      // original forward-only search (greedySingle).
      cursor = greedySingle(chord[0], played, cursor, timed, onsetAt, policy, bpm, ticksPerQuarter, clock, matches, extraList);
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
      matches.push(matchOneNote(note, played[foundIdx], timed, expectedAt, bpm, ticksPerQuarter, onsetAt, clock));
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
  // meanAbsCents above -- passesRule() (src/core/pass-rule.js) judges the absolute value (a phrase
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
  // pieceRate: which-drum accuracy, over only the onsets that COULD be named
  // (pieceOk !== null -- see pieceOkFor above); a missed onset or one only
  // the mic heard and could not name never enters this count either way.
  // null (not 0) when nothing could be named at all, so a step can still
  // pass on timing alone -- passesRule (src/core/pass-rule.js) ignores minPieceRate whenever
  // pieceRate is null, exactly the mic's-limits case this exists for.
  const pieceJudged = matches.filter((m) => m.pieceOk != null);
  const pieceRate = percussion ? (pieceJudged.length ? pieceJudged.filter((m) => m.pieceOk).length / pieceJudged.length : null) : null;
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
    pieceRate,
    // Wrong notes struck alongside a chord, inside its spread window —
    // reported so the learner sees what they actually played, but never
    // counted against hitRate (see the chord-matching loop above).
    extras: { count: extraList.length, list: extraList },
  };
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
// (src/core/pass-rule.js) found wrong -- same order passesRule checks in -- instead of the
// generic "try that again" src/ui/songs.js used to always fall back to.
// Returns null when the try passed, or when there is no passRule to judge
// against (the "listen" step kind).
export function firstCorrection(result, passRule) {
  if (!passRule) return null;
  if (passesRule(result, passRule)) return null;
  const { dim } = failedDimension(result, passRule);
  if (dim === 'pitch') {
    const miss = (result.matches || []).find((m) => !m.ok);
    if (miss) {
      const midi = miss.note && miss.note.midi;
      // A rhythm step's ("Clap the rhythm") missed onset has no pitch of its
      // own worth naming -- it is a missed beat, not a missed note.
      if (midi == null) return 'Missed a beat — ' + result.hitCount + ' of ' + result.judgedCount + '.';
      return 'Missed the ' + noteName(midi) + ' — ' + result.hitCount + ' of ' + result.judgedCount + ' notes.';
    }
  }
  if (dim === 'onset') {
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
  if (dim === 'tune' || dim === 'hold') {
    const holdTune = holdTuneFeedback(result, passRule);
    if (holdTune) return holdTune;
  }
  if (dim === 'piece') {
    const miss = (result.matches || []).find((m) => m.pieceOk === false);
    if (miss) {
      const heard = miss.played && miss.played.piece;
      const wanted = miss.note && miss.note.piece;
      return 'That was the ' + pieceWord(heard) + ' — this beat wants the ' + pieceWord(wanted) + '.';
    }
  }
  if (dim === 'extras') {
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
