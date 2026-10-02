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

// Opt-in: FAKE_MIDI_INIT plus permission that comes from the BROWSER.
//
// The base stub above replaces requestMIDIAccess wholesale, so Browser.setPermission
// / page.grant / page.deny never reach it and its __midiReject() rejects with a plain
// Error (name "Error"), which the app reads as "could not reach MIDI", never as a
// denial. This addendum asks the browser instead. Probe verdict (Mode B), observed on
// Chrome/153.0.8010.12 (full Chrome, file:// page, fresh profile; probe-midi*.log):
//   page.deny(['midi'])          -> navigator.permissions.query = "denied"; the real
//                                   requestMIDIAccess() rejects DOMException NotAllowedError
//   page.grant(['midi'])         -> query = "granted"; the real call STILL rejects
//                                   NotAllowedError (and with sysex granted it reaches
//                                   InvalidStateError "Platform dependent initialization
//                                   failed": no MIDI backend), so the real call cannot resolve here
//   neither                      -> query = "prompt"; the real call rejects NotAllowedError
// So the real call cannot supply "granted". The stub therefore asks
// navigator.permissions.query({ name: 'midi' }) at call time and reads the browser's own
// answer: "denied" rejects with the same DOMException the browser gives, "granted"
// returns what the base stub returns (the fake ports), "prompt" rejects with a
// distinctive Error because a test must grant or deny first. No flag in the stub
// stands in for permission.
//
// Extra page-side handles:
//   window.__midiAsks                       -- how many times the app asked for MIDI access
//   window.__midiRejectWith(name, message)  -- the NEXT granted ask rejects with a DOMException
//                                              of that name (a platform failure, not permission)
//   window.__midiSetPortState(id, state)    -- flip a port's state but keep it listed; fires onstatechange
export const FAKE_MIDI_BROWSER_PERMISSION_INIT = FAKE_MIDI_INIT + `
  (function () {
    const baseStub = navigator.requestMIDIAccess;
    window.__midiAsks = 0;
    window.__midiRejectWithNext = null;
    window.__midiRejectWith = function (name, message) { window.__midiRejectWithNext = { name: name, message: message }; };
    window.__midiSetPortState = function (id, state) {
      const input = window.__midiPorts.get(id);
      if (!input) return;
      input.state = state;
      window.__midiAccessListeners.forEach(function (fn) { fn({ port: input }); });
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: function () {
        window.__midiAsks += 1;
        const self = this;
        return navigator.permissions.query({ name: 'midi' }).then(function (p) {
          if (p.state === 'denied') throw new DOMException('Permission to use Web MIDI API was not granted.', 'NotAllowedError');
          if (p.state !== 'granted') throw new Error('fake-midi: the browser permission for MIDI is still "' + p.state + '"; the test must page.grant or page.deny it first');
          const injected = window.__midiRejectWithNext;
          if (injected) { window.__midiRejectWithNext = null; throw new DOMException(injected.message, injected.name); }
          return baseStub.call(self);
        });
      },
    });
  })();
`;

export async function midiRejectWith(page, name, message) {
  await page.evaluate(`window.__midiRejectWith(${JSON.stringify(name)}, ${JSON.stringify(message)})`);
}

export async function midiSetPortState(page, id, state) {
  await page.evaluate(`window.__midiSetPortState(${JSON.stringify(id)}, ${JSON.stringify(state)})`);
}
