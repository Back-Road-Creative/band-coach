// ABC notation 2.1 -> the shared Song shape.
//
// Wiring: call `importAbc(text)` with raw ABC text. Returns `{ song,
// warnings }` per the author brief's Song shape (schema 'song/1',
// ticksPerQuarter 480, notes sorted by `start`). No I/O, no DOM/global.
// Each `V:` voice -- declared in the header (`V:id name=".." clef=..`)
// and/or switched to inline (`[V:id]`) or on its own body line (`V:id`) --
// becomes its own song part, in first-appearance order, each with its own
// time cursor and its own bar-scoped accidentals so one voice's
// naturals/sharps never bleed into another's. A tune with no `V:` fields
// at all imports exactly as a single part, as before. Chord symbols in
// quotes become `song.chords`. Grace notes and decorations are skipped
// with a warning, not guessed at.
//
// Real ABC files as found in the wild (abcnotation.com, Nottingham Music
// Database) hold several tunes per file, each starting a new `X:` block --
// `importAbc` reads only the first tune and warns about the rest, rather
// than silently running the next tune's header lines into the first
// tune's notes. `%`-comments (a whole comment line, or trailing text after
// a `%` on an otherwise-real line, including a `%%directive`) are stripped
// line-by-line, before lines are ever joined into one body string, so a
// comment's stray letters can never be misread as notes. A header field
// re-appearing on its own line mid-tune (`M:`, `L:`, `K:`, `Q:` -- ABC
// allows this without the `[...]` inline-bracket form) is recognised and
// consumed rather than falling through to the note tokenizer, where its
// letters could otherwise be misread as pitches (a bare mid-tune `K:D`
// line's `D` is a real note letter). A mid-tune `K:` actually changes the
// key-signature accidentals applied to subsequent notes (song.key itself
// still reports the tune's opening key); a mid-tune `M:`/`L:`/`Q:` is
// consumed and warned about but not applied -- the opening M:/L: values
// are used for the whole tune, matching the ABC default-unit-length rule.

import { songIdentity } from './ident.js';

const TICKS_PER_QUARTER = 480;
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Key-signature accidentals for a major key of `fifths` sharps(+)/flats(-),
// derived from the circle of fifths order rather than a typed table.
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };

function keySignatureAccidentals(fifths) {
  const acc = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) for (let i = 0; i < fifths; i += 1) acc[SHARP_ORDER[i]] = 1;
  else if (fifths < 0) { const flat = [...SHARP_ORDER].reverse(); for (let i = 0; i < -fifths; i += 1) acc[flat[i]] = -1; }
  return acc;
}

// A mode's fifths-distance from major (ionian=major=0; e.g. dorian=-2,
// mixolydian=-1, aeolian=minor=-3). Song only knows major/minor, so a modal
// key reports the relative major-or-minor object sharing its accidentals.
const MODE_FIFTHS_SHIFT = { major: 0, ionian: 0, mixolydian: -1, dorian: -2, minor: -3, aeolian: -3, phrygian: -4, lydian: 1, locrian: -5 };
const MINOR_FAMILY = new Set(['minor', 'aeolian', 'dorian', 'phrygian', 'locrian']);
const MODE_ABBREV = { maj: 'major', min: 'minor', ion: 'major', dor: 'dorian', phr: 'phrygian', lyd: 'lydian', mix: 'mixolydian', aeo: 'minor', loc: 'locrian', m: 'minor' };

