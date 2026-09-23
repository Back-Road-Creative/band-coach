// Shared Song shape (src/song/model.js) -> ABC notation 2.1 text.
//
// Wiring: call `exportAbc(song)` with a normalized Song (see model.js).
// Returns one ABC tune as a string: X:/T:/M:/L:/Q:/K: header, one `V:`
// voice per part (omitted for a single-part song, since that is the
// idiomatic single-voice ABC form and the sibling `import-abc.js` has no
// multi-voice support -- see the note below). Pure: no DOM, no I/O.
//
// Round-trip note: `import-abc.js`'s header comment claims multi-voice `V:`
// tunes are "read as one voice with a warning", but its header loop has no
// `V:` case at all, so a `V:` line appearing after `K:` falls into the tune
// body and gets character-tokenized -- and lowercase a-g in a voice name
// (e.g. "melody") are themselves note letters. So a multi-part export here
// is structurally correct ABC but does NOT round-trip through importAbc;
// only a single-part Song does. Every starter song has exactly one part.

const TICKS_PER_QUARTER = 480;

const NATURAL_LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_BLACK_PC = { 1: 'C', 3: 'D', 6: 'F', 8: 'G', 10: 'A' };
const FLAT_BLACK_PC = { 1: 'D', 3: 'E', 6: 'G', 8: 'A', 10: 'B' };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
// Inverse of import-abc.js's MAJOR_FIFTHS, restricted to the range the
// tonic/mode -> fifths formula below ever produces (-5..6).
const FIFTHS_TO_NAME = { 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', '-1': 'F', '-2': 'Bb', '-3': 'Eb', '-4': 'Ab', '-5': 'Db' };
const ACC_TOKEN = { '-2': '__', '-1': '_', 0: '=', 1: '^', 2: '^^' };

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

// Key-signature accidentals for a major-equivalent key of `fifths`
// sharps(+)/flats(-); mirrors import-abc.js's keySignatureAccidentals so the
// two stay in lockstep for round-tripping.
function keySignatureAccidentals(fifths) {
  const acc = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) for (let i = 0; i < fifths; i += 1) acc[SHARP_ORDER[i]] = 1;
  else if (fifths < 0) { const flat = [...SHARP_ORDER].reverse(); for (let i = 0; i < -fifths; i += 1) acc[flat[i]] = -1; }
  return acc;
}

// Derives the ABC K: field text and the accidental table it implies from a
// Song key. import-abc.js decodes `K:<letter><acc> <mode>` as: look up the
// letter/accidental as if it named a MAJOR key to get a "tonic-entry"
// fifths TF, shift by the mode (-3 for minor), then re-derive the tonic pc
// from that. Solving that relation backwards for TF given (tonic, mode)
// collapses to TF = 7*tonic (mod 12) for BOTH major and minor (the mode's
// +9/-3 offsets cancel mod 12) -- so one formula covers both.
function keyInfo(key) {
  const tonic = key && Number.isInteger(key.tonic) ? ((key.tonic % 12) + 12) % 12 : 0;
  const mode = key && key.mode === 'minor' ? 'minor' : 'major';
  const tf0 = (7 * tonic) % 12;
  const tf = tf0 <= 6 ? tf0 : tf0 - 12;
  const name = FIFTHS_TO_NAME[String(tf)];
  const letter = name[0];
  const accidentalChar = name.length > 1 ? name.slice(1) : '';
  const modeShift = mode === 'minor' ? -3 : 0;
  const sigFifths = tf + modeShift;
  return {
    fieldText: `${letter}${accidentalChar} ${mode}`,
    keySigAcc: keySignatureAccidentals(sigFifths),
    preferFlats: sigFifths < 0,
  };
}

// midi -> { letter, acc, octave } using natural letters where the pitch
// class allows one, else the sharp/flat spelling matching the key.
function spellPitch(midi, preferFlats) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const naturalLetter = Object.keys(NATURAL_LETTER_PC).find((l) => NATURAL_LETTER_PC[l] === pc);
  if (naturalLetter) return { letter: naturalLetter, acc: 0, octave };
  const table = preferFlats ? FLAT_BLACK_PC : SHARP_BLACK_PC;
  return { letter: table[pc], acc: preferFlats ? -1 : 1, octave };
}

function letterToken(spelled) {
  if (spelled.octave >= 5) return spelled.letter.toLowerCase() + "'".repeat(spelled.octave - 5);
  return spelled.letter + ','.repeat(Math.max(0, 4 - spelled.octave));
}

// Groups a part's (sorted-by-start) notes into events: a lone note stays a
// single-note event, notes sharing a `start` become one chord event (the
// [..] bracket case) whose advancing duration is the loudest/longest voice
// in it.
function groupChordEvents(notes) {
  const groups = [];
  for (const note of notes) {
    const last = groups[groups.length - 1];
    if (last && last[0].start === note.start) last.push(note);
    else groups.push([note]);
  }
  return groups.map((group) => ({ start: group[0].start, dur: Math.max(...group.map((n) => n.dur)), notes: group }));
}

// True when `note` ties into a later note of the same pitch starting the
// instant it ends (the shape import-abc.js's tieFromPrev requires).
function tiesForward(note, notes) {
  return notes.some((n) => n.tieFromPrev === true && n.midi === note.midi && n.start === note.start + note.dur);
}

