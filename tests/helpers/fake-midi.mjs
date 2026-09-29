// A fake navigator.requestMIDIAccess, installed before the app's own script
// runs (see tests/helpers/browser.mjs launchPage()'s `initScript`, and
// tests/characterization/a11y-wake-lock.test.mjs for the pattern this
// borrows). It mirrors the real Web MIDI shape closely enough that
// src/app.js's real `ioBtn` click handler (src/app.js:1114+) can be
// exercised end to end, rather than only through the debug hook.
//
// Page-side handles a test drives through the exported helper functions
// below (each just wraps a `page.evaluate` call):
//   window.__midiAddPort(id, name, state)   -- add a port; fires onstatechange on the access object
//   window.__midiRemovePort(id)             -- mark a port disconnected and drop it; fires onstatechange
//   window.__midiSend(id, bytes)            -- deliver a raw message (plain array of byte numbers) on a port
//   window.__midiSetOpenResult(id, ok)      -- make that port's input.open() resolve (true) or reject (false)
//   window.__midiReject()                   -- makes the NEXT requestMIDIAccess() call reject (permission denied)
//   window.__midiAddOutput(id, name)        -- add an output port (MIDIOutput shape); its send(bytes, atMs) is recorded
//   window.__midiOutSent                    -- every {id, bytes, atMs} any output was sent, in call order
//   window.__midiMakeUnavailable()          -- deletes navigator.requestMIDIAccess entirely (no Web MIDI at all)
export const FAKE_MIDI_INIT = `
  window.__midiPorts = new Map();
  window.__midiOpenResults = new Map();
  window.__midiAccessListeners = [];
  window.__midiRejectNext = false;

  function __midiMakeInput(id, name, state) {
    return {
      id: id, name: name, manufacturer: 'Fake Instruments', type: 'input',
      state: state || 'connected', connection: 'closed',
      onmidimessage: null,
      open: function () {
        const self = this;
        const ok = window.__midiOpenResults.has(id) ? window.__midiOpenResults.get(id) : true;
        return new Promise(function (resolve, reject) {
          if (!ok) { reject(new Error('could not open MIDI input (in use elsewhere)')); return; }
          self.connection = 'open'; resolve(self);
        });
      },
    };
  }

  window.__midiOutPorts = new Map();
  window.__midiOutSent = [];
  window.__midiAddOutput = function (id, name) {
    const out = { id: id, name: name, manufacturer: 'Fake Instruments', type: 'output', state: 'connected', connection: 'closed',
      send: function (bytes, atMs) { window.__midiOutSent.push({ id: id, bytes: Array.from(bytes), atMs: atMs }); } };
    window.__midiOutPorts.set(id, out);
    window.__midiAccessListeners.forEach(function (fn) { fn({ port: out }); });
    return out;
  };

  window.__midiAddPort = function (id, name, state) {
    const input = __midiMakeInput(id, name, state);
    window.__midiPorts.set(id, input);
    window.__midiAccessListeners.forEach(function (fn) { fn({ port: input }); });
    return input;
  };
  window.__midiRemovePort = function (id) {
    const input = window.__midiPorts.get(id);
    if (!input) return;
    input.state = 'disconnected';
    window.__midiPorts.delete(id);
    window.__midiAccessListeners.forEach(function (fn) { fn({ port: input }); });
  };
  window.__midiSend = function (id, bytes) {
    const input = window.__midiPorts.get(id);
    if (input && input.onmidimessage) input.onmidimessage({ data: new Uint8Array(bytes) });
  };
  window.__midiSetOpenResult = function (id, ok) { window.__midiOpenResults.set(id, ok); };
  window.__midiReject = function () { window.__midiRejectNext = true; };
  // A real Chromium build ships its own native requestMIDIAccess on
  // Navigator.prototype, so a plain "delete" here just un-shadows that one
  // underneath -- typeof stays 'function'. Overwriting the OWN property's
  // value to undefined is what actually makes navigator.requestMIDIAccess
  // falsy, matching a genuinely MIDI-less browser.
  window.__midiMakeUnavailable = function () { Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined }); };

  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: function () {
      if (window.__midiRejectNext) { window.__midiRejectNext = false; return Promise.reject(new Error('Permission denied')); }
      const access = { inputs: { forEach: function (fn) { window.__midiPorts.forEach(fn); } }, outputs: { forEach: function (fn) { window.__midiOutPorts.forEach(fn); } }, onstatechange: null };
      window.__midiAccessListeners.push(function (ev) { if (access.onstatechange) access.onstatechange(ev); });
      window.__midiAccess = access;
      return Promise.resolve(access);
    },
  });
`;

export async function midiAddPort(page, id, name, state = 'connected') {
  await page.evaluate(`window.__midiAddPort(${JSON.stringify(id)}, ${JSON.stringify(name)}, ${JSON.stringify(state)})`);
}

export async function midiAddOutput(page, id, name) {
  await page.evaluate(`window.__midiAddOutput(${JSON.stringify(id)}, ${JSON.stringify(name)})`);
}

export async function midiOutSent(page) {
  return page.evaluate('window.__midiOutSent');
}

export async function midiRemovePort(page, id) {
  await page.evaluate(`window.__midiRemovePort(${JSON.stringify(id)})`);
}

export async function midiSend(page, id, bytes) {
  await page.evaluate(`window.__midiSend(${JSON.stringify(id)}, ${JSON.stringify(bytes)})`);
}

export async function midiNoteOn(page, id, note, velocity = 100, channel = 0) {
  await midiSend(page, id, [0x90 | (channel & 0x0f), note, velocity]);
}

export async function midiNoteOff(page, id, note, channel = 0) {
  await midiSend(page, id, [0x80 | (channel & 0x0f), note, 0]);
}

export async function midiSetOpenResult(page, id, ok) {
  await page.evaluate(`window.__midiSetOpenResult(${JSON.stringify(id)}, ${ok ? 'true' : 'false'})`);
}

export async function midiReject(page) {
  await page.evaluate('window.__midiReject()');
}

export async function midiMakeUnavailable(page) {
  await page.evaluate('window.__midiMakeUnavailable()');
}
