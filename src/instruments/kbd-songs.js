// Keyboard trainer -> song hand-off suggestions. Pure -- no DOM, no
// AudioContext, no t() calls (translated text lives in src/app.js's
// renderOpts, which owns rendering); this file only owns which starter
// song to suggest and whether that suggestion counts as reviewed.
//
import { starterSongs, isTwoHand } from '../song/starter/index.js';
import { nameFor } from '../core/note-names.js';
import { itemReview, contentRev } from './review-ledger.js';
import { isReviewCurrent } from './review.js';

// The keyboard trainer's own new pitches per level, as plain MIDI numbers:
// index i holds level (i+1)'s pitches, an empty array for a task-only level
// (Moves: two notes / three notes, which teach no new pitch) that still has
// to occupy its slot so later indices line up. This is the only copy:
// src/app.js's MODS.kbd levels build their `add` lists from it (N(...)), so
// the trainer and the song hand-off below can never disagree about which
// notes a level teaches. Levels past the last entry teach runs, chords and
// hands together, never a new single pitch.
export const KBD_LEVEL_PITCH_POOLS = [
  [60, 62, 64],                     // level 1: C, D and E
  [65, 67],                         // level 2: Add F and G
  [69, 71, 72],                     // level 3: Add A, B and high C
  [66, 70],                         // level 4: black keys F#/Bb
  [61, 63, 68],                     // level 5: black keys C#/Eb/Ab
  [],                               // level 6: Moves, two notes (no new pitch)
  [],                               // level 7: Moves, three notes (no new pitch)
  [48, 50, 52, 53, 55, 57, 59],     // level 8: the octave below
];

// The MIDI pitches already taught once `throughLevel` whole levels are
// behind the player (levels 1..throughLevel, so throughLevel === 0 means
// nothing has been taught yet) -- same cumulative shape as app.js's own
// activeItems(mod, L).
function taughtPitches(throughLevel) {
  const set = new Set();
  for (let i = 0; i < Math.min(throughLevel, KBD_LEVEL_PITCH_POOLS.length); i++) KBD_LEVEL_PITCH_POOLS[i].forEach((p) => set.add(p));
  return set;
}

// The smallest level at which a song using exactly `pitches` is worth
// suggesting. Deliberately one level PAST the level that first teaches the
// last of those pitches (i.e. the smallest L with pitches subset of
// taughtPitches(L - 1)): at the moment those notes unlock the player is
// still learning them, not yet ready to be handed a whole song built out of
// them. Never uses a starter song's own `level` field (song difficulty,
// unrelated to which keyboard notes it happens to use -- e.g. "Mary Had a
// Little Lamb" is starter level 1 but reaches G4, one level past the very
// first keyboard notes). Returns null when the pitches are never fully
// taught by any keyboard level (e.g. a song reaching outside the taught
// octaves), meaning no hand-off should ever be offered for it.
function minLevelFor(pitches) {
  for (let level = 1; level <= KBD_LEVEL_PITCH_POOLS.length + 1; level++) {
    const pool = taughtPitches(level - 1);
    if (pitches.every((p) => pool.has(p))) return level;
  }
  return null;
}

function pitchesOf(song) {
  const set = new Set();
  song.parts.forEach((part) => part.notes.forEach((n) => set.add(n.midi)));
  return Array.from(set).sort((a, b) => a - b);
}

// One entry per starter song whose every pitch is fully covered by a
// keyboard level (minLevelFor above): a song reaching outside anything the
// keyboard trainer teaches (e.g. Minuet in G's upper octave) never becomes a
// hand-off suggestion. `id` is the ledger key (kept distinct from `songId`
// so a later slice could review two different suggestions of the SAME song,
// e.g. on two instruments, without them sharing one review); `skills` is
// the plain-language list of notes this song hands off, for display or a
// future review note.
// The level the keyboard trainer's own hands-together curriculum starts at
// (app.js MODS.kbd level 13, "Hands together", mirrored at kbd.js:28): a
// two-hand starter's minLevel is never allowed below this, even when every
// individual pitch it uses was taught earlier -- playing both hands at once
// is its own skill, not implied by knowing the notes.
export const KBD_HANDS_TOGETHER_LEVEL = 13;

export const ENTRIES = starterSongs
  .map((song) => {
    const pitches = pitchesOf(song);
    const rawMinLevel = minLevelFor(pitches);
    const minLevel = rawMinLevel === null ? null : Math.max(rawMinLevel, isTwoHand(song) ? KBD_HANDS_TOGETHER_LEVEL : rawMinLevel);
    return { id: 'kbd.songHandoff.' + song.id, songId: song.id, minLevel, skills: pitches.map((p) => nameFor(p, { octave: true })) };
  })
  .filter((entry) => entry.minLevel !== null);

// The most advanced hand-off entry the player has already reached (the
// entry with the highest minLevel that is still <= level), or null before
// any entry qualifies. Ties (two songs unlocked at the same level) keep
// whichever comes first in ENTRIES/starterSongs order, so the suggestion
// never flips between two equally-valid songs from one render to the next.
export function songFor(level) {
  let best = null;
  for (const entry of ENTRIES) if (entry.minLevel <= level && (!best || entry.minLevel > best.minLevel)) best = entry;
  return best;
}

// songId -> the drill skill ids (src/app.js's N(), 'n' + midi, built from
// KBD_LEVEL_PITCH_POOLS above) a fully-taught starter song uses -- so a song
// play can be credited as "applied" for a note the player has already
// drilled on its own, even though a drill event's skill ('n64') and a song
// event's skill ('phrase-slow:0'/'pitches:0'/etc, see src/ui/songs.js) never
// share an instrument|skill group in src/core/learning-events.js's own
// applied rule. Only songs ENTRIES already fully teaches (minLevel !== null)
// are mapped -- a song reaching outside the keyboard trainer's own levels has
// no drill ids to point at. Built from ENTRIES' own ids/pitches, never from a
// second pass over starterSongs, so it can never disagree with ENTRIES about
// which songs qualify.
export const KBD_SONG_SKILL_MAP = Object.freeze(Object.fromEntries(
  ENTRIES.map((entry) => [entry.songId, Object.freeze(pitchesOf(starterSongs.find((s) => s.id === entry.songId)).map((p) => 'n' + p))])
));

// Every hand-off entry alongside whether a real player has reviewed it
// through the shared per-item ledger (src/instruments/review-ledger.js) --
// this map is teaching content the app's authors assembled, not something a
// musician has checked, so every entry ships unreviewed until a real
// reviewedBy/reviewedAt/reference lands in LEDGER.
export function reviewItems() {
  return ENTRIES.map((entry) => ({ ...entry, current: isReviewCurrent(itemReview(entry.id, contentRev(entry))) }));
}