function parseKeyField(raw, warnings) {
  const m = /^([A-Ga-g])([#b]?)\s*([A-Za-z]*)/.exec(raw.trim());
  if (!m) {
    warnings.push(`unrecognised K: field "${raw}"; defaulting to C major`);
    return { tonic: 0, mode: 'major' };
  }
  const letter = m[1].toUpperCase();
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const modeWord = (m[3] || 'major').toLowerCase();
  const normalized = MODE_ABBREV[modeWord.slice(0, 3)] || MODE_ABBREV[modeWord] || modeWord;
  const shift = MODE_FIFTHS_SHIFT[normalized];
  if (shift === undefined) warnings.push(`unrecognised mode "${m[3]}" in K: field; treated as major`);
  // Fifths of the notated tonic as if it were major, then shifted by the
  // mode to get the actual key signature's fifths.
  const tonicEntry = Object.entries(MAJOR_FIFTHS).find(([name]) => name[0] === letter && ((name.length === 1 && accidental === 0) || (name[1] === '#' && accidental === 1) || (name[1] === 'b' && accidental === -1)));
  const sigFifths = (tonicEntry ? tonicEntry[1] : 0) + (shift ?? 0);
  const mode = MINOR_FAMILY.has(normalized) ? 'minor' : 'major';
  const tonic = (((7 * sigFifths + (mode === 'minor' ? 9 : 0)) % 12) + 12) % 12;
  return { tonic, mode, sigFifths };
}

function defaultUnitLength(meterNum, meterDen) {
  // ABC rule: 1/8 by default, 1/16 when the meter's ratio is < 0.75.
  return meterNum / meterDen < 0.75 ? 1 / 16 : 1 / 8;
}

function parseMeter(raw) {
  const t = raw.trim();
  if (t === 'C') return { num: 4, den: 4 };
  if (t === 'C|') return { num: 2, den: 2 };
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  return m ? { num: Number(m[1]), den: Number(m[2]) } : { num: 4, den: 4 };
}

class TokenReader {
  constructor(body) { this.body = body; this.i = 0; }
  peek() { return this.body[this.i]; }
  atEnd() { return this.i >= this.body.length; }
}

export function importAbc(rawText, options = {}) {
  if (typeof rawText !== 'string') throw new Error('importAbc: input must be a string');
  const warnings = [];
  let title = null;
  let composer = null;
  let meter = { num: 4, den: 4 };
  let unitLength;
  let unitLengthExplicit = false;
  let tempo;
  let key = { tonic: 0, mode: 'major' };
  const bodyLines = [];
  let sawKey = false;

  // Voices: `voiceOrder` records each voice id in first-appearance order
  // (header declaration or first body/inline switch, whichever comes
  // first in the text); `voiceMeta[id].name` holds its `name=`/`nm=` label
  // if one was given. `VOICE_MARK`-wrapped ids are spliced into the body
  // text so the tokenizer can see a voice switch as an ordinary token,
  // interleaved with the notes around it.
  const voiceOrder = [];
  const voiceMeta = {};
  const VOICE_MARK = '\x01';
  const FIELD_MARK = '\x02';
  function registerVoice(id, name) {
    if (!(id in voiceMeta)) { voiceMeta[id] = { name }; voiceOrder.push(id); }
    else if (name) voiceMeta[id].name = name;
  }
  function parseVoiceField(value) {
    const m = /^(\S+)/.exec(value.trim());
    if (!m) return null;
    const rest = value.slice(m.index + m[0].length);
    const nm = /(?:name|nm)="([^"]*)"|(?:name|nm)=(\S+)/.exec(rest);
    return { id: m[1], name: nm ? (nm[1] ?? nm[2]) : undefined };
  }

  for (const rawLine of rawText.split(/\r\n|\r|\n/)) {
    // Strip a `%`-comment (a whole comment line, or trailing text after a
    // `%`, including a `%%directive`) before this line is ever joined with
    // its neighbours -- once lines are joined into one body string a
    // comment's `$`-anchored strip can no longer tell where a line ended,
    // and its stray letters (e.g. "% Nottingham" has a real note-letter
    // 'a') would otherwise reach the note tokenizer.
    const line = rawLine.replace(/%.*/, '');
    if (line.trim() === '') continue;
    const m = /^([A-Za-z]):\s?(.*)$/.exec(line);
    if (m && m[1] === 'V') {
      const voice = parseVoiceField(m[2]);
      if (voice) {
        registerVoice(voice.id, voice.name);
        if (sawKey) bodyLines.push(VOICE_MARK + voice.id + VOICE_MARK);
      }
      continue;
    }
    if (m && m[1] === 'X' && sawKey) {
      // A second `X:` header starts a new tune. Real ABC files (the
      // Nottingham Music Database, abcnotation.com collections) hold many
      // tunes per file; importAbc reads only the first and says so, rather
      // than running the next tune's header lines into this one's notes.
      warnings.push('this file holds more than one tune (a later X: field was found); only the first tune was imported');
      break;
    }
    if (m && !sawKey) {
      const [, field, value] = m;
      if (field === 'T') title = title === null ? value.trim() : `${title} ${value.trim()}`;
      else if (field === 'C') composer = value.trim();
      else if (field === 'M') meter = parseMeter(value);
      else if (field === 'L') {
        const lm = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
        if (lm) { unitLength = Number(lm[1]) / Number(lm[2]); unitLengthExplicit = true; }
        else warnings.push(`unrecognised L: field "${value}"; using the meter-based default`);
      } else if (field === 'Q') {
        const qm = /(\d+)\s*$/.exec(value.trim());
        if (qm) tempo = Number(qm[1]);
      } else if (field === 'K') {
        key = parseKeyField(value, warnings);
        sawKey = true;
      }
      // Other header fields (A,B,D,F,G,H,I,N,O,P,R,S,U,W,Z, X) carry no
      // data the Song shape represents; ignored on purpose.
      continue;
    }
    if (m && sawKey && 'MLKQ'.includes(m[1])) {
      // A header field re-appearing on its own line mid-tune (ABC allows
      // this without the `[...]` inline-bracket form -- e.g. a plain
      // "K:D" line partway through a tune, seen in real Nottingham Music
      // Database files). Splice in a field marker the tokenizer turns into
      // a 'fieldChange' token at the right point in the note stream, so
      // its letters are never misread as notes/endings (a bare "K:D"
      // line's "D" is a real note letter).
      bodyLines.push(FIELD_MARK + m[1] + m[2].trim() + FIELD_MARK);
      continue;
    }
    if (m) continue; // other header fields mid-tune (P, T, C, ...): no data the Song shape represents; ignored, same as in the header.
    // An inline `[V:id]` switch can appear mid-line, amongst notes; splice
    // in the same voice marker the tokenizer looks for, registering the
    // voice at its first appearance if this is the first time it's named.
    bodyLines.push(line.replace(/\[V:(\S+?)\]/g, (_, id) => { registerVoice(id); return VOICE_MARK + id + VOICE_MARK; }));
  }

  if (!unitLengthExplicit) unitLength = defaultUnitLength(meter.num, meter.den);

  // One state bucket per voice: each voice gets its own time cursor and its
  // own bar-scoped accidentals/ties/tuplet-in-progress, so switching voices
  // never lets one voice's notation state bleed into another's. A tune with
  // no `V:` fields at all never switches voice, so it plays out exactly as
  // the single default-voice tune it always was.
  const DEFAULT_VOICE = '\x00default';
  const voiceStates = new Map();
  function voiceState(id) {
    if (!voiceStates.has(id)) voiceStates.set(id, { notes: [], tick: 0, barAccidentals: {}, pendingTieMidi: null, tupletRemaining: 0, tupletFactor: 1 });
    return voiceStates.get(id);
  }
  let currentVoiceId = voiceOrder.length ? voiceOrder[0] : DEFAULT_VOICE;
  const chords = [];
  // Mutable: a mid-tune `K:` field (see FIELD_MARK above) reassigns this so
  // later notes pick up the new key's accidentals; `song.key` itself still
  // reports the tune's opening key, computed from `key` above.
  let currentKeySigAcc = keySignatureAccidentals(key.sigFifths ?? 0);
  const bodyText = bodyLines.join(' ');
  const expanded = expandRepeats(tokenizeAbcBody(bodyText, warnings));

  for (const tok of expanded) {
    if (tok.type === 'voiceSwitch') { currentVoiceId = tok.id; continue; }
    if (tok.type === 'fieldChange') {
      if (tok.field === 'K') currentKeySigAcc = keySignatureAccidentals(parseKeyField(tok.value, warnings).sigFifths ?? 0);
      else warnings.push(`mid-tune ${tok.field}: field ("${tok.value}") is not applied; the tune's opening M:/L: values are used throughout`);
      continue;
    }
    const vs = voiceState(currentVoiceId);
    if (tok.type === 'barline') { vs.barAccidentals = {}; continue; }
    if (tok.type === 'tuplet') { vs.tupletRemaining = tok.n; vs.tupletFactor = 2 / tok.n; continue; }
    if (tok.type === 'chordSymbol') { chords.push({ start: vs.tick, symbol: tok.text }); continue; }
    if (tok.type === 'graceOrDecoration') { warnings.push(`${tok.kind} skipped: "${tok.text}"`); continue; }
    const factor = vs.tupletRemaining > 0 ? vs.tupletFactor : 1;
    if (vs.tupletRemaining > 0) vs.tupletRemaining -= 1;
    const durTicks = Math.round(tok.lengthFrac * unitLength * 4 * TICKS_PER_QUARTER * factor);
    if (tok.type === 'rest') { vs.tick += durTicks; continue; }
    if (tok.type === 'note') {
      const stepLetter = tok.letter.toUpperCase();
      const octave = (tok.letter === stepLetter ? 4 : 5) + tok.octaveMarks;
      const accKey = stepLetter + octave;
      let semitone;
      if (tok.explicitAccidental !== undefined) {
        semitone = tok.explicitAccidental;
        vs.barAccidentals[accKey] = semitone;
      } else {
        semitone = accKey in vs.barAccidentals ? vs.barAccidentals[accKey] : currentKeySigAcc[stepLetter] || 0;
      }
      const midi = (octave + 1) * 12 + STEP_PC[stepLetter] + semitone;
      const noteObj = { start: vs.tick, dur: durTicks, midi };
      if (vs.pendingTieMidi === midi) noteObj.tieFromPrev = true;
      vs.pendingTieMidi = tok.tie ? midi : null;
      vs.notes.push(noteObj);
      vs.tick += durTicks;
    }
  }

  const parts = voiceOrder.length
    ? voiceOrder.map((id) => {
        const vs = voiceState(id);
        vs.notes.sort((a, b) => a.start - b.start);
        return { id: `abc-${id}`, name: (voiceMeta[id] && voiceMeta[id].name) || id, notes: vs.notes };
      })
    : (() => { const vs = voiceState(DEFAULT_VOICE); vs.notes.sort((a, b) => a.start - b.start); return [{ id: 'abc-1', name: title || 'Tune', notes: vs.notes }]; })();
  if (tempo === undefined) warnings.push('no Q: tempo found; defaulted to 120 bpm');

  const song = {
    schema: 'song/1',
    ...songIdentity({ title, fileName: options.fileName, fallback: 'Imported tune' }),
    composer,
    licence: null,
    source: null,
    key: { tonic: key.tonic, mode: key.mode },
    metre: meter,
    bpm: tempo ?? 120,
    ticksPerQuarter: TICKS_PER_QUARTER,
    parts,
    chords,
  };
  return { song, warnings };
}

