// What each capture path (a MIDI message, a microphone pitch-detector frame,
// a computer key, a plain rhythm tap) can ever prove about a learner's try.
// Pure: no DOM, no AudioContext, no clock.

// Which learning-event dims (src/ui/songs/assessed.js's dims: pitch, onset,
// hold, tune, drum -- same names here, plus 'chord', for a dimension no
// current record's `assess` can prove yet) each capability.js `assess`
// value can actually prove. 'midi' never proves 'tune': a MIDI note number
// is always in tune (assessed.js: "keyboards are always in tune"). 'mic-single-note' is a monophonic pitch
// detector: it can hear one note's pitch/onset/hold/tune, but never which
// simultaneous notes make a chord, and never tell one drum from another.
// 'tap' has no pitch detection at all -- it proves rhythm only. 'none'
// proves nothing. This is the ONLY place that decides what a capability can
// prove; a future judge/assessed rewrite reads it from here instead of
// re-deriving it.
const DIM_CAPABILITY = {
  none: [],
  tap: ['onset'],
  'mic-single-note': ['pitch', 'onset', 'hold', 'tune'],
  midi: ['pitch', 'chord', 'onset', 'hold', 'drum'],
};

// provableDims(assess) -> the DIM_CAPABILITY row for that capability.js
// `assess` value, or [] for an unrecognized one -- the one place outside
// this module that needs "what can this capability ever prove" before any
// events are judged (src/ui/songs/assessed.js's
// dimsFromStep: a step's passRule can only grade what the capability can
// prove, before any single try's events come into it).
export function provableDims(assess) {
  return (DIM_CAPABILITY[assess] || []).slice();
}
