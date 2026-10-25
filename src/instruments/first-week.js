// F19: the first-week path for every microphone instrument, as data -- the
// six steps src/core/pathway.js's pathwayState judges (setup, lesson, song,
// check, return, then a different song), built from the instrument's own
// record (its name; the route is always the microphone) so a new record
// gets a path without new code. The keyboard keeps its own five-step
// src/instruments/kbd-pathway.js on MIDI; firstWeekFor('kbd') is null.
//
// Every step is labelled PRACTICE_GRADE: the mic path is judged by the
// same pitch tracker as the trainer, and no player has checked these steps
// on any of these instruments yet (same honesty rule as kbd-pathway.js's
// "Not yet checked by a player" -- see src/instruments/review-ledger.js).
// An instrument no starter song fits, as written or transposed
// (src/song/feasibility.js), gets no path at all rather than a song step it
// could never pass.

import { byId } from './index.js';
import { starterSongs } from '../song/starter/index.js';
import { feasibility } from '../song/feasibility.js';

export const PRACTICE_GRADE = 'practice-grade (mic, not yet checked by a player)';

const FITS = ['as-written', 'transposed'];

// fittingSongs(rec) -> [{ songId, partId }] in starterSongs order: every
// starter whose first part this instrument can play without skipping a note.
function fittingSongs(rec) {
  return starterSongs
    .filter((s) => FITS.includes(feasibility(s, s.parts[0].id, rec).level))
    .map((s) => ({ songId: s.id, partId: s.parts[0].id }));
}

function micRecord(id) {
  const rec = byId[id];
  return rec && rec.input === 'mic' && rec.status === 'ready' ? rec : null;
}

// firstWeekSong(id, seenSongIds?) -> { songId, partId } | null: the first
// fitting starter not in seenSongIds -- the song step's suggestion with
// nothing seen, the transfer step's with the checked song (and anything
// else already played) excluded. Null when every fitting song is in
// seenSongIds; the panel then retries with only the checked song excluded.
export function firstWeekSong(id, seenSongIds) {
  const rec = micRecord(id);
  if (!rec) return null;
  const songs = fittingSongs(rec);
  const seen = new Set(Array.isArray(seenSongIds) ? seenSongIds : []);
  return songs.find((s) => !seen.has(s.songId)) || null;
}

// firstWeekFor(id) -> { id, name, input: 'mic', steps: [{ id, value: { step,
// text, label } }] } | null. Same { id, value } item shape as
// kbd-pathway.js's reviewItems(), so a ledger walker reads both alike.
export function firstWeekFor(id) {
  const rec = micRecord(id);
  if (!rec || !fittingSongs(rec).length) return null;
  const name = rec.name;
  const steps = [
    ['setup', 'Connect the microphone and let it hear your ' + name + '.'],
    ['lesson', 'Work through the first ' + name + ' trainer level.'],
    ['song', 'Open a song and play it in.'],
    ['check', 'Play the whole piece on the microphone, unassisted, to check it.'],
    ['return', 'Come back after a day to recheck it stuck.'],
    ['transfer', 'Play a different song, one you have not checked yet, in Check mode.'],
  ].map(([step, text]) => ({ id: id + '.firstWeek.' + step, value: { step, text, label: PRACTICE_GRADE } }));
  return { id, name, input: 'mic', steps };
}

// The results past the six steps, same wording and label rule as
// kbd-pathway.js's RETAINED_TEXT / TRANSFER_DONE_TEXT / COMPLETE_TEXT.
export const RETAINED = 'The first song is still solid a day later.';
export const TRANSFER_DONE = 'A different song is checked too.';
export const COMPLETE = 'The first song is still solid and a different song is checked too -- your first week is complete.';
