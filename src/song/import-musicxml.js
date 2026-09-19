// MusicXML (uncompressed, score-partwise) -> the shared Song shape.
//
// Wiring: call `importMusicXml(text)` with the raw text of a `.musicxml`/
// `.xml` file. Returns `{ song, warnings }` per the author brief's Song
// shape (schema 'song/1', ticksPerQuarter 480, notes sorted by `start`).
// `warnings` are short strings for a learner-facing toast/log, not
// exceptions. No I/O, no DOM/global — the caller reads the file.
//
// Deliberately unsupported (thrown, not warned): compressed `.mxl` zip
// archives (extract the uncompressed entry first) and `<score-timewise>`
// documents (measure-major layout; real scores are overwhelmingly
// part-major `<score-partwise>`).

import { parseXml, elements, element, childText, attr, text } from './xml-lite.js';

const TICKS_PER_QUARTER = 480;
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function num(str, fallback) {
  if (str === undefined || str === null || str === '') return fallback;
  const n = Number(str);
  return Number.isFinite(n) ? n : fallback;
}

function keyFromFifthsAndMode(fifths, modeRaw, warnings) {
  let mode = (modeRaw || 'major').toLowerCase();
  if (mode !== 'major' && mode !== 'minor') {
    if (mode === 'ionian') mode = 'major';
    else if (mode === 'aeolian') mode = 'minor';
    else { warnings.push(`key mode "${modeRaw}" is not major/minor; treated as major`); mode = 'major'; }
  }
  const tonic = (((7 * fifths + (mode === 'minor' ? 9 : 0)) % 12) + 12) % 12;
  return { tonic, mode };
}

function pitchToMidi(pitchNode) {
  const step = childText(pitchNode, 'step');
  const octave = num(childText(pitchNode, 'octave'), undefined);
  const alter = num(childText(pitchNode, 'alter'), 0);
  if (!(step in STEP_PC) || octave === undefined) return undefined;
  return (octave + 1) * 12 + STEP_PC[step] + alter;
}

