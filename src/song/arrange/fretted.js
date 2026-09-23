// String-and-fret arrangement for fretted instruments (guitar, bass, uke,
// mandolin, banjo — any instrument record with a `tuning` array, see
// src/instruments/schema.js). Pure: no DOM, no AudioContext, caller owns
// the clock. Reuses src/instruments/how/fretboard.js's positionsFor so this
// module and the "how to play it" fingering panel never disagree about
// which frets a pitch is reachable on.
//
// Wiring-pass API:
//   arrangeFretted(notes, instrument, { capo, maxFret }) -> { placed,
//     unplayable, cost }
//     notes: a flat array of { start, dur, midi } (a Song part's notes,
//     already run through src/song/lesson.js's fitToInstrument so pitches
//     are in the instrument's playable range/octave first). Notes sharing
//     the same `start` tick are treated as a chord and must land on
//     distinct strings within a 4-fret hand span. Every input note ends up
//     in exactly one of `placed` (with a chosen string/fret) or
//     `unplayable` (with a plain-English reason) — never silently dropped.
//     `placed[i].index` / `unplayable[i].index` is the note's position in
//     the input array, so a caller can zip the result back onto `notes`.
//   bestCapo(notes, instrument, { maxFret }) -> capo (0-7)
//     Tries every capo position and returns the one with the fewest
//     unplayable notes, tie-broken by lowest total arrangement cost, then
//     by the lowest capo number.
import { positionsFor } from '../../instruments/how/fretboard.js';

const STRETCH_SPAN = 4; // max fret span (frets 0 excluded) a hand can cover at once
const MAX_CANDIDATES_PER_NOTE = 8; // bounds the combo search for dense chords
const MOVE_WEIGHT = 1; // cost per fret of average hand movement between groups
const CROSSING_WEIGHT = 1; // cost per string newly brought into play
const STRETCH_WEIGHT = 0.5; // soft preference for a chord shape with less stretch
const FRET_WEIGHT = 0.1; // soft preference for lower frets (open strings first)

function groupByStart(notes) {
  const byStart = new Map();
  notes.forEach((note, index) => {
    const list = byStart.get(note.start) || [];
    list.push({ note, index });
    byStart.set(note.start, list);
  });
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, entries]) => ({ start, entries }));
}

function fretsOf(positions) {
  return positions.map(p => p.fret);
}

function stretchOf(positions) {
  const fretted = fretsOf(positions).filter(f => f > 0);
  if (fretted.length < 2) return 0;
  return Math.max(...fretted) - Math.min(...fretted);
}

function fretSpanOk(positions) {
  return stretchOf(positions) <= STRETCH_SPAN;
}

function avgFret(positions) {
  const fretted = fretsOf(positions).filter(f => f > 0);
  if (!fretted.length) return 0;
  return fretted.reduce((a, b) => a + b, 0) / fretted.length;
}

function intrinsicCost(positions) {
  const frets = fretsOf(positions);
  const fretSum = frets.reduce((a, b) => a + b, 0);
  return fretSum * FRET_WEIGHT + stretchOf(positions) * STRETCH_WEIGHT;
}

function transitionCost(prevPositions, curPositions) {
  if (!prevPositions) return 0;
  const prevStrings = new Set(prevPositions.map(p => p.stringIndex));
  const curStrings = new Set(curPositions.map(p => p.stringIndex));
  let crossing = 0;
  curStrings.forEach(s => { if (!prevStrings.has(s)) crossing++; });
  const movement = Math.abs(avgFret(curPositions) - avgFret(prevPositions));
  return movement * MOVE_WEIGHT + crossing * CROSSING_WEIGHT;
}

// Every way to give each entry in `perNoteCandidates` its own string,
// respecting the hand-span constraint. Bounded by MAX_CANDIDATES_PER_NOTE
// per note, so this stays small even for a dense chord.
function combosFor(perNoteCandidates) {
  const results = [];
  const chosen = [];
  const used = new Set();
  function backtrack(i) {
    if (i === perNoteCandidates.length) {
      if (fretSpanOk(chosen)) results.push(chosen.slice());
      return;
    }
    for (const cand of perNoteCandidates[i]) {
      if (used.has(cand.stringIndex)) continue;
      chosen.push(cand);
      used.add(cand.stringIndex);
      backtrack(i + 1);
      used.delete(cand.stringIndex);
      chosen.pop();
    }
  }
  backtrack(0);
  return results;
}

