// Guitar Pro 7/8 `.gp` -> the shared Song shape.
//
// A `.gp` file is a zip archive (same container as `.mxl`) holding an XML
// score at `Content/score.gpif`. alphaTab is deliberately not used — this is
// Band Coach's own small reader of just the pieces of the format a learner's
// score needs: title/artist, the first tempo (later ones become
// `tempoMap`), each bar's time signature and key (later changes become
// `metreChanges`/`keyChanges`), each track's name/tuning/GM program, and
// each bar's notes (rhythm value, dotted duration, tuplets, tied notes,
// rests, chords). Mirrors src/song/import-musicxml.js's output shape
// (`{ song, warnings }`) and error style (plain-English `Error`s, warnings
// are short strings for a learner-facing toast, not exceptions).
//
// Wiring: call `importGp7(bytes, options?)` with the raw bytes
// (ArrayBuffer/Uint8Array) of a `.gp` file, as read by the import route
// (src/ui/songs/import-route.js, kind 'gp7', readAs 'bytes').
//
// GPIF shape read here (see score.gpif inside any .gp7/.gp8 file):
//   <Score><Title/><Artist/></Score>
//   <MasterTrack><Automations><Automation><Type>Tempo</Type><Bar/><Position/>
//     <Value/></Automation></Automations></MasterTrack>
//   <Tracks><Track id><Name/><GeneralMidi><Program/></GeneralMidi>
//     <Staves><Staff><Properties><Property name="Tuning"><Pitches/>
//     </Property></Properties></Staff></Staves></Track></Tracks>
//   <MasterBars><MasterBar><Time/><Key><AccidentalCount/><Mode/></Key>
//     <Bars/></MasterBar></MasterBars>  -- <Bars> is one bar-id per track,
//     in the same order as <MasterTrack><Tracks>; a MasterBar with no
//     <Time>/<Key> carries the previous one forward (unchanged).
//   <Bars><Bar id><Voices/></Bar></Bars> -- 4 voice ids, -1 for unused
//   <Voices><Voice id><Beats/></Voice></Beats>
//   <Beats><Beat id><Rhythm ref/><Notes/></Beat></Beats> -- <Notes> is
//     absent (or empty) for a rest; more than one id is a chord
//   <Rhythms><Rhythm id><NoteValue/><AugmentationDot count/>
//     <PrimaryTuplet num den/></Rhythm></Rhythms>
//   <Notes><Note id><Properties><Property name="String"><String/></Property>
//     <Property name="Fret"><Fret/></Property></Properties><Tie type=
//     "start"|"end"/></Note></Notes> -- pitch is String+Fret resolved via
//     the track's tuning, or a <Property name="Midi"><Number/></Property>
//     when the file already carries an absolute pitch.

import { songIdentity } from './ident.js';
import { parseXml, elements, element, childText, attr } from './xml-lite.js';
import { readZipEntries, readZipEntryData } from './unzip-lite.js';

const TICKS_PER_QUARTER = 480;
const NOTE_VALUE_TICKS = {
  Whole: 1920, Half: 960, Quarter: 480, Eighth: 240, '16th': 120, '32nd': 60, '64th': 30, '128th': 15,
};

function bytesFrom(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return input;
}

function num(str, fallback) {
  if (str === undefined || str === null || str === '') return fallback;
  const n = Number(str);
  return Number.isFinite(n) ? n : fallback;
}

function ints(str) {
  return (str || '').trim().split(/\s+/).filter(Boolean).map(Number);
}

// Same fifths/mode -> tonic math as import-musicxml.js's keyFromFifthsAndMode,
// with GPIF's <AccidentalCount> (negative = flats) standing in for fifths.
function keyFromAccidentalsAndMode(accidentals, modeRaw, warnings) {
  let mode = (modeRaw || 'Major').toLowerCase();
  if (mode !== 'major' && mode !== 'minor') { warnings.push(`key mode "${modeRaw}" is not Major/Minor; treated as major`); mode = 'major'; }
  const tonic = (((7 * accidentals + (mode === 'minor' ? 9 : 0)) % 12) + 12) % 12;
  return { tonic, mode };
}

