// Tablature layout: choose a playable fret/string for each note.

const PX_PER_BEAT = 40;
const START_X = 10;

// Score a candidate fret: with no previous fret, lower is simply better.
// With a previous fret, prefer staying close to it, tie-broken toward the
// lower fret so hand position drifts toward open strings over time.
function score(fret, prevFret) {
  if (prevFret === null) return fret;
  return Math.abs(fret - prevFret) * 10 + fret;
}

export function layoutTab({ tuning, notes, maxFret = 12 }) {
  const primitives = [];
  let prevFret = null;
  let onset = 0;

  for (const note of notes) {
    const dur = note.dur;
    const x = START_X + onset * PX_PER_BEAT;
    onset += dur;

    if (note.midi === null) continue;

    let best = null;
    for (let string = 0; string < tuning.length; string++) {
      const fret = note.midi - tuning[string];
      if (fret < 0 || fret > maxFret) continue;
      const s = score(fret, prevFret);
      if (best === null || s < best.s) best = { s, string, fret };
    }
    if (best === null) continue; // unplayable on this tuning within maxFret

    prevFret = best.fret;
    primitives.push({ type: 'fretNumber', string: best.string, fret: best.fret, x });
  }

  return { primitives };
}
