// Standard MIDI File (SMF) writer — pure module, no DOM, no Node built-ins.
// The mirror image of import-midi.js: turns a shared Song (schema 'song/1',
// see the shared Song shape in .data/handoff/band-coach-author-brief.md)
// into the raw bytes of a type-1 .mid file.
//
// Wiring-pass API:
//   import { exportMidi } from './export-midi.js';
//   const bytes = exportMidi(song); // Uint8Array
//
// Layout: track 0 is a conductor track carrying tempo (song.tempoMap if
// present, else a single event from song.bpm), time signature (from
// song.metreChanges if present, else a single event from song.metre) and
// key signature (from song.keyChanges if present, else one event from
// song.key when it is not null). One further track per song.parts entry,
// each carrying a track-name meta event followed by that part's notes as
// paired note-on/note-off events. Division is always TICKS_PER_QUARTER
// (480) since that is what every Song already uses internally — no
// rescaling is needed going out, unlike import-midi.js coming in.
//
// Deterministic: for the same Song this always produces byte-identical
// output (event ordering is fully specified below, never insertion order
// off an unordered structure).

import { TICKS_PER_QUARTER } from './model.js';
import { canonicalMidi } from '../instruments/drum-kit.js';
import { songTempoEntries } from './clock.js';

const DEFAULT_VELOCITY = 80;

// Circle-of-fifths, major reference: given a major tonic 0-11, the unique
// key-signature accidental count (sharps positive, flats negative, range
// -5..6) whose 12 values are the exact inverse of import-midi's
// keyFromSignature(sf, 0) formula (majorTonic = 7*sf mod 12).
const MAJOR_SHARPS_FLATS_BY_TONIC = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

function sharpsFlatsForKey(key) {
  // A minor key's tonic sits a minor third (3 semitones) above its
  // relative major's tonic (mirrors keyFromSignature's "+9" the other way).
  const majorTonic = key.mode === 'minor' ? (key.tonic + 3) % 12 : key.tonic;
  return MAJOR_SHARPS_FLATS_BY_TONIC[majorTonic];
}

function signedByte(n) {
  return n < 0 ? n + 256 : n;
}

// --- variable-length quantity + byte-array helpers --------------------

function vlq(value) {
  let buffer = value & 0x7f;
  let v = value >>> 7;
  const bytes = [];
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(buffer);
  return bytes;
}

function u16(n) {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function textBytes(s) {
  return Array.from(new TextEncoder().encode(s));
}

function chunk(type, bytes) {
  return [...textBytes(type), ...u32(bytes.length), ...bytes];
}

// Turns a sorted-by-tick list of `{ tick, bytes }` events into a track's
// body, converting absolute ticks to deltas and appending end-of-track.
function trackBody(events) {
  const body = [];
  let prevTick = 0;
  for (const event of events) {
    body.push(...vlq(event.tick - prevTick), ...event.bytes);
    prevTick = event.tick;
  }
  body.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track
  return body;
}

// --- track 0: tempo / time signature / key signature -------------------

function tempoEvents(song) {
  const entries = songTempoEntries(song);
  return entries.map((entry) => {
    const microsPerQuarter = Math.round(60000000 / entry.bpm);
    return { tick: entry.tick, bytes: [0xff, 0x51, 0x03, ...u32(microsPerQuarter).slice(1)] };
  });
}

function timeSignatureEvents(song) {
  const entries =
    song.metreChanges && song.metreChanges.length > 0 ? song.metreChanges : [{ tick: 0, num: song.metre.num, den: song.metre.den }];
  return entries.map((entry) => ({
    tick: entry.tick,
    bytes: [0xff, 0x58, 0x04, entry.num, Math.round(Math.log2(entry.den)), 24, 8],
  }));
}

function keySignatureEvents(song) {
  const entries = song.keyChanges && song.keyChanges.length > 0 ? song.keyChanges : song.key ? [{ tick: 0, ...song.key }] : [];
  return entries.map((entry) => ({
    tick: entry.tick,
    bytes: [0xff, 0x59, 0x02, signedByte(sharpsFlatsForKey(entry)), entry.mode === 'minor' ? 1 : 0],
  }));
}

function conductorTrackEvents(song) {
  // Deterministic tie-break at equal ticks: tempo, then time signature,
  // then key signature, each internally already in tick order.
  const tagged = [
    ...tempoEvents(song).map((e) => ({ ...e, kind: 0 })),
    ...timeSignatureEvents(song).map((e) => ({ ...e, kind: 1 })),
    ...keySignatureEvents(song).map((e) => ({ ...e, kind: 2 })),
  ];
  tagged.sort((a, b) => a.tick - b.tick || a.kind - b.kind);
  return tagged.map(({ tick, bytes }) => ({ tick, bytes }));
}

// --- per-part note track ------------------------------------------------

// A percussion part (role 'percussion', see import-midi.js) writes to
// channel 10 (0-based index 9: status 0x99 note-on / 0x89 note-off, the GM
// convention every synth reads as "unpitched kit", not "pitched instrument
// 10") instead of channel 1. Every other part is unaffected.
function partTrackEvents(part) {
  const percussion = part.role === 'percussion';
  const noteOnStatus = percussion ? 0x99 : 0x90;
  const noteOffStatus = percussion ? 0x89 : 0x80;
  const events = [{ tick: 0, bytes: [0xff, 0x03, ...vlq(textBytes(part.name || '').length), ...textBytes(part.name || '')] }];
  for (const note of part.notes) {
    const velocity = Number.isInteger(note.velocity) ? note.velocity : DEFAULT_VELOCITY;
    // A hand-authored/edited percussion note can carry `piece` with no
    // `midi` of its own; canonicalMidi falls back to that piece's own
    // sounding note. A normal note (validated by model.js) always has
    // `midi`, so this fallback never fires for anything import-midi.js
    // itself produced.
    const midi = Number.isInteger(note.midi) ? note.midi : canonicalMidi(note.piece);
    events.push({ tick: note.start, kind: 0, bytes: [noteOnStatus, midi, velocity] });
    events.push({ tick: note.start + note.dur, kind: -1, bytes: [noteOffStatus, midi, 0] });
  }
  // Note-off events sort before note-on events at the same tick so a note
  // that ends exactly when the next one starts is fully closed first.
  const noteEvents = events.slice(1);
  noteEvents.sort((a, b) => a.tick - b.tick || (a.kind ?? 0) - (b.kind ?? 0));
  return [events[0], ...noteEvents];
}

export function exportMidi(song) {
  const tracks = [conductorTrackEvents(song), ...song.parts.map(partTrackEvents)];
  const header = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(TICKS_PER_QUARTER)]);
  const trackChunks = tracks.map((events) => chunk('MTrk', trackBody(events)));
  return new Uint8Array([...header, ...trackChunks.flat()]);
}
