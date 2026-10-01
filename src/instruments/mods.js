// MODS: the trainer table (each instrument is a curriculum plus a way of hearing you).
// Built here, mutated in src/app.js (MODS.harp, MOD_IDS.push), so buildMods() returns a fresh table.
import { byId as instrumentById } from './index.js';
import { rangeForInstrument } from '../audio/range.js';
import { TRAINER_LEVELS as KIT_LEVELS } from './drum-kit.js';
import { KBD_LEVEL_PITCH_POOLS as KBD_POOLS } from './kbd-songs.js';
import { t } from '../core/i18n.js';

// Same one-liner as src/app.js's own pc (closure helper there, not importable).
const pc = m => ((Math.round(m) % 12) + 12) % 12;
  const N = (...ms) => ms.map(m => 'n' + m), Wn = (...ms) => ms.map(m => 'w' + m), SF = (s, ...fs) => fs.map(f => 's' + s + 'f' + f), V = (...ds) => ds.map(d => 'v' + d);
  // posWord names the positional unit in each per-string level's label:
  // 'fret' for every fretted instrument (frets 1 to N, a fingerboard dot the
  // player can feel), 'position' for the bowed instruments (violin, viola,
  // cello, double-bass -- fretless, so there is nothing to feel for, only a
  // pitch to match; see MODS.violin etc.'s fretless flag in this same file).
  function stringLevels(tuning, names, maxFret, chordSet, posWord) {
    const w = posWord || 'fret', L = [], ns = tuning.length, natural = (s, lo, hi) => { const out = []; for (let f = lo; f <= hi; f++) if ([0, 2, 4, 5, 7, 9, 11].indexOf(pc(tuning[s] + f)) >= 0) out.push(f); return out; };
    L.push({ name: 'The open strings', add: tuning.map((t, i) => 's' + (ns - i) + 'f0'), limit: 9 });
    for (let i = 0; i < ns; i++) { const sn = ns - i, mid = Math.min(5, maxFret); L.push({ name: names[i] + ' string, ' + w + 's 1 to ' + mid, add: SF(sn, ...natural(i, 1, mid)), limit: 9 }); if (maxFret > 5) L.push({ name: names[i] + ' string, up the neck', add: SF(sn, ...natural(i, 6, maxFret)), limit: 9 }); }
    L.push({ name: 'Moves: two notes', task: 'seq', len: 2, limit: 8 }); L.push({ name: 'Moves: three notes', task: 'seq', len: 3, limit: 7 });
    L.push({ name: 'Find it by name, no dot', add: [0, 2, 4, 5, 7, 9, 11].map(k => 'p' + k), pool: 'p', limit: 9, blind: true });
    L.push({ name: 'Sharps and flats by name', add: [1, 3, 6, 8, 10].map(k => 'p' + k), pool: 'p', limit: 9, blind: true });
    if (chordSet) { L.push({ name: 'First chords (listening is experimental)', add: chordSet.slice(0, 3).map(c => 'c' + c), task: 'chord', pool: 'c', limit: 14 }); L.push({ name: 'More chords', add: chordSet.slice(3).map(c => 'c' + c), task: 'chord', pool: 'c', limit: 12 }); L.push({ name: 'Chord changes', task: 'seq', len: 2, pool: 'c', limit: 10 }); }
    return L;
  }
  const transposedMicRange = rec => rangeForInstrument({ range: { low: rec.range.low + rec.transposition, high: rec.range.high + rec.transposition } });