function propertyNamed(propertiesNode, name) {
  if (!propertiesNode) return undefined;
  return elements(propertiesNode, 'Property').find((p) => attr(p, 'name') === name);
}

function readTrack(trackNode, index) {
  const name = childText(trackNode, 'Name') || `Track ${index + 1}`;
  const gm = element(trackNode, 'GeneralMidi');
  const program = gm ? num(childText(gm, 'Program'), undefined) : undefined;
  const staff = element(element(trackNode, 'Staves'), 'Staff');
  const properties = staff ? element(staff, 'Properties') : undefined;
  const tuningProp = propertyNamed(properties, 'Tuning');
  const tuning = tuningProp ? ints(childText(tuningProp, 'Pitches')) : undefined;
  return { id: attr(trackNode, 'id', String(index)), name, program, tuning };
}

function rhythmTicks(rhythmNode, warnings) {
  const valueName = childText(rhythmNode, 'NoteValue') || 'Quarter';
  const base = NOTE_VALUE_TICKS[valueName];
  if (base === undefined) { warnings.push(`unknown rhythm value "${valueName}"; treated as a quarter note`); return TICKS_PER_QUARTER; }
  const dotNode = element(rhythmNode, 'AugmentationDot');
  const dots = dotNode ? num(attr(dotNode, 'count'), 0) : 0;
  const dotted = base * (2 - 2 ** -Math.max(0, dots));
  const tupletNode = element(rhythmNode, 'PrimaryTuplet');
  if (!tupletNode) return Math.round(dotted);
  const tupletNum = num(attr(tupletNode, 'num'), 1);
  const tupletDen = num(attr(tupletNode, 'den'), 1);
  if (!tupletNum) return Math.round(dotted);
  return Math.round((dotted * tupletDen) / tupletNum);
}

function notePitch(noteNode, tuning, warnings) {
  const properties = element(noteNode, 'Properties');
  const midiProp = propertyNamed(properties, 'Midi');
  if (midiProp) {
    const midi = num(childText(midiProp, 'Number'), undefined);
    if (midi !== undefined) return midi;
  }
  const stringProp = propertyNamed(properties, 'String');
  const fretProp = propertyNamed(properties, 'Fret');
  if (!stringProp || !fretProp) { warnings.push('note with no pitch information (no String/Fret or Midi property) skipped'); return undefined; }
  const stringIndex = num(childText(stringProp, 'String'), undefined);
  const fret = num(childText(fretProp, 'Fret'), undefined);
  if (stringIndex === undefined || fret === undefined) { warnings.push('note with an incomplete String/Fret pair skipped'); return undefined; }
  if (!tuning || tuning[stringIndex] === undefined) { warnings.push('string/fret note found but this track has no matching tuning; skipped'); return undefined; }
  return tuning[stringIndex] + fret;
}

