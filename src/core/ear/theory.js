// Shared music-theory facts for the ear-training generators. Kept tiny and
// derived where possible so a fact lives in exactly one place.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

export function pcName(pc) {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

// Shared "ordered-list" grading: reports the ok/wrong shape every sequence
// exercise here uses (degrees, progressions, melodic/rhythm dictation,
// played-back scales). `sameFn` compares one expected/actual pair.
export function checkSequence(want, got, sameFn) {
  const wrong = [];
  want.forEach((w, i) => {
    if (got[i] === undefined || !sameFn(w, got[i])) wrong.push({ index: i, expected: w, got: got[i] ?? null });
  });
  return { ok: wrong.length === 0 && got.length === want.length, detail: { wrong } };
}

// A short phrase moving by scale degree within `scale` (ascending semitone
// offsets from the tonic, one octave), always starting on the tonic. Shared
// by melodic-dictation and sing-back. Takes a plain rng() -> [0,1) function.
export function diatonicPhrase(rng, { count, maxStep, scale = MAJOR_STEPS, rootMidi }) {
  const pickStep = () => -maxStep + Math.floor(rng() * (2 * maxStep + 1)); // inclusive [-maxStep, maxStep]
  let degreeIdx = 0;
  const degrees = [degreeIdx];
  for (let i = 1; i < count; i++) {
    let step;
    do {
      step = pickStep();
    } while (step === 0);
    degreeIdx += step;
    degrees.push(degreeIdx);
  }
  return degrees.map((d) => {
    const octave = Math.floor(d / scale.length);
    const within = ((d % scale.length) + scale.length) % scale.length;
    return rootMidi + octave * 12 + scale[within];
  });
}
