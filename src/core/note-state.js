// Held-note bookkeeping for real note input (MIDI and computer keys), kept
// separate from the byte parser (src/core/midi.js) and the DOM/AudioContext
// wiring (src/app.js) because "which pitches are down right now" is state a
// caller owns across many messages, not a single message's shape.
//
// Bug this exists to fix: src/app.js used to track held MIDI notes in one
// `realMidiHeld = new Set()` keyed by pitch alone. Two keyboards (or one
// multi-port device presenting the same channel twice) holding the same
// pitch collided: a note-off from EITHER port cleared the pitch for BOTH,
// so hands-together grading (which reads "is this pitch still held") saw a
// note release early or never see one at all. Keying by port+channel+pitch
// makes each physical key-down its own fact, so one port's note-off can
// never cancel another port's hold on the same pitch.
//
// No DOM, no AudioContext, no navigator.* -- the caller (app.js) owns the
// real MIDIInput objects, window/document listeners and the clock; this
// module only ever sees the (port, channel, pitch) triples it is handed.

// channel+pitch are both small integers, safe to fold into one string key;
// port is NOT -- a real caller (app.js) hands this a live MIDIInput object,
// and two different objects both stringify to the same "[object Object]",
// which silently reunited every port into one the first time this used
// string concatenation on port too. Ports are instead a Map's own top-level
// keys, which compare by reference for an object and by value for a string
// (a test's plain 'p1'/'p2' id) -- either way, two different ports never
// collide.
function channelPitchKey(channel, pitch) {
  return channel + '\u0000' + pitch;
}

export function createNoteState() {
  // ports: port -> Map(channelPitchKey -> pitch)
  const ports = new Map();

  function noteOn(port, channel, pitch) {
    let byChannel = ports.get(port);
    if (!byChannel) { byChannel = new Map(); ports.set(port, byChannel); }
    byChannel.set(channelPitchKey(channel, pitch), pitch);
  }

  function noteOff(port, channel, pitch) {
    const byChannel = ports.get(port); if (!byChannel) return;
    byChannel.delete(channelPitchKey(channel, pitch));
    if (!byChannel.size) ports.delete(port);
  }

  // isHeld(pitch): true if ANY port/channel is currently holding that pitch
  // -- this is the question hands-together grading and the "MIDI details"
  // readout actually ask; which port supplied it is not their concern.
  function isHeld(pitch) {
    for (const byChannel of ports.values()) for (const p of byChannel.values()) if (p === pitch) return true;
    return false;
  }

  function heldPitches() {
    const out = [];
    for (const byChannel of ports.values()) for (const p of byChannel.values()) if (out.indexOf(p) === -1) out.push(p);
    return out;
  }

  // releaseAll(port?): with no argument, clears every held note (window
  // blur, tab hidden); with a port, clears only that port's notes (the port
  // was unplugged or its onstatechange re-listed it as gone). Returns the
  // list of pitches actually released -- a keyup or an unplug uses this to
  // know which onNote(pitch, false) calls to make, without guessing.
  function releaseAll(port) {
    const released = [];
    if (port !== undefined) {
      const byChannel = ports.get(port); if (!byChannel) return released;
      byChannel.forEach(p => released.push(p));
      ports.delete(port);
      return released;
    }
    ports.forEach(byChannel => byChannel.forEach(p => released.push(p)));
    ports.clear();
    return released;
  }

  function clear() {
    ports.clear();
  }

  return { noteOn: noteOn, noteOff: noteOff, isHeld: isHeld, heldPitches: heldPitches, releaseAll: releaseAll, clear: clear };
}