export function importGp7(bytes, options = {}) {
  const zipBytes = bytesFrom(bytes);
  let gpifText;
  try {
    const entries = readZipEntries(zipBytes);
    const scoreEntry = entries.find((e) => e.name === 'Content/score.gpif') || entries.find((e) => /(^|\/)score\.gpif$/i.test(e.name));
    if (!scoreEntry) throw new Error('no score.gpif found inside this .gp file');
    gpifText = new TextDecoder('utf-8').decode(readZipEntryData(zipBytes, scoreEntry));
  } catch (e) {
    throw new Error(`importGp7: this .gp file could not be read: ${e.message}`);
  }

  const root = parseXml(gpifText);
  if (root.name !== 'GPIF') throw new Error(`importGp7: unrecognised root element <${root.name}>; expected <GPIF>`);

  const warnings = [];
  const scoreNode = element(root, 'Score');
  const title = (scoreNode && childText(scoreNode, 'Title')) || null;
  const composer = (scoreNode && childText(scoreNode, 'Artist')) || null;

  const tracksNode = element(root, 'Tracks');
  const trackNodes = tracksNode ? elements(tracksNode, 'Track') : [];
  const tracksById = new Map(trackNodes.map((t, i) => [attr(t, 'id', String(i)), readTrack(t, i)]));
  const masterTrackNode = element(root, 'MasterTrack');
  const trackOrder = masterTrackNode ? ints(childText(masterTrackNode, 'Tracks')).map(String) : trackNodes.map((t, i) => attr(t, 'id', String(i)));

  const rhythmsById = new Map(elements(element(root, 'Rhythms'), 'Rhythm').map((r) => [attr(r, 'id'), r]));
  const notesById = new Map(elements(element(root, 'Notes'), 'Note').map((n) => [attr(n, 'id'), n]));
  const beatsById = new Map(elements(element(root, 'Beats'), 'Beat').map((b) => [attr(b, 'id'), b]));
  const voicesById = new Map(elements(element(root, 'Voices'), 'Voice').map((v) => [attr(v, 'id'), v]));
  const barsById = new Map(elements(element(root, 'Bars'), 'Bar').map((b) => [attr(b, 'id'), b]));

  const masterBarNodes = elements(element(root, 'MasterBars'), 'MasterBar');

  // Pass 1: walk the MasterBars once to get each bar's start tick, its
  // effective time signature and key (carried forward when a MasterBar
  // doesn't restate <Time>/<Key>), and the tempo/metre/key change lists.
  let metre = { num: 4, den: 4 };
  let key = null;
  let initialMetre = { num: 4, den: 4 };
  let initialKey = null;
  const barStartTicks = [];
  const barTrackIds = []; // barTrackIds[masterBarIndex] -> [trackBarId, ...] in trackOrder
  const metreChanges = [];
  const keyChanges = [];
  let tick = 0;
  masterBarNodes.forEach((mb, i) => {
    const timeText = childText(mb, 'Time');
    if (timeText) {
      const [n, d] = timeText.split('/').map((s) => num(s, undefined));
      if (n && d) {
        const newMetre = { num: n, den: d };
        if (i > 0 && (newMetre.num !== metre.num || newMetre.den !== metre.den)) metreChanges.push({ tick, num: newMetre.num, den: newMetre.den });
        metre = newMetre;
      }
    }
    const keyNode = element(mb, 'Key');
    if (keyNode) {
      const accidentals = num(childText(keyNode, 'AccidentalCount'), 0);
      const newKey = keyFromAccidentalsAndMode(accidentals, childText(keyNode, 'Mode'), warnings);
      if (i > 0 && key && (newKey.tonic !== key.tonic || newKey.mode !== key.mode)) keyChanges.push({ tick, tonic: newKey.tonic, mode: newKey.mode });
      key = newKey;
    }
    if (i === 0) { initialMetre = metre; initialKey = key; }
    barStartTicks[i] = tick;
    barTrackIds[i] = ints(childText(mb, 'Bars')).map(String);
    tick += metre.num * (4 / metre.den) * TICKS_PER_QUARTER;
  });

  // Tempo: MasterTrack/Automations, each { Bar, Position (0..1 of the bar) }
  // -> a tick via barStartTicks. First one (in tick order) is the song's
  // initial bpm; the rest become tempoMap entries.
  const automationsNode = masterTrackNode ? element(masterTrackNode, 'Automations') : undefined;
  const tempoEvents = (automationsNode ? elements(automationsNode, 'Automation') : [])
    .filter((a) => childText(a, 'Type') === 'Tempo')
    .map((a) => {
      const barIndex = num(childText(a, 'Bar'), 0);
      const position = num(childText(a, 'Position'), 0);
      const barStart = barStartTicks[barIndex] ?? 0;
      const barDur = (barStartTicks[barIndex + 1] ?? (barStart + metre.num * (4 / metre.den) * TICKS_PER_QUARTER)) - barStart;
      const evTick = barStart + Math.round(position * barDur);
      const [bpmText] = (childText(a, 'Value') || '').trim().split(/\s+/);
      return { tick: evTick, bpm: num(bpmText, undefined) };
    })
    .filter((e) => e.bpm !== undefined)
    .sort((a, b) => a.tick - b.tick);

  let bpm = tempoEvents.length ? tempoEvents[0].bpm : undefined;
  const tempoMap = tempoEvents.slice(1).map((e) => ({ tick: e.tick, bpm: e.bpm }));
  if (bpm === undefined) { bpm = 120; warnings.push('no tempo found; defaulted to 120 bpm'); }

  // Pass 2: for each track, walk its bar-per-MasterBar sequence and read
  // notes off Bars -> Voices -> Beats -> Notes, via each Beat's Rhythm.
  const parts = trackOrder.map((trackId) => {
    const trackInfo = tracksById.get(trackId) || { id: trackId, name: `Track ${trackId}`, tuning: undefined };
    const notes = [];
    const openTies = new Map(); // midi -> note object awaiting a tie end
    const trackPosition = trackOrder.indexOf(trackId);

    masterBarNodes.forEach((mb, mbIndex) => {
      const barId = barTrackIds[mbIndex][trackPosition];
      const barNode = barId !== undefined ? barsById.get(barId) : undefined;
      if (!barNode) return;
      const voiceIds = ints(childText(barNode, 'Voices')).map(String).filter((id) => id !== '-1');
      if (voiceIds.length > 1) warnings.push(`track "${trackInfo.name}" has ${voiceIds.length} voices in one bar; flattened into one`);
      const voiceId = voiceIds[0];
      const voiceNode = voiceId !== undefined ? voicesById.get(voiceId) : undefined;
      if (!voiceNode) return;

      let cursor = barStartTicks[mbIndex];
      for (const beatId of ints(childText(voiceNode, 'Beats')).map(String)) {
        const beatNode = beatsById.get(beatId);
        if (!beatNode) continue;
        const rhythmRef = element(beatNode, 'Rhythm');
        const rhythmNode = rhythmRef ? rhythmsById.get(attr(rhythmRef, 'ref')) : undefined;
        const durTicks = rhythmNode ? rhythmTicks(rhythmNode, warnings) : TICKS_PER_QUARTER;
        const noteIds = ints(childText(beatNode, 'Notes')).map(String);
        for (const noteId of noteIds) {
          const noteNode = notesById.get(noteId);
          if (!noteNode) continue;
          const midi = notePitch(noteNode, trackInfo.tuning, warnings);
          if (midi === undefined) continue;
          const noteObj = { start: cursor, dur: durTicks, midi };
          const tieNode = element(noteNode, 'Tie');
          const tieType = tieNode ? attr(tieNode, 'type') : undefined;
          if (tieType === 'end') {
            if (openTies.has(midi)) { noteObj.tieFromPrev = true; openTies.delete(midi); }
            else warnings.push('tie end found with no matching tie start; ignored');
          }
          if (tieType === 'start') openTies.set(midi, noteObj);
          notes.push(noteObj);
        }
        cursor += durTicks;
      }
    });

    notes.sort((a, b) => a.start - b.start);
    const part = { id: trackInfo.id, name: trackInfo.name, notes };
    if (trackInfo.program !== undefined) part.instrumentHint = `General MIDI program ${trackInfo.program}`;
    return part;
  });

  const song = {
    schema: 'song/1',
    ...songIdentity({ title, fileName: options.fileName, fallback: 'Imported score' }),
    composer,
    licence: null,
    source: null,
    key: initialKey,
    metre: initialMetre,
    bpm,
    ticksPerQuarter: TICKS_PER_QUARTER,
    parts,
    chords: [],
  };
  if (tempoMap.length) song.tempoMap = tempoMap;
  if (metreChanges.length) song.metreChanges = metreChanges;
  if (keyChanges.length) song.keyChanges = keyChanges;
  return { song, warnings };
}