// --- tokenizer -------------------------------------------------------

function readLength(body, i) {
  // ABC length suffix: an integer multiplier, `/` divisor(s) (`//` = /4),
  // or `num/den` — a fraction of the tune's unit note length.
  const m = /^(\d*)(\/*)(\d*)/.exec(body.slice(i));
  if (!m || (m[1] === '' && m[2] === '' && m[3] === '')) return { frac: 1, consumed: 0 };
  const [whole, numStr, slashes, denStr] = m;
  let frac = numStr === '' ? 1 : Number(numStr);
  if (slashes !== '') frac = denStr !== '' ? frac / Number(denStr) : frac / Math.pow(2, slashes.length);
  return { frac, consumed: whole.length };
}

function tokenizeAbcBody(bodyText, warnings) {
  const tokens = [];
  const r = new TokenReader(bodyText.replace(/%.*$/gm, ''));
  while (!r.atEnd()) {
    const ch = r.peek();
    if (/\s/.test(ch)) { r.i += 1; continue; }

    if (ch === '\x01') {
      const end = r.body.indexOf('\x01', r.i + 1);
      tokens.push({ type: 'voiceSwitch', id: r.body.slice(r.i + 1, end) });
      r.i = end + 1;
      continue;
    }
    if (ch === '\x02') {
      const end = r.body.indexOf('\x02', r.i + 1);
      const raw = r.body.slice(r.i + 1, end);
      tokens.push({ type: 'fieldChange', field: raw[0], value: raw.slice(1) });
      r.i = end + 1;
      continue;
    }
    if (ch === '"') {
      const end = r.body.indexOf('"', r.i + 1);
      if (end === -1) { warnings.push('unterminated chord symbol; ignored'); break; }
      tokens.push({ type: 'chordSymbol', text: r.body.slice(r.i + 1, end) });
      r.i = end + 1;
      continue;
    }
    if (ch === '!') {
      const end = r.body.indexOf('!', r.i + 1);
      if (end === -1) { r.i += 1; continue; }
      tokens.push({ type: 'graceOrDecoration', kind: 'decoration', text: r.body.slice(r.i, end + 1) });
      r.i = end + 1;
      continue;
    }
    if (ch === '{') {
      const end = r.body.indexOf('}', r.i + 1);
      tokens.push({ type: 'graceOrDecoration', kind: 'grace note', text: end === -1 ? r.body.slice(r.i) : r.body.slice(r.i, end + 1) });
      r.i = end === -1 ? r.body.length : end + 1;
      continue;
    }
    if ('.~HLMOPSTuv'.includes(ch) && /[A-Gaz]/.test(r.body[r.i + 1] || '')) {
      tokens.push({ type: 'graceOrDecoration', kind: 'decoration', text: ch });
      r.i += 1;
      continue;
    }
    if (ch === '(' && /\d/.test(r.body[r.i + 1] || '')) {
      // `(3`, `(2`... approximated as n-in-the-time-of-2 (scale next n by 2/n).
      const m = /^\((\d)/.exec(r.body.slice(r.i));
      tokens.push({ type: 'tuplet', n: Number(m[1]) });
      r.i += m[0].length;
      continue;
    }
    if (ch === '|' || ch === ':') {
      const m = /^(\|:|:\|\||:\||::|\|\]|\[\||\|\||\|)/.exec(r.body.slice(r.i));
      if (m) { tokens.push({ type: 'barline', text: m[0] }); r.i += m[0].length; continue; }
    }
    if (ch === '[' && /\d/.test(r.body[r.i + 1] || '')) {
      const m = /^\[(\d)/.exec(r.body.slice(r.i));
      tokens.push({ type: 'ending', n: Number(m[1]) });
      r.i += m[0].length;
      continue;
    }
    if (/\d/.test(ch) && tokens.length && tokens[tokens.length - 1].type === 'barline') {
      tokens.push({ type: 'ending', n: Number(ch) });
      r.i += 1;
      continue;
    }
    if (ch === 'z' || ch === 'Z' || ch === 'x') {
      r.i += 1;
      const { frac, consumed } = readLength(r.body, r.i);
      r.i += consumed;
      tokens.push({ type: 'rest', lengthFrac: frac });
      continue;
    }
    if (/[A-Ga-g]/.test(ch) || ch === '^' || ch === '_' || ch === '=') {
      let explicitAccidental;
      if (ch === '^' || ch === '_' || ch === '=') {
        let acc = '';
        while (r.body[r.i] === '^' || r.body[r.i] === '_' || r.body[r.i] === '=') { acc += r.body[r.i]; r.i += 1; }
        explicitAccidental = { '^': 1, '^^': 2, '_': -1, '__': -2, '=': 0 }[acc] ?? 0;
      }
      const letter = r.body[r.i];
      if (!/[A-Ga-g]/.test(letter || '')) { warnings.push(`accidental with no following note near position ${r.i}; ignored`); continue; }
      r.i += 1;
      let octaveMarks = 0;
      while (r.body[r.i] === "'" || r.body[r.i] === ',') { octaveMarks += r.body[r.i] === "'" ? 1 : -1; r.i += 1; }
      const { frac, consumed } = readLength(r.body, r.i);
      r.i += consumed;
      let tie = false;
      if (r.body[r.i] === '-') { tie = true; r.i += 1; }
      tokens.push({ type: 'note', letter, octaveMarks, explicitAccidental, lengthFrac: frac, tie });
      continue;
    }
    r.i += 1; // unknown character: skip silently (formatting, line breaks, ...)
  }
  return tokens;
}

function expandRepeats(tokens) {
  // Cut into "chunks" at every barline, each carrying the ending number
  // active when it started ([1/[2) and the barline text that closed it.
  const chunks = [];
  let buf = [];
  let activeEnding = null;
  for (const tok of tokens) {
    if (tok.type === 'ending') { activeEnding = tok.n; continue; }
    if (tok.type === 'barline') {
      chunks.push({ content: buf, closeText: tok.text, endingNumber: activeEnding });
      buf = [];
      if (tok.text.includes(':')) activeEnding = null; // a repeat sign ends any ending's scope
      continue;
    }
    buf.push(tok);
  }
  if (buf.length) chunks.push({ content: buf, closeText: null, endingNumber: activeEnding });

  // Group chunks between repeat signs and expand first/second endings. A
  // plain barline inside a group is kept so bar-scoped accidentals reset.
  const out = [];
  const isRepeatClose = (t) => t === ':|' || t === ':|||' || t === ':||' || t === '::';
  const isRepeatOpen = (t) => t === '|:' || t === '::';
  const emit = (chunk) => { out.push(...chunk.content, { type: 'barline', text: '|' }); };

  let groupStart = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const closeText = chunks[i].closeText;
    if (isRepeatClose(closeText)) {
      const group = chunks.slice(groupStart, i + 1);
      group.filter((c) => c.endingNumber !== 2).forEach(emit);
      group.filter((c) => c.endingNumber !== 1).forEach(emit);
      groupStart = i + 1;
    } else if (isRepeatOpen(closeText) && i >= groupStart) {
      chunks.slice(groupStart, i + 1).forEach(emit);
      groupStart = i + 1;
    }
  }
  chunks.slice(groupStart).forEach(emit);
  return out;
}
