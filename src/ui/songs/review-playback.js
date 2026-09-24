// Pure helpers behind Review's "Play original" / "Play notes" buttons and
// its unsure-notes list (P3-7). No DOM, no AudioContext: the caller (review.
// js) owns the clock and the audio graph, same division of labour as src/
// core/groove.js and src/audio/take-recorder.js -- this only turns a song's
// notes into plain-words descriptions and into a schedule of numbers.
import { ticksToSeconds } from '../../song/model.js';

// Same "low confidence" rule review.js:104 already draws its confidence-strip
// colours from (n.confidence < 0.4) -- kept here as a default so the words
// list and the coloured strip always agree on which notes are unsure,
// without either importing the other.
const DEFAULT_CONFIDENCE_THRESHOLD = 0.4;

function notesOf(song) {
  const part = song && song.parts && song.parts[0];
  return part ? part.notes || [] : [];
}

// uncertainNotesText(song, confidenceThreshold): one plain-words line per
// note whose measured confidence is below the threshold, in note order,
// naming the note's 1-based position and about when it lands (rounded to a
// tenth of a second -- "about", because a learner does not need millisecond
// precision to find the spot). A song with no unsure notes (or no notes at
// all) returns an empty array; the caller (review.js) is the one that turns
// that into the one-line "nothing to check" message, so this module stays a
// single "which notes, in what words" concern.
export function uncertainNotesText(song, confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD) {
  const notes = notesOf(song);
  const bpm = song && song.bpm;
  const out = [];
  notes.forEach((n, i) => {
    if (typeof n.confidence !== 'number' || !(n.confidence < confidenceThreshold)) return;
    const seconds = Math.round(ticksToSeconds(n.start, bpm) * 10) / 10;
    out.push('Note ' + (i + 1) + ' (about ' + seconds + ' s in) — not sure');
  });
  return out;
}

// playbackPlanFor(song): every note of the song's first part as a
// { midi, at, dur } schedule in seconds from t0 = 0 -- the exact numbers
// src/ui/editor.js's playSong (:625-640) computes, just handed back instead
// of fed straight to api.tone(), so review.js can add its own start-time
// offset (api.now() + 0.1, matching editor.js) and schedule through the
// same api.tone() call.
export function playbackPlanFor(song) {
  const notes = notesOf(song);
  const bpm = song && song.bpm;
  return notes.map((n) => ({
    midi: n.midi,
    at: ticksToSeconds(n.start, bpm),
    dur: Math.max(0.05, ticksToSeconds(n.dur, bpm)),
  }));
}
