// Hands-together song practice (band-coach plan, Wave — see README.md
// "Piano hands together"): pure helpers that decide whether a song part
// offers a choice of hand at all, and pick one hand's notes out of a
// practice step. Pure: no DOM, no clock, no AudioContext.
//
// Public API:
//   handsAvailable(song, partId, arrangement) -> ['rh'] | ['rh','lh'] | []
//     [] when the arrangement isn't a keyboard ('keys' family) arrangement
//     -- the concept of "which hand" only applies there. Otherwise looks at
//     the part's own notes (never the arrangement's placements alone): a
//     hand counts as available only when at least one of the part's notes
//     is explicitly tagged note.hand === that hand AND that note actually
//     made it into the arrangement (placements.get(its index) exists --
//     an out-of-range tagged note doesn't count). This is deliberate: the
//     middle-C pitch split (src/song/arrange/keys.js splitHands) sends some
//     of a plain one-part melody below middle C to the left hand, and if
//     "two hands" were inferred from placements alone every such melody
//     would wrongly get a hand selector. An untagged melody is always
//     ['rh'] here, even though some of its notes are placed lh.
//   stepForHands(step, arrangement, hands) -> { judged, played, assessed }
//     `hands` is the app's existing three-way choice ('both'|'right'|'left',
//     see DB.prefs.kbdHands / handsModeFromId in src/core/hands-together.js).
//     Off the keys family, or for 'both', every note in the step is judged
//     and none is merely played back. For 'right'/'left', splits step.notes
//     by each note's own `hand` (untagged counts as 'rh', matching
//     handsAvailable) into the selected hand (judged) and the other hand
//     (played, the accompaniment the app plays back but doesn't grade).
//     `assessed` is false when the selected hand has no notes in this step
//     at all (nothing to judge). Deliberately does NOT consult
//     `arrangement.placements`: a step's notes cannot be mapped back to a
//     placement index without the whole fitted part (see
//     src/ui/songs/step-view.js placementFor), and doing so would bring
//     back the pitch-split bug on melody-only tunes. Both output arrays are
//     built with Array.prototype.filter alone, never map/spread, so every
//     returned note is the SAME object as its element of step.notes --
//     step-view.js's placementFor matches by identity.

function partNotes(song, partId) {
  const part = song.parts.find(p => p.id === partId);
  if (!part) throw new Error('hand-filter: no part "' + partId + '" in song "' + song.id + '"');
  return part.notes;
}

export function handsAvailable(song, partId, arrangement) {
  if (!arrangement || arrangement.family !== 'keys') return [];
  const notes = partNotes(song, partId);
  let hasRh = false;
  let hasLh = false;
  notes.forEach((note, i) => {
    if (!arrangement.placements.has(i)) return;
    if (note.hand === 'rh') hasRh = true;
    else if (note.hand === 'lh') hasLh = true;
  });
  return hasRh && hasLh ? ['rh', 'lh'] : ['rh'];
}

const HAND_BY_MODE = { right: 'rh', left: 'lh' };

export function stepForHands(step, arrangement, hands) {
  const selected = HAND_BY_MODE[hands];
  if (!arrangement || arrangement.family !== 'keys' || !selected) {
    return { judged: step.notes, played: [], assessed: true };
  }
  const other = selected === 'rh' ? 'lh' : 'rh';
  const noteHand = (note) => (note.hand === 'lh' ? 'lh' : 'rh');
  const judged = step.notes.filter(n => noteHand(n) === selected);
  const played = step.notes.filter(n => noteHand(n) === other);
  return { judged, played, assessed: judged.length > 0 };
}
