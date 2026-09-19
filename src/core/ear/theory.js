// Shared music-theory facts for the ear-training generators. Kept tiny and
// derived where possible so a fact lives in exactly one place.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

export function pcName(pc) {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

// A short phrase that moves by scale degree within `scale` (a set of
// ascending semitone offsets from the tonic, one octave, e.g. MAJOR_STEPS).
// Always starts on the tonic. Shared by melodic-dictation (played/typed
// back) and sing-back (sung back) so the "move by degree, wrap octaves"
// logic lives once. Takes a plain rng() -> [0,1) function, not an rng.js
// helper, so this file has no dependency on that module's internals.
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
