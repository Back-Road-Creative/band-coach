// mir_eval-style note-transcription scorer: matches a reference note list
// against an estimated note list by onset time (within a tolerance) and
// exact MIDI pitch, one-to-one, so a transcription pipeline (src/song/
// transcribe.js) can be graded against ground truth (e.g. the starter
// songs in src/song/starter/index.js, see roundtrip.js).
//
// OFFSET-INSENSITIVE, on purpose: only onset time and pitch are compared,
// never a note's end/duration. A pitch tracker's inferred note *offset*
// (when a note ends) is the least reliable part of a transcription --
// release timing, glide into the next note, and the `minNoteMs`/glitch
// folding in transcribe.js all blur it -- so scoring it would mostly
// measure that noise rather than transcription quality. This mirrors
// mir_eval.transcription's onset-only mode.
//
// Input note shape: { onset: seconds, midi: number }. Matching is by exact
// MIDI number (no fuzz) and by onset distance within `onsetToleranceSec`
// (default 0.05 s / 50 ms).

export function scoreNotes(ref, est, opts = {}) {
  const { onsetToleranceSec = 0.05 } = opts;
  const r = Array.isArray(ref) ? ref : [];
  const e = Array.isArray(est) ? est : [];

  // Both empty is a vacuous perfect score (nothing to find, nothing
  // spurious) rather than an undefined 0/0 division -- keeps every field
  // a finite number, never NaN.
  if (!r.length && !e.length) {
    return { precision: 1, recall: 1, f1: 1, matched: 0, ref: 0, est: 0 };
  }
  if (!r.length || !e.length) {
    return { precision: 0, recall: 0, f1: 0, matched: 0, ref: r.length, est: e.length };
  }

  // Every same-pitch pairing within the onset tolerance is a candidate;
  // sorting by onset distance ascending and greedily claiming the closest
  // pairs first is what stops one estimated note double-matching two
  // reference notes (or vice versa) -- each index can be used at most once.
  const candidates = [];
  for (let i = 0; i < r.length; i++) {
    for (let j = 0; j < e.length; j++) {
      if (r[i].midi !== e[j].midi) continue;
      const dist = Math.abs(r[i].onset - e[j].onset);
      if (dist <= onsetToleranceSec) candidates.push({ i, j, dist });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);

  const usedRef = new Set();
  const usedEst = new Set();
  let matched = 0;
  for (const c of candidates) {
    if (usedRef.has(c.i) || usedEst.has(c.j)) continue;
    usedRef.add(c.i);
    usedEst.add(c.j);
    matched++;
  }

  const precision = matched / e.length;
  const recall = matched / r.length;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, matched, ref: r.length, est: e.length };
}