export function buildMods() {
  const MODS = {
    kbd: { name: 'Keyboard', tag: 'MIDI or on-screen keys', color: '#2f93ee', input: 'midi', get help() { return t('kbd.help'); },
      // Each level's new notes come from KBD_LEVEL_PITCH_POOLS (src/instruments/
      // kbd-songs.js), the one copy the song hand-off also reads.
      levels: [
        { name: 'C, D and E', add: N(...KBD_POOLS[0]), limit: 8 }, { name: 'Add F and G', add: N(...KBD_POOLS[1]), limit: 8 }, { name: 'Add A, B and high C', add: N(...KBD_POOLS[2]), limit: 8 },
        { name: 'Black keys: F sharp and B flat', add: N(...KBD_POOLS[3]), limit: 8 }, { name: 'Black keys: C sharp, E flat, A flat', add: N(...KBD_POOLS[4]), limit: 8 },
        { name: 'Moves: two notes', task: 'seq', len: 2, limit: 6 }, { name: 'Moves: three notes', task: 'seq', len: 3, limit: 5 },
        { name: 'The octave below', add: N(...KBD_POOLS[7]), limit: 7 }, { name: 'Five-note runs', task: 'run', limit: 4 },
        { name: 'Chords: C, F and G', add: ['cC', 'cF', 'cG'], task: 'chord', pool: 'c', limit: 12 }, { name: 'Chords: A minor, D minor, E minor', add: ['cAm', 'cDm', 'cEm'], task: 'chord', pool: 'c', limit: 10 },
        { name: 'Chord changes', task: 'seq', len: 2, pool: 'c', limit: 8 },
        { name: 'Hands together: five-finger position (MIDI exact, mic approximate)', add: ['j1', 'j2', 'j3', 'j4', 'j5'], task: 'hands', pool: 'j', limit: 10 },
        { name: 'Hands together: matching rhythms (MIDI or computer keys)', add: ['j1t', 'j2t', 'j3t', 'j4t', 'j5t'], task: 'hands', pool: 'j', sfx: 't', timed: true, limit: 10 },
        // K4: levels 15-16 are two more LEARN-then-CHECK stages on the same
        // five pairs (src/core/hands-together.js), each its own distinct
        // mastery -- `stage` is what onNote/onNoteOff/renderOpts key their
        // CHECK-phase branching off (handsStageFromId), and `timed: true`
        // (carried over unchanged from level 14) is what keeps every
        // existing `!D().timed`/`!d.timed` guard skipping the level-13
        // hands-selector lock and prep line for these levels too.
        { name: 'Hands together: held bass under the melody (MIDI or computer keys)', add: ['j1h', 'j2h', 'j3h', 'j4h', 'j5h'], task: 'hands', pool: 'j', sfx: 'h', timed: true, stage: 'held', limit: 14 },
        { name: 'Hands together: different rhythms in each hand (MIDI or computer keys)', add: ['j1d', 'j2d', 'j3d', 'j4d', 'j5d'], task: 'hands', pool: 'j', sfx: 'd', timed: true, stage: 'split', limit: 14 },
        // K5: level 17 ("hand position change") is a fourth LEARN-then-move
        // stage on the same five pairs -- `timed: true` is unrelated to any
        // actual clock here (this level is untimed, see
        // src/core/hands-together.js's gradePositionChange); it is only
        // what keeps the `!D().timed`/`!d.timed` guards (same as 14-16)
        // skipping level 13's hands-selector lock and prep line, which does
        // not apply to this level either.
        { name: 'Hands together: hand position change (MIDI or computer keys)', add: ['j1p', 'j2p', 'j3p', 'j4p', 'j5p'], task: 'hands', pool: 'j', sfx: 'p', timed: true, stage: 'position', limit: 20 }
      ] },
    gtr: { name: 'Guitar', tag: 'microphone', color: '#f28b25', input: 'pluck', fmin: 70, fmax: 1200, tuning: [40, 45, 50, 55, 59, 64], frets: 12, help: 'Guitar: press Connect to let the page listen through your microphone or audio interface. On a single-note lesson, play one clean note at a time; if it hears a strum instead it will tell you so rather than staying silent. It hears the pitch, not which string you used, so any place that gives the right note counts. Chord listening is experimental: the microphone hears a chord as one blended sound, not separate notes, and a very noisy room can fool it either way.', levels: null },
    bass: { name: 'Bass', tag: 'microphone', color: '#e8392f', input: 'pluck', fmin: 36, fmax: 500, tuning: [28, 33, 38, 43], frets: 12, help: 'Bass: press Connect to let the page listen. Play one clean note at a time and let it ring for a moment; low notes take a little longer to recognise.', levels: null },
    uke: { name: 'Ukulele', tag: 'microphone', color: '#f3c52f', input: 'pluck', fmin: 200, fmax: 1500, tuning: [67, 60, 64, 69], frets: 7, help: 'Ukulele: press Connect to let the page listen. Standard tuning G C E A with the high G. On a single-note lesson, play one clean note at a time; if it hears a strum instead it will tell you so rather than staying silent. Chord listening is experimental: the microphone hears a chord as one blended sound, not separate notes, and a very noisy room can fool it either way.', levels: null },
    voice: { name: 'Voice', tag: 'microphone', color: '#41c651', input: 'sustain', fmin: 70, fmax: 1100, help: 'Voice: press Connect to let the page listen. Hold each note steady for about half a second. Any octave counts, so sing where it is comfortable. The dot shows your pitch live; the feedback tells you how many cents sharp or flat you were (100 cents is one key on a piano).',
      levels: [
        { name: 'Match a note: Do, Re, Mi', add: V(0, 2, 4), ref: 'target', limit: 12 }, { name: 'Add Fa and Sol', add: V(5, 7), ref: 'target', limit: 12 }, { name: 'Add La, Ti and high Do', add: V(9, 11, 12), ref: 'target', limit: 12 },
        { name: 'From Do only: find the note yourself', ref: 'tonic', limit: 12 }, { name: 'Two notes in a row', task: 'seq', len: 2, ref: 'tonic', limit: 12 }, { name: 'Long tones: hold it steady for two seconds', task: 'hold', ref: 'target', limit: 14 },
        { name: 'Three notes in a row', task: 'seq', len: 3, ref: 'tonic', limit: 12 }, { name: 'The notes in between', add: V(1, 3, 6, 8, 10), ref: 'target', limit: 12 }
      ] },
    wind: { name: 'Wind and brass', tag: 'microphone', color: '#b07cf0', input: 'sustain', fmin: 60, fmax: 1500, help: 'Wind and brass: choose your instrument family so written notes match what you read, then press Connect. Hold each note steady for about half a second. The gauge shows how sharp or flat you are.',
      levels: [
        { name: 'First three notes', add: Wn(67, 69, 71), limit: 12 }, { name: 'Two more, going up', add: Wn(72, 74), limit: 12 }, { name: 'Going down', add: Wn(65, 64), limit: 12 }, { name: 'Down to low C', add: Wn(62, 60), limit: 12 },
        { name: 'Moves: two notes', task: 'seq', len: 2, limit: 10 }, { name: 'F sharp and B flat', add: Wn(66, 70), limit: 12 }, { name: 'Long tones: two steady seconds', task: 'hold', limit: 14 },
        { name: 'Moves: three notes', task: 'seq', len: 3, limit: 9 }, { name: 'Five-note runs', task: 'run', limit: 8 }, { name: 'The upper notes', add: Wn(76, 77, 79), limit: 12 }
      ] },
    // Named "Interval drill" rather than "Ear training" so its picker button
    // never collides with the instrument sheet's own "Ear training" panel
    // button (src/ui/ear.js, registerEar(), homed in the Tools group in src/app.js
    // -- see PANEL_TOOL_IDS) -- read both before touching this: they are
    // genuinely different features, not one duplicated twice. The name says
    // what this one actually is; calling it a variant of "Ear training"
    // ("Ear training: quick drill", the first attempt) still read as a second
    // door to the same room to anyone who does not know the internals.
    // This pseudo-mod is a single interval/chord-ID drill woven into
    // the normal instrument session (streak, level, timer, mastery, the 1-9
    // number-key shortcut at the top-level keydown handler). The panel is a
    // separate standalone screen with eight distinct exercise types (scale
    // degrees, melodic/rhythm dictation, progressions, scales & modes,
    // inversions, intonation, sing-back), each with its own five-level
    // adaptive difficulty and accuracy tracking -- a broader, more complete
    // ear-training suite that does not fit the per-instrument session loop.
    // Keeping both and renaming (rather than deleting either) is the U3
    // finding's explicit fallback for "genuinely different features".
    ear: { name: 'Interval drill', tag: 'listen and answer', color: '#35c9c0', input: 'answer', help: 'Ear training: listen, then pick the answer with the buttons or the number keys. Hear it again as often as you like. After each answer the keyboard shows you what was played.',
      levels: [
        { name: 'Second, third or fifth (going up)', add: ['i2a', 'i4a', 'i7a'], pool: 'i', limit: 14 }, { name: 'Add the fourth and the octave', add: ['i5a', 'i12a'], pool: 'i', limit: 14 }, { name: 'Add the minor third and minor second', add: ['i3a', 'i1a'], pool: 'i', limit: 14 },
        { name: 'Add the sixths, tritone and sevenths', add: ['i9a', 'i8a', 'i6a', 'i10a', 'i11a'], pool: 'i', limit: 14 }, { name: 'Going down', add: ['i2d', 'i4d', 'i7d', 'i5d', 'i3d', 'i12d'], pool: 'i', sfx: 'd', limit: 14 },
        { name: 'Both notes at once', add: ['i4h', 'i7h', 'i3h', 'i5h', 'i12h', 'i2h'], pool: 'i', sfx: 'h', limit: 14 }, { name: 'Major or minor chord', add: ['qmaj', 'qmin'], pool: 'q', limit: 14 },
        { name: 'Add diminished and augmented', add: ['qdim', 'qaug'], pool: 'q', limit: 14 }, { name: 'Seventh chords', add: ['qdom7', 'qmaj7', 'qmin7'], pool: 'q', limit: 14 }
      ] },
    rhy: { name: 'Rhythm reading', tag: 'tap along', color: '#e9edf6', input: 'tap', help: 'Rhythm reading: read the bar, listen to four clicks, then tap it with the space bar, the big pad, or any key on a connected MIDI instrument. Marks under the notes show each tap: green on time, yellow early or late, red missed.',
      levels: [
        { name: 'Quarter notes and rests', add: ['rq', 'rqr'], task: 'bar', bpm: 66 }, { name: 'Add pairs of eighths', add: ['ree'], task: 'bar', bpm: 66 }, { name: 'Add half notes', add: ['rh'], task: 'bar', bpm: 72 },
        { name: 'The off-beat eighth', add: ['rree'], task: 'bar', bpm: 72 }, { name: 'Dotted quarter and eighth', add: ['rdqe'], task: 'bar', bpm: 72 }, { name: 'Sixteenth notes', add: ['rssss'], task: 'bar', bpm: 66 },
        { name: 'Eighth and two sixteenths', add: ['ress', 'rsse'], task: 'bar', bpm: 66 }, { name: 'Syncopation', add: ['reqe'], task: 'bar', bpm: 72 },
        { name: 'Rests: halves and wholes', task: 'bar2', metre: '4/4', bpm: 66, bars: [[['q', 'q', 'hr']], [['hr', 'q', 'q']], [['wr']], [['q', 'hr', 'q']]] },
        { name: 'Ties', task: 'bar2', metre: '4/4', bpm: 66, bars: [[['tqq', 'q', 'q']], [['q', 'tqq', 'q']], [['th', 'q']], [['q', 'q', 'q'], ['q~', 'q', 'q', 'q']]] },
        { name: 'Dotted eighth and sixteenth', task: 'bar2', metre: '4/4', bpm: 66, bars: [[['des', 'des', 'q', 'q']], [['q', 'des', 'des', 'q']], [['des', 'q', 'des', 'q']]] },
        { name: 'Triplets', task: 'bar2', metre: '4/4', bpm: 66, bars: [[['et3', 'et3', 'q', 'q']], [['qt3', 'q', 'q']], [['q', 'et3', 'et3', 'q']]] },
        { name: 'Three-four time', task: 'bar2', metre: '3/4', bpm: 72, bars: [[['q', 'q', 'q']], [['h', 'q']], [['q', 'h']], [['dh.']]] },
        { name: 'Six-eight time', task: 'bar2', metre: '6/8', bpm: 72, bars: [[['dq', 'dq']], [['e3', 'e3']], [['dq', 'e3']], [['e3', 'dq']], [['dqr', 'dq']]] },
        { name: 'Swing eighths', task: 'bar2', metre: '4/4', bpm: 96, swing: 1, bars: [[['ee', 'ee', 'q', 'q']], [['q', 'ee', 'ee', 'q']], [['ee', 'ee', 'ee', 'ee']]] },
        { name: 'Two-bar phrases', task: 'bar2', metre: '4/4', bpm: 72, bars: [[['q', 'q', 'q', 'q'], ['q', 'ee', 'h']], [['h', 'ee', 'q'], ['tqq', 'q', 'q']], [['ee', 'ee', 'q', 'q'], ['q', 'q', 'hr']]] }
      ] }
  };
  MODS.gtr.levels = stringLevels(MODS.gtr.tuning, ['Low E', 'A', 'D', 'G', 'B', 'High E'], 12, ['Em', 'G', 'C', 'D', 'Am', 'E', 'A']);
  MODS.bass.levels = stringLevels(MODS.bass.tuning, ['E', 'A', 'D', 'G'], 12, null);
  MODS.uke.levels = stringLevels(MODS.uke.tuning, ['G', 'C', 'E', 'A'], 7, ['C', 'Am', 'F', 'G7']);
  // Five more fretted mic instruments, added straight from the instruments
  // registry (src/instruments/index.js) rather than restating each one's
  // tuning/name/range a second time here: tuning and name come off the
  // registry record, and fmin/fmax come from rangeForInstrument() on that
  // same record's `range` -- one source of truth for all three. See each
  // record's own file for why its curriculum and chordSet look the way
  // they do (fret-count choices).
  const mandolinRange = rangeForInstrument(instrumentById.mandolin);
  MODS.mandolin = { name: instrumentById.mandolin.name, tag: 'microphone', color: '#7fd1ae', input: 'pluck', fmin: mandolinRange.fmin, fmax: mandolinRange.fmax, tuning: instrumentById.mandolin.tuning, frets: 12, help: 'Mandolin: press Connect to let the page listen through your microphone or audio interface. Standard tuning G D A E. On a single-note lesson, play one clean note at a time; if it hears a strum instead it will tell you so rather than staying silent.', levels: null };
  MODS.mandolin.levels = stringLevels(MODS.mandolin.tuning, ['G', 'D', 'A', 'E'], 12, null);
  const banjoRange = rangeForInstrument(instrumentById['banjo-5-string']);
  MODS['banjo-5-string'] = { name: instrumentById['banjo-5-string'].name, tag: 'microphone', color: '#caa04d', input: 'pluck', fmin: banjoRange.fmin, fmax: banjoRange.fmax, tuning: instrumentById['banjo-5-string'].tuning, frets: 12, help: '5-string banjo: press Connect to let the page listen through your microphone or audio interface. Standard open-G tuning, 5th string included. On a single-note lesson, play one clean note at a time; if it hears a strum instead it will tell you so rather than staying silent.', levels: null };
  MODS['banjo-5-string'].levels = stringLevels(MODS['banjo-5-string'].tuning, ['G', 'D', 'G', 'B', 'D'], 12, null);
  const bass5Range = rangeForInstrument(instrumentById['bass-5-string']);
  MODS['bass-5-string'] = { name: instrumentById['bass-5-string'].name, tag: 'microphone', color: '#c2453a', input: 'pluck', fmin: bass5Range.fmin, fmax: bass5Range.fmax, tuning: instrumentById['bass-5-string'].tuning, frets: 12, help: '5-string bass: press Connect to let the page listen. Play one clean note at a time and let it ring for a moment, including the low B string.', levels: null };
  MODS['bass-5-string'].levels = stringLevels(MODS['bass-5-string'].tuning, ['B', 'E', 'A', 'D', 'G'], 12, null);
  // Four bowed instruments: fretless, so `fretless: true` tells drawFret()
  // not to draw fret wires (a plain fingerboard, position dots instead) and
  // the info/validId override in src/app.js (see the _info3/_valid3 pair) not to
  // label a position "fret N" the way the fretted six above do. 'sustain'
  // (not 'pluck') because a bowed note is held, not plucked -- the same
  // input voice/wind/harp already use, judged the same intonation-first way
  // (src/app.js onPitch's M.input === 'sustain' branch: exact-pitch cents against
  // e.info.midi, shown live on the same cents gauge). `frets: 5` sets
  // drawFret's position-dot spacing to match each record's own maxFret 5.
  const violinRange = rangeForInstrument(instrumentById.violin);
  MODS.violin = { name: instrumentById.violin.name, tag: 'microphone', color: '#d97b5f', input: 'sustain', fmin: violinRange.fmin, fmax: violinRange.fmax, tuning: instrumentById.violin.tuning, frets: 5, fretless: true, help: 'Violin: press Connect to let the page listen through your microphone or audio interface. Standard tuning G D A E. There are no frets to feel for, so hold each note steady for about half a second and let the gauge tell you how sharp or flat you are; the dot marks roughly where your finger should land.', levels: null };
  MODS.violin.levels = stringLevels(MODS.violin.tuning, ['G', 'D', 'A', 'E'], 5, null, 'position');
  const violaRange = rangeForInstrument(instrumentById.viola);
  MODS.viola = { name: instrumentById.viola.name, parent: 'violin', tag: 'microphone', color: '#c2654f', input: 'sustain', fmin: violaRange.fmin, fmax: violaRange.fmax, tuning: instrumentById.viola.tuning, frets: 5, fretless: true, help: 'Viola: press Connect to let the page listen through your microphone or audio interface. Standard tuning C G D A. There are no frets to feel for, so hold each note steady for about half a second and let the gauge tell you how sharp or flat you are; the dot marks roughly where your finger should land.', levels: null };
  MODS.viola.levels = stringLevels(MODS.viola.tuning, ['C', 'G', 'D', 'A'], 5, null, 'position');
  const celloRange = rangeForInstrument(instrumentById.cello);
  MODS.cello = { name: instrumentById.cello.name, parent: 'violin', tag: 'microphone', color: '#a8503f', input: 'sustain', fmin: celloRange.fmin, fmax: celloRange.fmax, tuning: instrumentById.cello.tuning, frets: 5, fretless: true, help: 'Cello: press Connect to let the page listen through your microphone or audio interface. Standard tuning C G D A, an octave below viola. There are no frets to feel for, so hold each note steady for about half a second and let the gauge tell you how sharp or flat you are; the dot marks roughly where your finger should land.', levels: null };
  MODS.cello.levels = stringLevels(MODS.cello.tuning, ['C', 'G', 'D', 'A'], 5, null, 'position');
  const doubleBassRange = rangeForInstrument(instrumentById['double-bass']);
  MODS['double-bass'] = { name: instrumentById['double-bass'].name, parent: 'violin', tag: 'microphone', color: '#8a3f33', input: 'sustain', fmin: doubleBassRange.fmin, fmax: doubleBassRange.fmax, tuning: instrumentById['double-bass'].tuning, frets: 5, fretless: true, help: 'Double bass: press Connect to let the page listen through your microphone or audio interface. Standard tuning E A D G. There are no frets to feel for, so hold each note steady for about half a second and let the gauge tell you how sharp or flat you are; the low open E takes the mic a little longer to lock onto.', levels: null };
  MODS['double-bass'].levels = stringLevels(MODS['double-bass'].tuning, ['E', 'A', 'D', 'G'], 5, null, 'position');
  const ukeLowGRange = rangeForInstrument(instrumentById['ukulele-low-g']);
  MODS['ukulele-low-g'] = { name: instrumentById['ukulele-low-g'].name, tag: 'microphone', color: '#e6c34a', input: 'pluck', fmin: ukeLowGRange.fmin, fmax: ukeLowGRange.fmax, tuning: instrumentById['ukulele-low-g'].tuning, frets: 7, help: 'Low-G ukulele: press Connect to let the page listen. Standard tuning G C E A with a low, non-re-entrant G. On a single-note lesson, play one clean note at a time; if it hears a strum instead it will tell you so rather than staying silent. Chord listening is experimental.', levels: null };
  MODS['ukulele-low-g'].levels = stringLevels(MODS['ukulele-low-g'].tuning, ['G', 'C', 'E', 'A'], 7, ['C', 'Am', 'F', 'G7']);
  const ukeBaritoneRange = rangeForInstrument(instrumentById['ukulele-baritone']);
  MODS['ukulele-baritone'] = { name: instrumentById['ukulele-baritone'].name, tag: 'microphone', color: '#b8863b', input: 'pluck', fmin: ukeBaritoneRange.fmin, fmax: ukeBaritoneRange.fmax, tuning: instrumentById['ukulele-baritone'].tuning, frets: 12, help: 'Baritone ukulele: press Connect to let the page listen. Standard tuning D G B E, the same pitches as the top four guitar strings. On a single-note lesson, play one clean note at a time; if it hears a strum instead it will tell you so rather than staying silent.', levels: null };
  MODS['ukulele-baritone'].levels = stringLevels(MODS['ukulele-baritone'].tuning, ['D', 'G', 'B', 'E'], 12, null);
  // Descant recorder and tin whistle: held-pitch wind instruments like
  // MODS.wind/MODS.harp (MODS.harp is in src/app.js) (input 'sustain', not 'pluck' -- a blown note
  // is held, not struck), so their levels use plain N() note ids at SOUNDING
  // pitch straight off each record's own curriculum (src/instruments/
  // recorder-descant.js, tin-whistle.js -- see those files for why sounding
  // pitch is a full octave above what a beginner method book prints, and why
  // octavePolicy stays exact). `staff: true` and `writtenOffset: -12` record
  // the same octave gap for the notation drawing pass to honour once it
  // reads them (src/app.js drawStaff/draw dispatch); until then they are
  // inert extra fields, harmless to the rest of MODS.
  const recorderRange = rangeForInstrument(instrumentById['recorder-descant']);
  MODS['recorder-descant'] = { name: instrumentById['recorder-descant'].name, parent: 'wind', tag: 'microphone', color: '#d98fd9', input: 'sustain', fmin: recorderRange.fmin, fmax: recorderRange.fmax, staff: true, writtenOffset: -12, help: 'Descant recorder: press Connect to let the page listen through your microphone. Hold each note steady for about half a second. Starts on B, A and G, the first three notes most method books teach.', levels: null };
  MODS['recorder-descant'].levels = [
    { name: 'First three notes: B, A, G', add: N(83, 81, 79), limit: 12 }, { name: 'Two more, going up: high C and D', add: N(84, 86), limit: 12 },
    { name: 'Going down: E', add: N(76), limit: 12 }, { name: 'Down to low D and C', add: N(74, 72), limit: 12 },
    { name: 'Moves: two notes', task: 'seq', len: 2, limit: 10 }, { name: 'The tricky note: F (forked fingering)', add: N(77), limit: 12 },
    { name: 'Long tones: two steady seconds', task: 'hold', limit: 14 }, { name: 'Moves: three notes', task: 'seq', len: 3, limit: 9 },
    { name: 'Five-note runs', task: 'run', limit: 8 }
  ];
  const whistleRange = rangeForInstrument(instrumentById['tin-whistle']);
  MODS['tin-whistle'] = { name: instrumentById['tin-whistle'].name, parent: 'wind', tag: 'microphone', color: '#8fd9a0', input: 'sustain', fmin: whistleRange.fmin, fmax: whistleRange.fmax, staff: true, writtenOffset: -12, help: 'Tin whistle (D): press Connect to let the page listen through your microphone. Hold each note steady for about half a second. Starts on D, E and F sharp, the bottom of the D-major scale, and works up one octave.', levels: null };
  MODS['tin-whistle'].levels = [
    { name: 'First three notes: D, E, F sharp', add: N(74, 76, 78), limit: 12 }, { name: 'Two more, going up: G and A', add: N(79, 81), limit: 12 },
    { name: 'Finishing the octave: B and C sharp', add: N(83, 85), limit: 12 }, { name: 'The top of the octave: high D', add: N(86), limit: 12 },
    { name: 'Moves: two notes', task: 'seq', len: 2, limit: 10 }, { name: 'Long tones: two steady seconds', task: 'hold', limit: 14 },
    { name: 'Moves: three notes', task: 'seq', len: 3, limit: 9 }, { name: 'Five-note runs', task: 'run', limit: 8 }
  ];
  // Mallet percussion (bells/glockenspiel): not fretted, so it does not
  // reuse stringLevels/drawFret like the six mic instruments above it. It
  // reuses MODS.kbd's own note-group shape instead (N() item ids, same
  // rendering via drawKeys in draw() in src/app.js) because a bell/xylophone bar
  // row IS a keyboard layout -- see src/instruments/mallet-percussion.js
  // for the range choice and the mic-detectability measurement behind
  // status: 'ready'.
  const malletRange = rangeForInstrument(instrumentById['mallet-percussion']);
  MODS['mallet-percussion'] = { name: instrumentById['mallet-percussion'].name, tag: 'microphone', color: '#5ec8f0', input: 'pluck', fmin: malletRange.fmin, fmax: malletRange.fmax, help: 'Mallet percussion: press Connect to let the page listen through your microphone or audio interface. Strike one bar at a time and let it ring; a fast re-strike of the same bar is heard as a new note.', levels: null };
  MODS['mallet-percussion'].levels = [
    { name: 'C, D and E', add: N(60, 62, 64), limit: 8 }, { name: 'Add F and G', add: N(65, 67), limit: 8 }, { name: 'Add A, B and high C', add: N(69, 71, 72), limit: 8 },
    { name: 'Sharps and flats: F sharp and B flat', add: N(66, 70), limit: 8 }, { name: 'Sharps and flats: C sharp, E flat, A flat', add: N(61, 63, 68), limit: 8 },
    { name: 'Moves: two notes', task: 'seq', len: 2, limit: 6 }, { name: 'Moves: three notes', task: 'seq', len: 3, limit: 5 },
    { name: 'Up an octave', add: N(74, 76, 77, 79, 81, 83, 84), limit: 8 }, { name: 'Five-note runs', task: 'run', limit: 4 }
  ];
  // MODS.wind draws its own hand-built staff too (it always has); mark it
  // with the same generic `staff` flag the three brass mods below use, so
  // draw()'s dispatch and drawStaff() no longer special-case `mod ===
  // 'wind'` by name.
  MODS.wind.staff = true;
  // Three beginner brass instruments (trumpet, French horn, trombone): each
  // gets its own MODS entry rather than reusing the generic MODS.wind
  // trainer, because MODS.wind's transposition comes from the learner's
  // global prefs.wind (WIND_KINDS, in src/app.js) -- fine for a single shared
  // "choose your instrument" trainer, wrong for a dedicated trumpet/horn/
  // trombone mod, whose written notes must always read in that instrument's
  // own key regardless of what the learner last picked in Wind and brass.
  // `windKind` on the MODS entry is that fix: the 'w' branch of info() in src/app.js
  // prefers M.windKind over prefs.wind when present. `staff: true` is the
  // generic flag draw()'s dispatch (in src/app.js) and drawStaff() use instead of
  // `mod === 'wind'`, so any current or future notated mod (this trio, and
  // MODS.wind itself) gets the same hand-built staff. transposedMicRange
  // turns each record's WRITTEN range + transposition into the instrument's
  // actual SOUNDING range before handing it to rangeForInstrument(), since
  // rangeForInstrument()/frameSizeForInstrument() otherwise read
  // instrumentById[mod].range verbatim (written pitch for a transposing
  // instrument), which would search the pitch detector around the wrong
  // acoustic frequencies.
  // Trombone's 'w' item numbers are written pitch + 19 (WIND_KINDS.bc's bass-
  // clef register shift, info() 'w' branch in src/app.js), so Wn(59, 61, ...) in its row
  // plays written/sounding 40, 42, ... -- this record's own range.
  // Five keyed woodwinds (flute, clarinet, oboe, alto sax, tenor sax): same
  // pattern as the brass trio above -- own MODS entry, own fixed windKind so
  // written notes always read in that instrument's own key regardless of
  // the learner's generic Wind and brass preference, `staff: true` for the
  // shared hand-built staff. Level notes match each record's own
  // src/instruments/*.js curriculum (see those files' comments for the note
  // choices), and Wn(...) note ids are checked against
  // src/instruments/how/keyed-woodwind.js by
  // tests/unit/computed-instruments-keyed-woodwind.test.mjs.
  // id, color, windKind, help, then each note level as [name, ...written midis].
  const WIND_MODS = [
    ['trumpet-bb', '#d1592f', 'bb', 'Trumpet (B flat): press Connect to let the page listen through your microphone or audio interface. Hold each note steady for about half a second. Written notes always read for B flat trumpet here, whatever you last chose on Wind and brass.',
      [['Written C, D and E', 60, 62, 64], ['Add F and G', 65, 67], ['Add A, B and high C', 69, 71, 72], ['Sharps and flats: F sharp and B flat', 66, 70]]],
    ['horn-f', '#c9a15a', 'f', 'French horn (F): press Connect to let the page listen through your microphone or audio interface. Hold each note steady for about half a second. Written notes always read for F horn here, whatever you last chose on Wind and brass.',
      [['Written G, A and B', 55, 57, 59], ['Add C and D', 60, 62], ['Add E, F and high G', 64, 65, 67], ['Sharps and flats: C sharp and F sharp', 61, 66]]],
    ['trombone', '#8f8fbd', 'bc', 'Trombone: press Connect to let the page listen through your microphone or audio interface. Hold each note steady for about half a second.',
      [['First three notes', 59, 61, 63], ['Two more, going up', 64, 66], ['Up to the top', 68, 70, 71]]],
    ['flute', '#5ab4d9', 'c', 'Flute: press Connect to let the page listen through your microphone. Hold each note steady for about half a second. Written notes always read at concert pitch here, whatever you last chose on Wind and brass.',
      [['Written C, D and E', 60, 62, 64], ['Add F and G', 65, 67], ['Add A, B and high C', 69, 71, 72], ['Sharps and flats: F sharp and B flat', 66, 70]]],
    ['oboe', '#d9975a', 'c', 'Oboe: press Connect to let the page listen through your microphone. Hold each note steady for about half a second. Written notes always read at concert pitch here, whatever you last chose on Wind and brass.',
      [['Written D, E and F sharp', 62, 64, 66], ['Add G and A', 67, 69], ['Add B, C sharp and high D', 71, 73, 74], ['Sharps and flats: E flat and G sharp', 63, 68]]],
    ['clarinet-bb', '#7a5ad9', 'bb', 'Clarinet (B flat): press Connect to let the page listen through your microphone. Hold each note steady for about half a second. Written notes always read for B flat clarinet here, whatever you last chose on Wind and brass.',
      [['Written G, A and B', 55, 57, 59], ['Add C and D', 60, 62], ['Add E, F and high G', 64, 65, 67], ['Sharps and flats: A flat and C sharp', 56, 61]]],
    ['sax-alto-eb', '#d95a8f', 'eb', 'Alto sax (E flat): press Connect to let the page listen through your microphone. Hold each note steady for about half a second. Written notes always read for E flat alto sax here, whatever you last chose on Wind and brass.',
      [['Written B flat, B and C', 58, 59, 60], ['Add D and E', 62, 64], ['Add F, F sharp and high G', 65, 66, 67], ['Sharps and flats: E flat and C sharp', 63, 61]]],
    ['sax-tenor-bb', '#5ad9c2', 'bbt', 'Tenor sax (B flat): press Connect to let the page listen through your microphone. Hold each note steady for about half a second. Written notes always read for B flat tenor sax here, whatever you last chose on Wind and brass.',
      [['Written B flat, B and C', 58, 59, 60], ['Add D and E', 62, 64], ['Add F, F sharp and high G', 65, 66, 67], ['Sharps and flats: E flat and C sharp', 63, 61]]]
  ];
  // Every staff-wind entry ends with the same three levels; trombone has 3 note levels, the rest 4.
  function windMod(id, color, windKind, help, noteLevels) {
    const r = transposedMicRange(instrumentById[id]);
    return { name: instrumentById[id].name, parent: 'wind', tag: 'microphone', color, input: 'sustain', windKind, staff: true, fmin: r.fmin, fmax: r.fmax, help,
      levels: noteLevels.map(([name, ...ms]) => ({ name, add: Wn(...ms), limit: 12 })).concat([
        { name: 'Moves: two notes', task: 'seq', len: 2, limit: 10 },
        { name: 'Moves: three notes', task: 'seq', len: 3, limit: 9 },
        { name: 'Five-note runs', task: 'run', limit: 8 }
      ]) };
  }
  for (const row of WIND_MODS) MODS[row[0]] = windMod(...row);
  // Drum kit (src/instruments/drum-kit.js): a percussion-staff bar like rhythm reading, but each
  // note names a drum, so task 'kit' judges WHICH piece and WHEN (startKitBar/tickKitBar in src/app.js).
  MODS['drum-kit'] = { name: instrumentById['drum-kit'].name, tag: 'MIDI / keys / mic', color: '#f08a4b', input: 'mic+midi', kit: true, help: 'Drum kit: plug in an electronic kit over MIDI, use the keys (F kick, J snare, D closed hat, E open hat, C hat pedal, U high tom, I mid tom, K floor tom, R crash, O ride), click the drawn kit, or press Connect and play a real kit in front of your microphone. Read the bar, listen to the count, play it. Marks under the notes: green on time, yellow a little early or late, red missed or the wrong drum. Through a microphone the app hears kick, snare and hi-hat only; a tom, crash or ride comes back as a hit with no drum name, so a level that needs one of those still passes it on time, just without naming the drum -- for a chart that grades which drum, plug in MIDI or use the keys instead.', levels: KIT_LEVELS.map(l => Object.assign({ task: 'kit' }, l)) };
  return MODS;
}