// Fallback for a chord that has no fully-simultaneous solution: greedily
// place the notes with the fewest candidates first, skipping (and
// reporting as unplayable) any note that cannot find a free string once
// its neighbours are placed. Guarantees every entry is either placed or
// explained, never dropped.
function greedyPlace(entries, candidatesByEntry) {
  const order = entries
    .map((e, i) => i)
    .sort((a, b) => candidatesByEntry[a].length - candidatesByEntry[b].length);
  const placedPositions = [];
  const placedIdx = new Set();
  const used = new Set();
  for (const i of order) {
    const choice = candidatesByEntry[i].find(cand => {
      if (used.has(cand.stringIndex)) return false;
      const trial = [...placedPositions, cand];
      return fretSpanOk(trial);
    });
    if (choice) {
      placedPositions.push(choice);
      placedIdx.add(i);
      used.add(choice.stringIndex);
    }
  }
  return { placedIdx, positions: placedPositions };
}

// arrangeFretted -------------------------------------------------------

export function arrangeFretted(notes, instrument, opts = {}) {
  const capo = Number.isInteger(opts.capo) ? opts.capo : 0;
  const maxFret = Number.isInteger(opts.maxFret) ? opts.maxFret : 12;
  const tuning = instrument && Array.isArray(instrument.tuning) ? instrument.tuning : null;
  if (!tuning) throw new Error('arrangeFretted requires an instrument record with a tuning array');

  const groups = groupByStart(notes);
  const placed = [];
  const unplayable = [];
  let prevPositions = null;
  let totalCost = 0;

  for (const group of groups) {
    const { entries } = group;
    const candidatesByEntry = entries.map(({ note }) =>
      positionsFor(note.midi, tuning, { capo, maxFret }).slice(0, MAX_CANDIDATES_PER_NOTE)
    );

    // Notes with no reachable fret at all (out of the instrument's range,
    // or the capo pushes every open string past them) never enter the
    // combo search -- they are unplayable regardless of their neighbours.
    const reachable = [];
    entries.forEach((entry, i) => {
      if (candidatesByEntry[i].length === 0) {
        unplayable.push({ index: entry.index, start: entry.note.start, dur: entry.note.dur, midi: entry.note.midi, reason: 'out-of-range' });
      } else {
        reachable.push(i);
      }
    });

    if (reachable.length === 0) continue;

    const reachableCandidates = reachable.map(i => candidatesByEntry[i]);
    let combos = combosFor(reachableCandidates);
    let usedIdx = reachable;
    let bestPositions = null;

    if (combos.length > 0) {
      let best = null;
      for (const combo of combos) {
        const cost = intrinsicCost(combo) + transitionCost(prevPositions, combo);
        if (!best || cost < best.cost) best = { cost, combo };
      }
      bestPositions = best.combo;
      totalCost += best.cost;
    } else {
      // No assignment seats every reachable note simultaneously (e.g. a
      // dense chord that outruns the instrument's strings) -- place as
      // many as a greedy fit can, report the rest as unplayable rather
      // than dropping them or failing the whole group.
      const { placedIdx, positions } = greedyPlace(
        reachable.map(i => entries[i]),
        reachable.map(i => candidatesByEntry[i])
      );
      usedIdx = reachable.filter((_, k) => placedIdx.has(k));
      bestPositions = positions;
      totalCost += intrinsicCost(positions) + transitionCost(prevPositions, positions);
      reachable.forEach((i, k) => {
        if (!placedIdx.has(k)) {
          const entry = entries[i];
          unplayable.push({ index: entry.index, start: entry.note.start, dur: entry.note.dur, midi: entry.note.midi, reason: 'no-simultaneous-position' });
        }
      });
    }

    usedIdx.forEach((i, k) => {
      const entry = entries[i];
      const pos = bestPositions[k];
      placed.push({ index: entry.index, start: entry.note.start, dur: entry.note.dur, midi: entry.note.midi, string: pos.stringIndex, fret: pos.fret });
    });

    if (bestPositions.length) prevPositions = bestPositions;
  }

  placed.sort((a, b) => a.index - b.index);
  unplayable.sort((a, b) => a.index - b.index);
  return { placed, unplayable, cost: totalCost };
}

// bestCapo ---------------------------------------------------------------

export function bestCapo(notes, instrument, opts = {}) {
  const maxFret = Number.isInteger(opts.maxFret) ? opts.maxFret : 12;
  let best = null;
  for (let capo = 0; capo <= 7; capo++) {
    const result = arrangeFretted(notes, instrument, { capo, maxFret });
    const score = { unplayable: result.unplayable.length, cost: result.cost };
    if (
      !best ||
      score.unplayable < best.score.unplayable ||
      (score.unplayable === best.score.unplayable && score.cost < best.score.cost)
    ) {
      best = { capo, score };
    }
  }
  return best.capo;
}
