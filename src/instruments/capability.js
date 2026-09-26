// The capability and maturity matrix: one honest, learner-facing source of
// truth for what each instrument record actually offers -- derived
// mechanically from the record itself (schema.js), review.js's isReviewed(),
// and src/ui/fingerings/how.js's howKindFor(), never hand-typed per row. See
// docs/capabilities.md for the generated table and the promises this backs.
//
// A record's internal `status: 'ready'` means implementation availability --
// the code path exists and is wired up -- and must never be read as an
// educational-validation badge. That distinction is why this module exists:
// `tier` below is the only field that speaks to maturity, and it is computed,
// not asserted.
import { INSTRUMENTS } from './index.js';
import { isReviewed } from './review.js';
import { howKindFor } from '../ui/fingerings/how.js';

// howKindFor()'s return values that are a formula computed at play time --
// always correct for any note in range, nothing typed to get wrong.
const COMPUTED_CHART_KINDS = new Set(['fretboard', 'fingerboard', 'brass-valves', 'brass-slide', 'harmonica']);

// howKindFor()'s return values backed by a typed lookup table (or, for
// drum-kit, a drawn layout) that a musician has not necessarily checked.
// Whether it counts as checked rides on the SAME provenance signal that
// covers curriculum content (isReviewed) -- schema.js has no separate
// per-chart review field, so provenance is the only review evidence this
// module has to work with.
const TYPED_CHART_KINDS = new Set(['drum-kit', 'keyed-woodwind', 'recorder', 'whistle']);

export const TIERS = ['first-release-candidate', 'accessible-unvalidated', 'supported-untested', 'planned'];

function chartFor(rec) {
  const kind = howKindFor(rec);
  if (!kind || kind === 'voice') return 'none'; // voice/keyboard/wind-picker/mallets: no diagram at all
  if (COMPUTED_CHART_KINDS.has(kind)) return 'computed';
  if (TYPED_CHART_KINDS.has(kind)) return isReviewed(rec.provenance) ? 'typed-reviewed' : 'typed-unreviewed';
  return 'none';
}

function assessFor(rec) {
  if (rec.status !== 'ready') return 'none'; // nothing is assessable until the record ships
  if (rec.input === 'midi' || rec.input === 'mic+midi') return 'midi';
  if (rec.input === 'mic') return 'mic-single-note';
  if (rec.input === 'tap') return 'tap';
  return 'none';
}

// Mechanical, not per-id: `input === 'midi'` (exactly midi, nothing else) is
// a complete assessed pathway today -- keyboard is the only record that
// matches. `input === 'mic+midi'` (drum kit) also carries midi, but its mic
// path is onset-only (kick/snare/hi-hat, no real pitch) and no e-kit has
// actually been tried against this app yet, so it is held one notch below
// as `supported-untested` rather than claimed complete. Everything mic-only
// or tap-only is `accessible-unvalidated`: it can be practised today, but
// nothing about its chart or curriculum has been checked by a musician.
function tierFor(rec) {
  if (rec.status === 'planned') return 'planned';
  if (rec.input === 'midi') return 'first-release-candidate';
  if (rec.input === 'mic+midi') return 'supported-untested';
  return 'accessible-unvalidated';
}

// One instrument record -> its capability object. Pure: no DOM, no
// AudioContext, nothing but the record plus review.js/how.js.
export function capabilityFor(rec) {
  return {
    id: rec.id,
    name: rec.name,
    practise: rec.status === 'ready', // schema.js requires a non-empty curriculum whenever status is 'ready'
    assess: assessFor(rec),
    chart: chartFor(rec),
    contentReviewed: isReviewed(rec.provenance),
    tier: tierFor(rec)
  };
}

export function capabilityMatrix() {
  return INSTRUMENTS.map(capabilityFor);
}
