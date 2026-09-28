// The keyboard pathway's five step outcomes, as data -- the plain-language
// text a learner sees at each src/core/pathway.js step, kept separate from
// the pure state logic so a reviewer (or future translator) can look at
// just this file. Every outcome ships labelled "Not yet checked by a
// player" (teaching content is never claimed reviewed until it actually is
// -- see src/instruments/review-ledger.js's empty LEDGER and its
// "no fabricated review" guard).

import { isReviewCurrent } from './review.js';
import { itemReview, contentRev } from './review-ledger.js';
import { reviewItems as songReviewItems } from './kbd-songs.js';

const NOT_YET = 'Not yet checked by a player';

// P3's two extra outcomes, past 'return' -- kept OUT of OUTCOMES/reviewItems
// below (that array is the five-step panel list P2 already ships, proven by
// tests/unit/pathway.test.mjs's exact count of 5) since these two are shown
// only once a check row exists, never as one of the five ordered steps.
// Both carry the same "not a player review yet" label as every other
// outcome in this file.
export const TRANSFER_TEXT = { id: 'kbd.pathway.transfer', text: 'Play a different song, one you have not checked yet, in Check mode.', label: NOT_YET };
export const COMPLETE_TEXT = { id: 'kbd.pathway.complete', text: 'The first song is retained and a different song is checked too -- the keyboard pathway is complete.', label: NOT_YET };

// transferSongFor(level, excludeSongId): the next starter song the keyboard
// pathway can offer as a transfer check -- same "highest minLevel <= level"
// rule kbd-songs.js's songFor() uses for the ordinary song hand-off, just
// skipping excludeSongId (the song the learner's first independent check
// already passed on, so offering it back would prove nothing new). Reuses
// kbd-songs.js's own reviewItems() (not the raw ENTRIES) so a caller gets
// the same ledger-labelled `current` flag the ordinary hand-off carries --
// this suggestion is unreviewed exactly when that one is. Returns null when
// every unlocked song IS excludeSongId (nothing else to transfer to yet).
export function transferSongFor(level, excludeSongId) {
  let best = null;
  songReviewItems().forEach((entry) => {
    if (entry.songId === excludeSongId) return;
    if (entry.minLevel <= level && (!best || entry.minLevel > best.minLevel)) best = entry;
  });
  return best;
}

// One outcome per src/core/pathway.js step, in the same order pathwayState
// evaluates them. `id` is the stable content id this review ledger keys
// off; `value` is the reviewable content itself (contentRev(value) is what
// a future ledger entry's reviewedRev would have to match).
const OUTCOMES = [
  { id: 'kbd.pathway.setup', value: { step: 'setup', text: 'Connect a MIDI keyboard to start the pathway.', label: NOT_YET } },
  { id: 'kbd.pathway.lesson', value: { step: 'lesson', text: 'Work through the keyboard trainer first.', label: NOT_YET } },
  { id: 'kbd.pathway.song', value: { step: 'song', text: 'Open a song and play it in.', label: NOT_YET } },
  { id: 'kbd.pathway.check', value: { step: 'check', text: 'Play the whole piece on MIDI, unassisted, to check it.', label: NOT_YET } },
  { id: 'kbd.pathway.return', value: { step: 'return', text: 'Come back after a day to recheck it stuck.', label: NOT_YET } },
];

// reviewItems() -> [{ id, value }], same shape C11a's kbd-songs.js
// reviewItems() returns, so a future enumerator (E1a) can walk every
// instrument's review-eligible content the same way regardless of which
// slice it came from.
export function reviewItems() {
  return OUTCOMES.map((o) => ({ id: o.id, value: o.value }));
}

// outcomeReviewed(id): has a real player's review of THIS outcome's
// current content survived to today? False for every id while
// review-ledger.js's LEDGER is empty -- no player has reviewed anything
// through it yet, so every outcome stays labelled "Not yet checked by a
// player".
export function outcomeReviewed(id) {
  const outcome = OUTCOMES.find((o) => o.id === id);
  if (!outcome) return false;
  return isReviewCurrent(itemReview(id, contentRev(outcome.value)));
}
