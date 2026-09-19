// Pure pitch-judging logic: whether a heard MIDI note matches a target MIDI
// note, under an explicit octave policy. No DOM, no globals, no state.
//
// Three policies:
//   'exact'          - the octave must match too (midi === midi).
//   'fold'           - pitch class only, any octave (an instrument item
//                       explicitly marked "anywhere", or ear-training style
//                       judging where octave was never the point).
//   'nearest-octave' - pitch class only, because the player's own voice or
//                       range picks the octave (singers).
//
// 'fold' and 'nearest-octave' compute the same thing today; they are kept as
// distinct names because they answer different questions for the caller
// ("this item ignores octave by design" vs "this instrument has no fixed
// octave to check against").

const pc = (m) => ((Math.round(m) % 12) + 12) % 12;

// instrument id -> its default octave policy. Read from band-coach.html's
// MODS table (src/app.js:67-140, orig L229-267 area covers the ids this maps).
export const OCTAVE_POLICY = {
  kbd: 'exact',
  gtr: 'exact',
  bass: 'exact',
  uke: 'exact',
  wind: 'exact',
  harp: 'exact',
  voice: 'nearest-octave',
};

export function judgePitch({ heardMidi, targetMidi, policy }) {
  if (policy === 'exact') {
    const ok = Math.round(heardMidi) === Math.round(targetMidi);
    if (ok) return { ok: true, reason: 'exact-match' };
    return {
      ok: false,
      reason: pc(heardMidi) === pc(targetMidi) ? 'right-pitch-class-wrong-octave' : 'wrong-pitch-class',
    };
  }
  const ok = pc(heardMidi) === pc(targetMidi);
  return { ok, reason: ok ? 'pitch-class-match' : 'wrong-pitch-class' };
}