// Phase A: walk one part's notes against the song's shared bar boundaries,
// producing an abstract event list (note/chord/rest, each with a tick
// duration) split at every barline. No ABC text yet -- that needs the unit
// length L, which itself needs to see every duration first.
function buildBarEvents(part, barBoundaries) {
  const bars = [];
  let events = [];
  let barIdx = 0;
  let cursor = 0;
  const closeBar = () => { bars.push(events); events = []; barIdx += 1; };
  const restTo = (target) => {
    while (cursor < target) {
      const barEnd = barBoundaries[barIdx + 1];
      const chunkEnd = Math.min(target, barEnd);
      if (chunkEnd > cursor) events.push({ type: 'rest', dur: chunkEnd - cursor });
      cursor = chunkEnd;
      if (cursor >= barEnd && barIdx + 1 < barBoundaries.length - 1) closeBar();
      else if (cursor >= barEnd) cursor = barEnd; // last bar: stop growing past it
    }
  };
  const chordEvents = groupChordEvents(part.notes);
  for (const chord of chordEvents) {
    if (chord.start > cursor) restTo(chord.start);
    events.push({ type: 'chord', dur: chord.dur, notes: chord.notes.map((n) => ({ midi: n.midi, dur: n.dur, tie: tiesForward(n, part.notes) })) });
    cursor = chord.start + chord.dur;
    while (barIdx + 1 < barBoundaries.length && cursor >= barBoundaries[barIdx + 1]) closeBar();
  }
  const finalTick = barBoundaries[barBoundaries.length - 1];
  if (cursor < finalTick) restTo(finalTick);
  if (events.length) closeBar();
  return bars;
}

function collectDurations(bars, out) {
  for (const bar of bars) for (const ev of bar) {
    if (ev.type === 'chord') for (const n of ev.notes) out.push(n.dur);
    else out.push(ev.dur);
  }
}

function renderNoteToken(midi, dur, tie, keySigAcc, preferFlats, barAcc, unitTicks) {
  const spelled = spellPitch(midi, preferFlats);
  const accKey = spelled.letter + spelled.octave;
  const activeAcc = accKey in barAcc ? barAcc[accKey] : (keySigAcc[spelled.letter] || 0);
  let accText = '';
  if (spelled.acc !== activeAcc) { accText = ACC_TOKEN[String(spelled.acc)]; barAcc[accKey] = spelled.acc; }
  const multiplier = dur / unitTicks;
  const lenText = multiplier === 1 ? '' : String(multiplier);
  return accText + letterToken(spelled) + lenText + (tie ? '-' : '');
}

function renderBar(bar, keySigAcc, preferFlats, unitTicks) {
  const barAcc = {};
  const tokens = bar.map((ev) => {
    if (ev.type === 'rest') { const m = ev.dur / unitTicks; return 'z' + (m === 1 ? '' : String(m)); }
    if (ev.notes.length === 1) return renderNoteToken(ev.notes[0].midi, ev.notes[0].dur, ev.notes[0].tie, keySigAcc, preferFlats, barAcc, unitTicks);
    const inner = ev.notes.map((n) => renderNoteToken(n.midi, n.dur, n.tie, keySigAcc, preferFlats, barAcc, unitTicks)).join('');
    return `[${inner}]`;
  });
  return tokens.join(' ');
}

export function exportAbc(song) {
  const ticksPerQuarter = song.ticksPerQuarter || TICKS_PER_QUARTER;
  const { fieldText, keySigAcc, preferFlats } = keyInfo(song.key);

  const duration = song.parts.reduce((max, p) => p.notes.reduce((m, n) => Math.max(m, n.start + n.dur), max), 0);
  const barTicks = song.metre.num * (4 / song.metre.den) * ticksPerQuarter;
  const barCount = duration > 0 ? Math.ceil(duration / barTicks) : 1;
  const barBoundaries = Array.from({ length: barCount + 1 }, (_, i) => i * barTicks);

  const partBars = song.parts.map((part) => buildBarEvents(part, barBoundaries));

  const durations = [];
  for (const bars of partBars) collectDurations(bars, durations);
  const gcdTicks = durations.length ? durations.reduce((g, d) => gcd(g, d), durations[0]) : ticksPerQuarter / 2;
  let unitNum = gcdTicks;
  let unitDen = 4 * ticksPerQuarter;
  const g = gcd(unitNum, unitDen);
  unitNum /= g;
  unitDen /= g;

  const lines = [];
  lines.push('X:1');
  lines.push(`T:${song.title}`);
  if (song.composer) lines.push(`C:${song.composer}`);
  lines.push(`M:${song.metre.num}/${song.metre.den}`);
  lines.push(`L:${unitNum}/${unitDen}`);
  lines.push(`Q:${Math.round(song.bpm)}`);
  lines.push(`K:${fieldText}`);

  song.parts.forEach((part, i) => {
    // name="..." lets import-abc.js give the part its name back; ABC has no
    // escape for a quote inside it, and the voice id is one token.
    if (song.parts.length > 1) {
      const id = String(part.id).replace(/\s+/g, '-');
      lines.push(part.name ? `V:${id} name="${String(part.name).replace(/"/g, "'")}"` : `V:${id}`);
    }
    const barTexts = partBars[i].map((bar) => renderBar(bar, keySigAcc, preferFlats, gcdTicks));
    lines.push(barTexts.join(' | ') + ' |');
  });

  return lines.join('\n') + '\n';
}
