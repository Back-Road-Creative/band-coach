// Song-fed melodic dictation: instead of a randomly generated phrase, picks
// a real 1-3 bar phrase out of a starter song's melody. Same question/answer
// shape as melodic-dictation (an ordered MIDI note list), so the existing
// note-entry answer widget and checker work unchanged. Which song the
// phrase came from is revealed only in `explain` -- never in `prompt` --
// so the learner has to answer by ear, not by song title.

import { makeRng, intRange } from './rng.js';
import { checkSequence } from './theory.js';
import { barsOf, notesInBar, ticksToSeconds } from '../../song/model.js';
import { starterSongs } from '../../song/starter/index.js';

export const LEVEL_COUNT = 5;
export const LEVEL_NAMES = ['1 bar', '1 bar', '2 bars', '2 bars', '3 bars'];

const BARS_FOR_LEVEL = [1, 1, 2, 2, 3];
const MAX_ATTEMPTS = 12; // deterministic retries if a picked span is too sparse (e.g. all rests/one long note)

// Every note (from the song's first/melody part) that starts within bars
// [startBar, startBar + barCount), in time order.
function phraseNotes(song, startBar, barCount) {
  const notes = [];
  for (let b = startBar; b < startBar + barCount; b++) {
    notesInBar(song, b).forEach(({ note }) => notes.push(note));
  }
  return notes.sort((a, b) => a.start - b.start);
}

export function make(level, seed, { songs = starterSongs } = {}) {
  const rng = makeRng(level, seed);
  const idx = Math.min(Math.max(level - 1, 0), BARS_FOR_LEVEL.length - 1);
  const wantBars = BARS_FOR_LEVEL[idx];

  let song;
  let notes = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    song = songs[intRange(rng, 0, songs.length)];
    const boundaries = barsOf(song);
    const barCount = boundaries.length - 1;
    const span = Math.min(wantBars, barCount);
    const startBar = intRange(rng, 0, barCount - span + 1);
    notes = phraseNotes(song, startBar, span);
    if (notes.length >= 2) break;
  }

  const phraseStart = notes.length ? notes[0].start : 0;
  const midi = notes.map((n) => n.midi);
  const play = notes.map((n) => ({
    t: ticksToSeconds(n.start - phraseStart, song.bpm),
    dur: ticksToSeconds(n.dur, song.bpm),
    midi: [n.midi],
  }));

  return {
    id: `song-dictation:${level}:${seed}`,
    prompt: `Play back the ${midi.length}-note phrase you hear.`,
    play,
    choices: [],
    answer: midi,
    explain: `From "${song.title}". Notes: ${midi.join(', ')}.`,
  };
}

export function check(question, response, { foldOctave = false } = {}) {
  const got = Array.isArray(response) ? response : [];
  const norm = (m) => (foldOctave ? ((m % 12) + 12) % 12 : m);
  return checkSequence(question.answer, got, (a, b) => norm(a) === norm(b));
}
