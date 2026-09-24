// Pure decision for what a finished task element earns, kept separate from
// app.js's credit()/passEl() so the three outcomes (helped, approximate,
// normal) have one tested home instead of being threaded through DOM state.
//
// - helped: the learner asked "Show me". Help is not a test: no SRS review
//   at all (stability/lapses/due untouched), and no level progress either
//   way.
// - assistance === 'approximate': a microphone-only hands-together pass,
//   graded for real (the SRS review still happens, same as today) but it
//   does not count toward level progress since only one hand was actually
//   heard.
// - otherwise: a normal graded answer — review happens and counts toward
//   level progress.

export function gradeOutcome({ helped = false, failed = false, assistance = null, q = 0 } = {}) {
  if (helped) return { review: false, level: false, q: 0 };
  if (assistance === 'approximate') return { review: true, level: false, q: q };
  return { review: true, level: true, q: q };
}