export function importMusicXml(rawText) {
  if (typeof rawText !== 'string') throw new Error('importMusicXml: input must be a string');
  const trimmed = rawText.trimStart();
  if (trimmed.startsWith('PK\x03\x04') || (trimmed.charCodeAt(0) === 0x50 && trimmed.charCodeAt(1) === 0x4b)) {
    throw new Error('importMusicXml: compressed .mxl (zip) files are not supported yet; extract the uncompressed MusicXML entry first');
  }
  const root = parseXml(rawText);
  if (root.name === 'score-timewise') throw new Error('importMusicXml: score-timewise documents are not supported yet; only score-partwise is');
  if (root.name !== 'score-partwise') throw new Error(`importMusicXml: unrecognised root element <${root.name}>; expected <score-partwise>`);

  const warnings = [];
  const partNames = {};
  const partList = element(root, 'part-list');
  if (partList) {
    for (const sp of elements(partList, 'score-part')) {
      const id = attr(sp, 'id');
      if (id) partNames[id] = childText(sp, 'part-name') || id;
    }
  }

  const parts = [];
  let bpm;
  let key = null;
  let metre = { num: 4, den: 4 };

  for (const partNode of elements(root, 'part')) {
    const partId = attr(partNode, 'id', `part-${parts.length + 1}`);
    const notes = [];
    let divisions = 1;
    let transposeSemitones = 0; // chromatic + 12*octave-change, written->sounding
    const voiceCursor = new Map(); // voice id -> tick cursor
    let lastNoteStart = 0; // start tick for the current <chord/> group
    const openTies = new Map(); // midi -> note object awaiting a tie stop
    let measureStartTick = 0; // where a voice unseen this measure should begin
    const cursorFor = (voice) => {
      if (!voiceCursor.has(voice)) voiceCursor.set(voice, measureStartTick);
      return voiceCursor.get(voice);
    };

    for (const measure of elements(partNode, 'measure')) {
      measureStartTick = voiceCursor.size ? Math.max(...voiceCursor.values()) : 0;
      for (const child of measure.children) {
        if (child.type !== 'element') continue;

        if (child.name === 'attributes') {
          const divText = childText(child, 'divisions');
          if (divText !== undefined) divisions = num(divText, divisions);
          const keyNode = element(child, 'key');
          if (keyNode) key = keyFromFifthsAndMode(num(childText(keyNode, 'fifths'), 0), childText(keyNode, 'mode'), warnings);
          const timeNode = element(child, 'time');
          if (timeNode) metre = { num: num(childText(timeNode, 'beats'), metre.num), den: num(childText(timeNode, 'beat-type'), metre.den) };
          const transposeNode = element(child, 'transpose');
          if (transposeNode) transposeSemitones = num(childText(transposeNode, 'chromatic'), 0) + 12 * num(childText(transposeNode, 'octave-change'), 0);
          continue;
        }
        if (child.name === 'sound') {
          const tempo = attr(child, 'tempo');
          if (tempo !== undefined && bpm === undefined) bpm = num(tempo, undefined);
          continue;
        }
        if (child.name === 'backup' || child.name === 'forward') {
          const ticks = Math.round((num(childText(child, 'duration'), 0) * TICKS_PER_QUARTER) / divisions);
          const delta = child.name === 'backup' ? -ticks : ticks;
          for (const v of voiceCursor.keys()) voiceCursor.set(v, Math.max(0, voiceCursor.get(v) + delta));
          continue;
        }
        if (child.name === 'note') {
          const voice = childText(child, 'voice') || '1';
          const isChord = element(child, 'chord') !== undefined;
          const isRest = element(child, 'rest') !== undefined;
          if (element(child, 'grace') !== undefined) { warnings.push('grace note skipped (no sounding duration to place it)'); continue; }
          const dur = num(childText(child, 'duration'), undefined);
          if (dur === undefined) { warnings.push('note with no <duration> skipped'); continue; }
          const ticks = Math.round((dur * TICKS_PER_QUARTER) / divisions);
          const start = isChord ? lastNoteStart : cursorFor(voice);

          if (!isRest) {
            const pitchNode = element(child, 'pitch');
            let midi = pitchNode ? pitchToMidi(pitchNode) : undefined;
            if (midi === undefined) {
              warnings.push('unpitched note skipped');
            } else {
              midi += transposeSemitones;
              const noteObj = { start, dur: ticks, midi };
              const tieTypes = new Set(elements(child, 'tie').map((t) => attr(t, 'type')));
              if (tieTypes.has('stop')) {
                if (openTies.has(midi)) { noteObj.tieFromPrev = true; openTies.delete(midi); }
                else warnings.push('tie stop found with no matching tie start; ignored');
              }
              if (tieTypes.has('start')) openTies.set(midi, noteObj);
              notes.push(noteObj);
            }
          }
          if (!isChord) voiceCursor.set(voice, start + ticks);
          lastNoteStart = start;
        }
      }
    }

    if (voiceCursor.size > 1) warnings.push(`part "${partNames[partId] || partId}" has ${voiceCursor.size} voices; flattened into one`);
    notes.sort((a, b) => a.start - b.start);
    parts.push({ id: partId, name: partNames[partId] || partId, notes });
  }

  if (bpm === undefined) { bpm = 120; warnings.push('no tempo found; defaulted to 120 bpm'); }

  const workNode = element(root, 'work');
  const title = childText(root, 'movement-title') || (workNode ? childText(workNode, 'work-title') : undefined) || null;
  const identification = element(root, 'identification');
  const composerNode = identification ? elements(identification, 'creator').find((c) => attr(c, 'type') === 'composer') : undefined;
  const composer = composerNode ? text(composerNode) : null;
  const licence = identification ? (childText(identification, 'rights') ?? null) : null;

  const song = {
    schema: 'song/1',
    id: null,
    title,
    composer,
    licence,
    source: null,
    key,
    metre,
    bpm,
    ticksPerQuarter: TICKS_PER_QUARTER,
    parts,
    chords: [],
  };
  return { song, warnings };
}
