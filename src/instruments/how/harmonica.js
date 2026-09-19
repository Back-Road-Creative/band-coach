// Harmonica "how to produce this note" — the 10-hole Richter layout is
// computed by transposing a single fixed pattern, and bend availability is
// computed from the blow/draw pitch gap in each hole. Zero dependencies;
// pure functions; no DOM.
//
// Wiring pass: call `holesFor(midi, key)` (key = 0-11, 0 = C, matching
// schema.js's tonic convention) to get every way to sound a written pitch:
// `{ hole, action: 'blow'|'draw', semitonesBent, difficulty }`. `layoutFor(key)`
// returns the full 10-hole blow/draw table plus each hole's bend notes, for
// drawing a harmonica diagram.
//
// --- The Richter pattern (key of C, established from src/instruments/harp.js) ---
// harp.js documents range 60-96 (C4-C7) for a C harmonica; that is exactly
// hole 1 blow (C4) to hole 10 blow (C7), which fixes the octave of every
// note below. The pattern (semitones above hole-1 blow, i.e. above the
// harp's tonic) is the standard Richter major-scale layout:
// Exported so other modules (src/song/lesson.js's fitToInstrument) can build
// a harmonica's fixed pitch set from this single source instead of keeping
// their own copy of the Richter pattern.
export const BLOW_STEPS = [0, 4, 7, 12, 16, 19, 24, 28, 31, 36]; // C E G C E G C E G C
export const DRAW_STEPS = [2, 7, 11, 14, 17, 21, 23, 26, 29, 33]; // D G B D F A B D F A

// `layoutFor(key)` — key is a semitone offset 0-11 from C (0 = C, matching
// schema.js's `key.tonic`). Transposing the whole pattern by that many
// semitones gives the layout for any of the 12 keys of harmonica.
export function layoutFor(key = 0) {
  if (!Number.isInteger(key) || key < 0 || key > 11) throw new Error('key must be 0-11');
  const tonic = 60 + key; // hole 1 blow, in the harp's own key
  const holes = [];
  for (let i = 0; i < 10; i++) {
    const hole = i + 1;
    const blow = tonic + BLOW_STEPS[i];
    const draw = tonic + DRAW_STEPS[i];
    holes.push({ hole, blow, draw, bends: bendsForHole(blow, draw) });
  }
  return holes;
}

// A reed can be bent down towards the OTHER reed in the same hole, but never
// past it — the bend floor is one semitone above the lower of the two
// reeds. Every semitone between (higher reed - 1) and (lower reed + 1)
// inclusive is an available bent note. This single rule, applied per hole,
// reproduces every well-known bending fact about a Richter harmonica: holes
// 1-6 bend the draw note down (draw is the higher reed there), holes 7-10
// bend the blow note down (blow is the higher reed up there), and holes 5
// and 7 — where blow and draw are only a semitone apart — have no usable
// bend at all (gap - 1 = 0).
function bendsForHole(blow, draw) {
  const higher = Math.max(blow, draw);
  const lower = Math.min(blow, draw);
  const bendsOnDraw = draw > blow;
  const bends = [];
  for (let pitch = higher - 1; pitch >= lower + 1; pitch--) {
    const semitonesBent = higher - pitch;
    bends.push({ pitch, semitonesBent, difficulty: difficultyFor(semitonesBent), action: bendsOnDraw ? 'draw' : 'blow' });
  }
  return bends;
}

function difficultyFor(semitonesBent) {
  if (semitonesBent <= 0) return 'open';
  if (semitonesBent === 1) return 'easy-bend';
  if (semitonesBent === 2) return 'moderate-bend';
  return 'hard-bend';
}

// Every way to sound written `midi` on a harmonica in the given `key`
// (default C). Includes plain blow/draw notes and reachable bends, ranked
// easiest first.
export function holesFor(midi, key = 0) {
  const layout = layoutFor(key);
  const options = [];
  for (const h of layout) {
    if (h.blow === midi) options.push({ hole: h.hole, action: 'blow', semitonesBent: 0, difficulty: 'open' });
    if (h.draw === midi) options.push({ hole: h.hole, action: 'draw', semitonesBent: 0, difficulty: 'open' });
    for (const b of h.bends) {
      if (b.pitch === midi) options.push({ hole: h.hole, action: b.action, semitonesBent: b.semitonesBent, difficulty: b.difficulty });
    }
  }
  const rank = { open: 0, 'easy-bend': 1, 'moderate-bend': 2, 'hard-bend': 3 };
  options.sort((a, b) => rank[a.difficulty] - rank[b.difficulty] || a.hole - b.hole);
  return options;
}
