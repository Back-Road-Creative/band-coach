// Pure MIDI byte-stream parsing and generation: turns the raw Uint8Array
// messages a real MIDIInput.onmidimessage delivers into note events, turns a
// live MIDIAccess.inputs/outputs map into a plain-language summary, and turns
// a Song part (src/song/model.js) into a timed list of MIDI-out messages for
// "play it for me". No DOM, no Web MIDI, no AudioContext, no randomness --
// app.js owns wiring this to navigator.requestMIDIAccess and to a real clock.
//
// Bug this exists to fix: app.js used to hand-roll `(d[0] & 0xf0) === 0x90 &&
// d[2] > 0` inline and had no note-off handling at all (no 0x80 anywhere in
// the file). A keyboard that sends running status (repeats of the same
// message drop the leading status byte -- most hardware does this for fast
// passages) was silently dropped: every note after the first on a run looked
// like garbage bytes with no status nibble to test.

import { ticksToSeconds } from '../song/model.js';

const NOTE_ON = 0x90, NOTE_OFF = 0x80, CONTROL_CHANGE = 0xb0, ALL_NOTES_OFF_CC = 123;

function clampByte(x) { return Math.min(127, Math.max(0, Math.round(x))); }

// One parser per input port: running status is per-port state, so two
// keyboards plugged in at once must never share one of these.
export function createMidiParser() {
  let runningStatus = null;
  function feed(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
    const events = [];
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      if (b >= 0xf0) { i++; continue; } // realtime/system bytes carry no channel-voice data and never touch running status
      let status, d1, d2, consumed;
      if (b & 0x80) { status = b; d1 = bytes[i + 1]; d2 = bytes[i + 2]; consumed = 3; }
      else { status = runningStatus; d1 = b; d2 = bytes[i + 1]; consumed = 2; } // running status: this byte and the next are data only
      if (status == null || d1 === undefined) break; // truncated message -- nothing more to parse
      runningStatus = status;
      const type = status & 0xf0, channel = status & 0x0f;
      if (type === NOTE_ON || type === NOTE_OFF) events.push({ type: type === NOTE_ON && d2 > 0 ? 'on' : 'off', note: d1, velocity: d2 || 0, channel: channel });
      i += consumed;
    }
    return events;
  }
  return { feed: feed };
}

// A plain-language summary of a live MIDIAccess.inputs map (or any array of
// {id, name, state, connection} port-like objects), for status text and the
// "MIDI details" readout -- see src/app.js ioRefresh()/renderMidiDetails().
export function describeInputs(inputs) {
  const list = [];
  if (inputs && typeof inputs.forEach === 'function') inputs.forEach(p => list.push(p));
  else if (Array.isArray(inputs)) list.push.apply(list, inputs);
  const connected = list.filter(p => p.state === 'connected');
  return { total: list.length, connected: connected, names: connected.map(p => p.name || 'MIDI device') };
}

// Same summary as describeInputs but for a live MIDIAccess.outputs map (or
// any array of port-like objects) -- the "play it for me" feature picks a
// keyboard to send notes to from this list.
export function describeOutputs(outputs) {
  const list = [];
  if (outputs && typeof outputs.forEach === 'function') outputs.forEach(p => list.push(p));
  else if (Array.isArray(outputs)) list.push.apply(list, outputs);
  const connected = list.filter(p => p.state === 'connected');
  return { total: list.length, connected: connected, names: connected.map(p => p.name || 'MIDI device') };
}

// Turns one part of a Song (see src/song/model.js) into a flat, time-sorted
// list of MIDI messages ready to hand to playOnOutput -- app.js owns picking
// the output port and the wall-clock anchor (startMs, e.g. audioCtx.currentTime
// converted to ms) that startMs is relative to. Pure: no clock reads, no I/O.
//
// `transpose` (semitones) is a scheduling-time shift independent of
// src/song/model.js's transpose(song, semitones), which returns a whole new
// Song -- this one only affects the bytes sent here.
//
// Overlapping same-pitch notes (a held note that hasn't ended before the
// next one for the same pitch starts -- can happen after model.transpose or
// in hand-authored songs) would otherwise leave two note-ons in flight for
// one key with only one note-off landing after the wrong one: the earlier
// note's off is pulled in to fire at the new note's on time, never later.
export function scheduleSong(song, opts) {
  const o = opts || {};
  const partIndex = o.partIndex || 0;
  const part = song.parts[partIndex];
  if (!part) throw new Error('scheduleSong: no part at index ' + partIndex + ' (song has ' + song.parts.length + ' part' + (song.parts.length === 1 ? '' : 's') + ')');
  const bpm = o.bpm;
  const startMs = o.startMs || 0;
  const channel = (o.channel || 0) & 0x0f;
  const semitones = o.transpose || 0;
  const notes = part.notes.slice().sort((a, b) => a.start - b.start);
  const events = []; // richer than the returned shape while we resolve overlaps
  const openOffByPitch = new Map(); // pitch -> the pending off event object for a note still sounding
  for (const note of notes) {
    if (note.midi === null || note.midi === undefined || !Number.isFinite(note.midi) || note.dur <= 0) continue; // a rest -- nothing to play
    const pitch = clampByte(note.midi + semitones);
    const velocity = Number.isFinite(note.velocity) ? clampByte(note.velocity) : 80;
    const onMs = startMs + ticksToSeconds(note.start, bpm) * 1000;
    const offMs = startMs + ticksToSeconds(note.start + note.dur, bpm) * 1000;
    const stillOpen = openOffByPitch.get(pitch);
    if (stillOpen && stillOpen.atMs > onMs) stillOpen.atMs = onMs; // cut the earlier note short instead of letting it outlive the new one
    const onEvent = { atMs: onMs, bytes: [NOTE_ON | channel, pitch, velocity], order: 1 };
    const offEvent = { atMs: offMs, bytes: [NOTE_OFF | channel, pitch, 0], order: 0 }; // order 0: an off at the same timestamp as an on always goes first
    events.push(onEvent, offEvent);
    openOffByPitch.set(pitch, offEvent);
  }
  events.sort((a, b) => a.atMs - b.atMs || a.order - b.order);
  return events.map(e => ({ atMs: e.atMs, bytes: e.bytes }));
}

// Sends every scheduled message to a real (or fake, in tests) MIDIOutput via
// its timestamped send(bytes, atMs) -- the caller owns the clock these
// timestamps are relative to (see scheduleSong's startMs).
export function playOnOutput(output, messages) {
  (messages || []).forEach(m => output.send(m.bytes, m.atMs));
}

// Silences a channel immediately: an All Notes Off controller message (CC
// 123), which most synths honour, plus an explicit note-off for every one of
// the 128 MIDI notes as a fallback for the ones that don't -- there is no
// runtime note-tracking state here (this module is pure), so "every note
// still sounding" is covered by sending for every note that could be, rather
// than trying to remember which ones actually are.
export function stopAll(output, channel) {
  const ch = (channel || 0) & 0x0f;
  output.send([CONTROL_CHANGE | ch, ALL_NOTES_OFF_CC, 0]);
  for (let note = 0; note < 128; note++) output.send([NOTE_OFF | ch, note, 0]);
}
