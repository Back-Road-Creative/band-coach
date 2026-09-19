// Brass "how to produce this note" — computed from first principles, not a
// typed fingering table. Zero dependencies; pure functions; no DOM.
//
// Wiring pass: call `fingeringsForValves(midi, preset)` for a 3/4-valve
// instrument (trumpet, cornet, horn-in-F basics, euphonium, tuba) or
// `fingeringsForSlide(midi, preset)` for trombone. Both return
// `{ standard, alternates, needsCheck }` where `standard` and each item of
// `alternates` is `{ label, partial, semitoneDrop }` — `label` is a valve
// combo like '1-2' / 'open', or a slide position number 1-7. `needsCheck` is
// true when the match relies on an outer harmonic partial (7 or 8) whose
// real-world pitch drifts from equal temperament, so the UI should hedge.
// `PRESETS` gives the written-pitch fundamentals this app already assumes
// (see the per-instrument comments below); a caller with its own fundamental
// can skip the presets and call the functions directly.
//
// --- Physics ---
// An open brass tube (or trombone slide at a fixed length) sounds the
// harmonic series above a fundamental: partial n has frequency n * f0, which
// is 12*log2(n) semitones above the fundamental. Rounding that to the
// nearest semitone (equal temperament) gives the *written* pitch of each
// partial relative to partial 1:
//   partial:   1   2   3   4   5   6   7   8
//   semitones: 0  12  19  24  28  31  34  36
// Partial 7 (34, nominally a written A#/Bb) is well known to sound flat of
// that equal-tempered value in real playing — the harmonic itself is about a
// third of a semitone flat — so any fingering built on partial 7 (or the
// rarely used partial 8) is flagged `needsCheck`.
//
// A valve engaged alone lengthens the tube by a fixed amount, which in
// semitones (independent of the instrument's key, because it's a ratio of
// tube length) is a known constant: 2nd valve drops a semitone, 1st valve a
// whole tone, 3rd valve a minor third, and — on 4-valve instruments — the
// 4th valve drops a perfect fourth. Valves used together are assumed to add
// their drops (VALVE_DROPS below); that additive assumption is itself the
// source of the "combo instruments sharp" fact below, not a separate rule.
//
// Combining valve 1 (a whole tone of extra tubing, calibrated for use alone)
// with valve 3 (a minor third of extra tubing, also calibrated for use
// alone) does not add quite enough length for the combined drop to land in
// tune — the classic "1-3 and 1-2-3 run sharp" fact taught on every valved
// brass instrument. The same undersizing affects the 3rd valve alone,
// which is why method books teach 1-2 rather than 3 alone for a written
// minor third drop even though 3 alone uses one fewer valve. That is
// captured by SHARP_COMBOS below, not the semitone arithmetic.

export function harmonicPitch(fundamentalMidi, partial) {
  if (!(partial >= 1)) throw new Error('partial must be >= 1');
  return fundamentalMidi + Math.round(12 * Math.log2(partial));
}

// Fixed physical constants of a piston-valve brass instrument (semitones of
// extra tubing length each valve adds, alone).
const VALVE_DROPS = { 2: 1, 1: 2, 3: 3, 4: 5 };

// Valve combos known to run sharp when played (physical fact about how the
// tubing lengths compound, not a per-note table): the 3rd valve alone, and
// any combo that uses both the 1st and 3rd valves together.
function isSharpCombo(valves) {
  const has = v => valves.includes(v);
  if (valves.length === 1 && has(3)) return true;
  if (has(1) && has(3)) return true;
  return false;
}

function comboLabel(valves) {
  return valves.length === 0 ? 'open' : valves.slice().sort().join('-');
}

// Every combo of the available valves, with its total semitone drop.
function allValveCombos(hasFourthValve) {
  const valveSet = hasFourthValve ? [1, 2, 3, 4] : [1, 2, 3];
  const combos = [];
  const n = valveSet.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const valves = valveSet.filter((_, i) => mask & (1 << i));
    const drop = valves.reduce((sum, v) => sum + VALVE_DROPS[v], 0);
    combos.push({ valves, label: comboLabel(valves), drop, sharp: isSharpCombo(valves) });
  }
  return combos;
}

const MAX_PARTIAL = 8;

// All fingerings for a written `midi` pitch on a valved brass instrument.
// `preset` = { fundamental, hasFourthValve }. `fundamental` is the written
// pitch of the instrument's own partial 1 (see PRESETS for this app's
// conventions). Ranked standard-first: not-sharp before sharp, then fewer
// valves, then lower partial.
export function fingeringsForValves(midi, preset) {
  const { fundamental, hasFourthValve = false } = preset;
  const combos = allValveCombos(hasFourthValve);
  const found = [];
  for (const combo of combos) {
    for (let partial = 2; partial <= MAX_PARTIAL; partial++) {
      if (harmonicPitch(fundamental, partial) - combo.drop === midi) {
        found.push({
          label: combo.label,
          partial,
          semitoneDrop: combo.drop,
          sharp: combo.sharp,
          needsCheck: partial >= 7
        });
      }
    }
  }
  found.sort((a, b) =>
    (a.sharp === b.sharp ? 0 : a.sharp ? 1 : -1) ||
    a.label.split('-').length - b.label.split('-').length ||
    a.partial - b.partial
  );
  return {
    standard: found[0] || null,
    alternates: found.slice(1),
    needsCheck: found.length === 0 || found.some(f => f.needsCheck)
  };
}

// Trombone-style slide: position 1 (shortest) through 7 (longest), each
// position beyond the first adding one semitone of extra tube length
// (drop = position - 1). Same harmonic-series math as the valved case.
export function fingeringsForSlide(midi, preset, maxPosition = 7) {
  const { fundamental } = preset;
  const found = [];
  for (let position = 1; position <= maxPosition; position++) {
    const drop = position - 1;
    for (let partial = 2; partial <= MAX_PARTIAL; partial++) {
      if (harmonicPitch(fundamental, partial) - drop === midi) {
        found.push({ label: String(position), position, partial, semitoneDrop: drop, needsCheck: partial >= 7 });
      }
    }
  }
  found.sort((a, b) => a.position - b.position || a.partial - b.partial);
  return {
    standard: found[0] || null,
    alternates: found.slice(1),
    needsCheck: found.length === 0 || found.some(f => f.needsCheck)
  };
}

// Written-pitch fundamentals this app already assumes. Transposing brass
// (trumpet, cornet, horn in F) is written so its open partials always spell
// the same C-based series regardless of the instrument's sounding key —
// that is the entire reason one fingering chart serves every transposing
// brass instrument — so they share fundamental 48 (C3, silent pedal note;
// partial 2 is the first practical note, written C4 = 60, matching
// trumpet-bb.js's and horn-f.js's own written-pitch range comments).
// Non-transposing bass-clef brass (euphonium, tuba — trombone.js's "bc"
// group, app.js:110) reads concert pitch, whose open partial 2 is written
// Bb2 (46), so its fundamental is Bb1 (34) — matching trombone.js's own
// hand-checked open (1st position) partials, Bb2 and F3.
export const PRESETS = {
  'trumpet-cornet': { fundamental: 48, hasFourthValve: false },
  'horn-f-basics': { fundamental: 48, hasFourthValve: false },
  euphonium: { fundamental: 34, hasFourthValve: false },
  'euphonium-4-valve': { fundamental: 34, hasFourthValve: true },
  tuba: { fundamental: 34, hasFourthValve: false },
  'tuba-4-valve': { fundamental: 34, hasFourthValve: true },
  trombone: { fundamental: 34 }
};
