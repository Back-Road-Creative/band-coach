// Rhythm reading from real songs: instead of a randomly generated rhythm,
// picks a real bar (two bars at higher levels) of a starter song's own
// melody rhythm -- durations and rests exactly as written, pitch dropped.
// Same question/answer shape as rhythm-dictation's make (onset times in
// ticks, from t=0), so rhythm-dictation's existing check() and the tap
// answer widget/UI work unchanged; this module reuses that check() rather
// than grading anything itself. Unlike song-dictation (which hides the
// song until reveal, because that is an ear-training exercise), this is a
// sight-reading exercise: the song title is part of the prompt up front.

import { makeRng, pickFrom, intRange } from './rng.js';
import { check as rhythmCheck } from './rhythm-dictation.js';
import { METRES, validateBar } from '../rhythm.js';
import { barsOf, notesInBar } from '../../song/model.js';
import { starterSongs } from '../../song/starter/index.js';

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = ['1 bar', '1 bar', '2 bars', '2 bars', '2 bars'];

const BARS_FOR_LEVEL = [1, 1, 2, 2, 2];
const MAX_ATTEMPTS = 12; // deterministic retries if a picked span doesn't validate in its own metre

// Re-export unchanged: rhythm-dictation's grader works as-is on our answer
// shape (onset ticks from 0), so this module does not write its own.
export const check = rhythmCheck;

function metreKeyOf(song) {
  return `${song.metre.num}/${song.metre.den}`;
}

// One bar's worth of { dur, rest } events, gap-filled with rests so the
// events always sum to exactly one bar -- the song's notation only records
// sounding notes, not the rests between them.
function eventsForBar(song, boundaries, barIndex) {
  const barStart = boundaries[barIndex];
  const barEnd = boundaries[barIndex + 1];
  const notes = notesInBar(song, barIndex)
    .map(({ note }) => note)
    .sort((a, b) => a.start - b.start);
  const events = [];
  let cursor = barStart;
  for (const note of notes) {
    if (note.start > cursor) events.push({ dur: note.start - cursor, rest: true });
    if (note.tieFromPrev && events.length && !events[events.length - 1].rest) {
      // A tie continues the previous onset rather than starting a new one.
      events[events.length - 1].dur += note.dur;
    } else {
      events.push({ dur: note.dur, rest: false });
    }
    cursor = note.start + note.dur;
  }
  if (cursor < barEnd) events.push({ dur: barEnd - cursor, rest: true });
  return events;
}

// One span's events, plus whether every individual bar in it validates
// against its own metre (each bar must independently sum to exactly one
// bar, not merely the span as a whole).
function eventsForSpan(song, boundaries, startBar, barCount, metreKey) {
  const events = [];
  let allBarsValid = true;
  for (let b = startBar; b < startBar + barCount; b++) {
    const barEvents = eventsForBar(song, boundaries, b);
    if (!validateBar(barEvents, metreKey)) allBarsValid = false;
    events.push(...barEvents);
  }
  return { events, allBarsValid };
}

export function make(level, seed, { songs = starterSongs } = {}) {
  const rng = makeRng(level, seed);
  const idx = Math.min(Math.max(level - 1, 0), BARS_FOR_LEVEL.length - 1);
  const wantBars = BARS_FOR_LEVEL[idx];

  let song;
  let span;
  let events = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    song = pickFrom(rng, songs);
    const metreKey = metreKeyOf(song);
    if (!METRES[metreKey]) continue; // an unsupported metre can't be validated or read back
    const boundaries = barsOf(song);
    const barCount = boundaries.length - 1;
    span = Math.min(wantBars, barCount);
    const startBar = intRange(rng, 0, barCount - span + 1);
    const { events: candidate, allBarsValid } = eventsForSpan(song, boundaries, startBar, span, metreKey);
    const hasOnset = candidate.some((ev) => !ev.rest);
    if (allBarsValid && hasOnset) {
      events = candidate;
      break;
    }
  }

  let t = 0;
  const onsets = [];
  const play = [];
  events.forEach((ev) => {
    if (!ev.rest) {
      onsets.push(t);
      play.push({ t: t / 480, dur: ev.dur / 480, midi: [69] }); // fixed click pitch (A4), same as rhythm-dictation
    }
    t += ev.dur;
  });

  return {
    id: `song-rhythm:${level}:${seed}`,
    prompt: `Tap back the rhythm from "${song.title}" (${span} bar${span > 1 ? 's' : ''}).`,
    play,
    choices: [],
    answer: onsets,
    explain: `Onsets in ticks (480/quarter): ${onsets.join(', ')}. From "${song.title}".`,
  };
}
