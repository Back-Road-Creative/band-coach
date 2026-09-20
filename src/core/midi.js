// Pure MIDI byte-stream parsing: turns the raw Uint8Array messages a real
// MIDIInput.onmidimessage delivers into note events, and turns a live
// MIDIAccess.inputs map into a plain-language summary. No DOM, no Web MIDI,
// no randomness -- app.js owns wiring this to navigator.requestMIDIAccess.
//
// Bug this exists to fix: app.js used to hand-roll `(d[0] & 0xf0) === 0x90 &&
// d[2] > 0` inline and had no note-off handling at all (no 0x80 anywhere in
// the file). A keyboard that sends running status (repeats of the same
// message drop the leading status byte -- most hardware does this for fast
// passages) was silently dropped: every note after the first on a run looked
// like garbage bytes with no status nibble to test.

const NOTE_ON = 0x90, NOTE_OFF = 0x80;

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
