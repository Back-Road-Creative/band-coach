// MusicXML (score-partwise or score-timewise, plain text or compressed
// `.mxl` zip) -> the shared Song shape.
//
// Wiring: call `importMusicXml(input)` with either the raw text of a
// `.musicxml`/`.xml` file, or the raw bytes (ArrayBuffer/Uint8Array) of a
// `.mxl` file. `importMxl(bytes)` does the bytes path directly. Returns
// `{ song, warnings }` per the author brief's Song shape (schema 'song/1',
// ticksPerQuarter 480, notes sorted by `start`). `warnings` are short
// strings for a learner-facing toast/log, not exceptions. No I/O beyond
// unzipping — the caller reads the file.
//
// `.mxl` is a plain ZIP archive; the score inside is found via
// META-INF/container.xml's rootfile, falling back to the first non-META-INF
// .musicxml/.xml entry (see unzip-lite.js — its own DEFLATE decoder, no
// browser API dependency). `<score-timewise>` (measure-major layout) is
// transposed to the part-major `<score-partwise>` shape below before the
// rest of this file's parsing runs unchanged.

import { songIdentity } from './ident.js';
import { parseXml, elements, element, childText, attr, text } from './xml-lite.js';
import { readMxlRootEntry } from './unzip-lite.js';

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

// score-timewise nests parts inside measures (measure-major); this file's
// walk below expects score-partwise (part-major, measures inside parts).
// Rebuild the tree with that axis transposed rather than writing a second
// walk: same <part-list> and other top-level children, but each <measure>'s
// per-part <part> children are regrouped into one <part> per id holding all
// its measures, in <part-list> order (falling back to first-seen order for
// any part-list omits, which real scores don't).
function timewiseToPartwise(root) {
  const nonMeasureChildren = root.children.filter((c) => c.type === 'element' && c.name !== 'measure');
  const partsById = new Map(); // part id -> [measure element, ...]
  for (const measure of elements(root, 'measure')) {
    for (const partChild of elements(measure, 'part')) {
      const partId = attr(partChild, 'id', '');
      if (!partsById.has(partId)) partsById.set(partId, []);
      partsById.get(partId).push({ type: 'element', name: 'measure', attrs: measure.attrs, children: partChild.children });
    }
  }
  const partList = element(root, 'part-list');
  const order = partList ? elements(partList, 'score-part').map((sp) => attr(sp, 'id')).filter((id) => partsById.has(id)) : [];
  for (const id of partsById.keys()) if (!order.includes(id)) order.push(id);
  const partNodes = order.map((id) => ({ type: 'element', name: 'part', attrs: { id }, children: partsById.get(id) }));
  return { type: 'element', name: 'score-partwise', attrs: root.attrs, children: [...nonMeasureChildren, ...partNodes] };
}

function bytesFrom(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return undefined;
}

// Reads a `.mxl` (compressed) archive's bytes directly — this is what
// `importMusicXml` delegates to when given bytes instead of text, and what
// the import route calls when a `.mxl` file is read as an ArrayBuffer.
export function importMxl(bytes, options = {}) {
  const zipBytes = bytesFrom(bytes) ?? bytes;
  let rootEntry;
  try {
    rootEntry = readMxlRootEntry(zipBytes);
  } catch (e) {
    throw new Error(`importMxl: this .mxl file could not be read: ${e.message}`);
  }
  const xmlText = new TextDecoder('utf-8').decode(rootEntry.bytes);
  return importMusicXml(xmlText, options);
}

