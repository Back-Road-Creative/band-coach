// Compact text notation for the beginner songs in src/song/starter/index.js.
//
// A tune is written as a single string, bars separated by '|':
//
//   "E4:q D4:q C4:h | E4:q D4:q C4:h"
//
// Grammar:
//   bars       := '^'? bar ('|' bar)*
//   bar        := token (whitespace token)*
//   token      := note | rest
//   note       := PITCH ACCIDENTAL? OCTAVE ':' DURATION dots? '~'?
//   rest       := ('R'|'r') ':' DURATION dots?
//   PITCH      := A-G (letter names only; case-insensitive)
//   ACCIDENTAL := '#' | 'b' (optional)
//   OCTAVE     := digits, MIDI-style (C4 = middle C = midi 60)
//   DURATION   := w | h | q | e | s   (whole, half, quarter, eighth, sixteenth)
//   dots       := one or more '.' right after DURATION; each dot adds half
//                 of the remaining value (standard dotted-note augmentation:
//                 one dot = 1.5x, two dots = 1.75x, ...)
//   '~' directly after a note ties it INTO the next note: the next note gets
//   `tieFromPrev: true`. The two notes must share a pitch or parse() throws.
//
// A leading '^' before the first bar marks that bar a pickup (anacrusis): a
// deliberately short bar that, together with the tune's LAST bar, is
// expected to sum to exactly one bar of the given metre. Every other bar
// (including the sole bar of a pickup-free tune) must sum to exactly one
// bar.
//
// API for a later wiring pass:
//   parse(text, meta) -> Song            (shared song/1 shape; see
//     .data/handoff/band-coach-author-brief.md "Shared Song shape")
//   barTicks(text) -> { pickup, bars }   bar lengths in ticks, before the
//     notes are flattened -- used to check the metre invariant without
//     re-deriving bar boundaries from a flat note list.
//   metreTicks(metre) -> number          ticks in one bar of {num, den}.
//
// `meta` fields consumed by parse(): id, title, composer, licence, source,
// key, metre ({num, den}), bpm, level, and optionally partId/partName
// (default 'melody' / 'Melody').

const TICKS_PER_QUARTER = 480;

const PITCH_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DURATION_QUARTERS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };

const NOTE_RE = /^([A-Ga-g])([#b]?)(\d+):([whqesWHQES])(\.*)(~)?$/;
const REST_RE = /^[Rr]:([whqesWHQES])(\.*)$/;

function durationTicks(code, dots) {
  const base = DURATION_QUARTERS[code.toLowerCase()] * TICKS_PER_QUARTER;
  let total = base;
  let add = base / 2;
  for (let i = 0; i < dots.length; i++) {
    total += add;
    add /= 2;
  }
  return total;
}

function pitchToMidi(letter, accidental, octave) {
  let semitone = PITCH_SEMITONE[letter.toUpperCase()];
  if (accidental === '#') semitone += 1;
  else if (accidental === 'b') semitone -= 1;
  return (Number(octave) + 1) * 12 + semitone;
}

function splitBars(text) {
  let body = text.trim();
  let pickup = false;
  if (body.startsWith('^')) {
    pickup = true;
    body = body.slice(1).trim();
  }
  const bars = body
    .split('|')
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  return { pickup, bars };
}

function tokensOf(bar) {
  return bar.split(/\s+/).filter(Boolean);
}

export function metreTicks(metre) {
  const beatTicks = (4 / metre.den) * TICKS_PER_QUARTER;
  return metre.num * beatTicks;
}

export function barTicks(text) {
  const { pickup, bars } = splitBars(text);
  const ticks = bars.map((bar) => {
    let sum = 0;
    for (const tok of tokensOf(bar)) {
      const note = NOTE_RE.exec(tok);
      if (note) {
        sum += durationTicks(note[4], note[5]);
        continue;
      }
      const rest = REST_RE.exec(tok);
      if (rest) {
        sum += durationTicks(rest[1], rest[2]);
        continue;
      }
      throw new Error(`starter/notation: unrecognised token "${tok}"`);
    }
    return sum;
  });
  return { pickup, bars: ticks };
}

export function parse(text, meta) {
  const label = meta.id ?? meta.title ?? 'unknown tune';
  const { pickup, bars: barStrings } = splitBars(text);
  const metre = metreTicks(meta.metre);
  const { bars: barSums } = barTicks(text);

  barSums.forEach((sum, i) => {
    const isFirst = i === 0;
    const isLast = i === barSums.length - 1;
    if (pickup && isFirst && !isLast) return; // paired with the last bar below
    if (pickup && isLast && barSums.length > 1) {
      const combined = barSums[0] + sum;
      if (combined !== metre) {
        throw new Error(
          `starter/notation: "${label}" pickup (${barSums[0]}) + last bar (${sum}) = ${combined}, expected ${metre} ticks`
        );
      }
      return;
    }
    if (sum !== metre) {
      throw new Error(`starter/notation: "${label}" bar ${i + 1} sums to ${sum}, expected ${metre} ticks`);
    }
  });

  const notes = [];
  let cursor = 0;
  let pendingTie = false;
  let lastMidi = null;

  for (const bar of barStrings) {
    for (const tok of tokensOf(bar)) {
      const noteMatch = NOTE_RE.exec(tok);
      if (noteMatch) {
        const [, letter, accidental, octave, durCode, dots, tie] = noteMatch;
        const dur = durationTicks(durCode, dots);
        const midi = pitchToMidi(letter, accidental, octave);
        const entry = { start: cursor, dur, midi };
        if (pendingTie) {
          if (midi !== lastMidi) {
            throw new Error(`starter/notation: "${label}" ties into a different pitch (${lastMidi} -> ${midi})`);
          }
          entry.tieFromPrev = true;
        }
        notes.push(entry);
        cursor += dur;
        pendingTie = Boolean(tie);
        lastMidi = midi;
        continue;
      }
      const restMatch = REST_RE.exec(tok);
      if (restMatch) {
        cursor += durationTicks(restMatch[1], restMatch[2]);
        pendingTie = false;
        continue;
      }
      throw new Error(`starter/notation: "${label}" unrecognised token "${tok}"`);
    }
  }

  return {
    schema: 'song/1',
    id: meta.id,
    title: meta.title,
    composer: meta.composer ?? null,
    licence: meta.licence ?? null,
    source: meta.source ?? null,
    key: meta.key ?? null,
    metre: meta.metre,
    bpm: meta.bpm,
    ticksPerQuarter: TICKS_PER_QUARTER,
    level: meta.level,
    parts: [
      {
        id: meta.partId ?? 'melody',
        name: meta.partName ?? 'Melody',
        notes,
      },
    ],
    chords: [],
  };
}