export function importMusicXml(rawText, options = {}) {
  const asBytes = typeof rawText === 'string' ? undefined : bytesFrom(rawText);
  if (asBytes !== undefined) return importMxl(asBytes, options);
  if (typeof rawText !== 'string') throw new Error('importMusicXml: input must be a string, or the bytes of a .mxl file (ArrayBuffer/Uint8Array)');
  const trimmed = rawText.trimStart();
  if (trimmed.startsWith('PK\x03\x04') || (trimmed.charCodeAt(0) === 0x50 && trimmed.charCodeAt(1) === 0x4b)) {
    // A .mxl's raw bytes stuffed into a JS string (one char per byte) — the
    // real import route passes an ArrayBuffer instead, but this path is
    // kept so any caller handing over binary-as-string still gets a real
    // attempt at reading it rather than a dead end.
    const bytes = Uint8Array.from(rawText, (ch) => ch.charCodeAt(0) & 0xff);
    return importMxl(bytes, options);
  }
  let root = parseXml(rawText);
  if (root.name === 'score-timewise') root = timewiseToPartwise(root);
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
  // `bpm`/`key`/`metre` track the CURRENT value while walking the score (so a
  // later value can be compared against it to detect a change); `initial*`
  // is frozen at the first sighting and is what the song's top-level
  // bpm/key/metre stays as — mid-song values only ever reach the change lists.
  let bpm;
  let initialBpm;
  let key = null;
  let initialKey = null;
  let keySet = false; // false until the first <key>: that one sets the initial key, not a change
  let metre = { num: 4, den: 4 };
  let initialMetre = metre;
  let metreSet = false; // false until the first <time>: that one sets the initial metre, not a change
  const tempoMap = []; // sorted-by-tick change lists (model.js shape); empty ones stay off the song
  const metreChanges = [];
  const keyChanges = [];

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
      // Where a <sound tempo> found mid-measure should land: the measure's
      // start until a note has been read, then that note's end (= the next
      // event's start) — the playhead position at the point the file states it.
      let tickCursor = measureStartTick;
      for (const child of measure.children) {
        if (child.type !== 'element') continue;

        if (child.name === 'attributes') {
          const divText = childText(child, 'divisions');
          if (divText !== undefined) divisions = num(divText, divisions);
          const keyNode = element(child, 'key');
          if (keyNode) {
            const newKey = keyFromFifthsAndMode(num(childText(keyNode, 'fifths'), 0), childText(keyNode, 'mode'), warnings);
            if (!keySet) { key = newKey; initialKey = newKey; keySet = true; }
            else if (newKey.tonic !== key.tonic || newKey.mode !== key.mode) { keyChanges.push({ tick: measureStartTick, ...newKey }); key = newKey; }
          }
          const timeNode = element(child, 'time');
          if (timeNode) {
            const newMetre = { num: num(childText(timeNode, 'beats'), metre.num), den: num(childText(timeNode, 'beat-type'), metre.den) };
            if (!metreSet) { metre = newMetre; initialMetre = newMetre; metreSet = true; }
            else if (newMetre.num !== metre.num || newMetre.den !== metre.den) { metreChanges.push({ tick: measureStartTick, ...newMetre }); metre = newMetre; }
          }
          const transposeNode = element(child, 'transpose');
          if (transposeNode) transposeSemitones = num(childText(transposeNode, 'chromatic'), 0) + 12 * num(childText(transposeNode, 'octave-change'), 0);
          continue;
        }
        if (child.name === 'sound' || child.name === 'direction') {
          // Real scores usually wrap <sound> in <direction><sound tempo="…"/></direction>;
          // the pending exporter also writes it as a direct child of <measure>.
          const soundNode = child.name === 'sound' ? child : element(child, 'sound');
          const tempoAttr = soundNode ? attr(soundNode, 'tempo') : undefined;
          if (tempoAttr !== undefined) {
            const newBpm = num(tempoAttr, undefined);
            if (newBpm !== undefined) {
              if (bpm === undefined) { bpm = newBpm; initialBpm = newBpm; }
              else if (newBpm !== bpm) { tempoMap.push({ tick: tickCursor, bpm: newBpm }); bpm = newBpm; }
            }
          }
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
          if (!isChord) { voiceCursor.set(voice, start + ticks); tickCursor = start + ticks; }
          lastNoteStart = start;
        }
      }
    }

    if (voiceCursor.size > 1) warnings.push(`part "${partNames[partId] || partId}" has ${voiceCursor.size} voices; flattened into one`);
    notes.sort((a, b) => a.start - b.start);
    parts.push({ id: partId, name: partNames[partId] || partId, notes });
  }

  if (initialBpm === undefined) { initialBpm = 120; warnings.push('no tempo found; defaulted to 120 bpm'); }

  const workNode = element(root, 'work');
  const title = childText(root, 'movement-title') || (workNode ? childText(workNode, 'work-title') : undefined) || null;
  const identification = element(root, 'identification');
  const composerNode = identification ? elements(identification, 'creator').find((c) => attr(c, 'type') === 'composer') : undefined;
  const composer = composerNode ? text(composerNode) : null;
  const licence = identification ? (childText(identification, 'rights') ?? null) : null;

  const song = {
    schema: 'song/1',
    ...songIdentity({ title, fileName: options.fileName, fallback: 'Imported score' }),
    composer,
    licence,
    source: null,
    key: initialKey,
    metre: initialMetre,
    bpm: initialBpm,
    ticksPerQuarter: TICKS_PER_QUARTER,
    parts,
    chords: [],
  };
  if (tempoMap.length) song.tempoMap = tempoMap;
  if (metreChanges.length) song.metreChanges = metreChanges;
  if (keyChanges.length) song.keyChanges = keyChanges;
  return { song, warnings };
}
