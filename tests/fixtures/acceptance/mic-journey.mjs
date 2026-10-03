// Fixtures and the observer for the mic setup acceptance journey
// (tests/release/acceptance-mic-setup.test.mjs). Nothing here is committed as
// a binary: the WAVs are written to a tmp dir when a test asks for one.
//
// Probes run before the tests were written (headless Chrome, the full build
// the acceptance lane uses, the release file, 2026-10-02):
//   P1  --use-file-for-fake-audio-capture LOOPS the file, starts it at sample 0
//       on getUserMedia, and `path%noloop` plays it once then true silence. A
//       1 s 0.014 RMS tone + 3 s of zeros read 0.014 for 1 s, 0.000 for 3 s,
//       then 0.014 again at 4.0 s; with %noloop it never came back. (With the
//       default autoGainControl the same tone read 0.069 falling to 0.005, so
//       the app's own constraints, AGC off, are what make a level honest.)
//       The fixtures below do not depend on this: every 1.5 s or 3 s window of
//       them classifies the same whatever the loop is doing.
//   P2  All three fake inputs ('Fake Default Audio Input', 'Fake Audio Input 1',
//       'Fake Audio Input 2') play the SAME file: the same 0.014 / 0.000 series
//       on each via getUserMedia({deviceId: {exact}}). Their device ids are
//       hashes, so a test reads the id from the select, never hard-codes it.
//   P3  See the header of the test file (the real-key route for the select).
//   P4  and P5: see the header of the test file.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluck, writePluckWav } from '../../helpers/pluck-wav.mjs';

export const SR = 48000;
// Every fixture is 8.4 s: a multiple of the 0.7 s pluck period, so the loop
// seam is as regular as the rest and any window classifies the same.
export const SECONDS = 8.4;

// Highest RMS over any 4096-sample window (what the app's analyser sees).
function peakRms(buf) { let pk = 0; for (let a = 0; a + 4096 <= buf.length; a += 512) { let s = 0; for (let i = a; i < a + 4096; i++) s += buf[i] * buf[i]; pk = Math.max(pk, Math.sqrt(s / 4096)); } return pk; }
const scaleToPeak = (buf, target) => { const g = target / peakRms(buf); return buf.map((x) => x * g); };

// The quiet room of mic-connect-calibrates and mic-room-check, 8.4 s long. Its
// peak is far under MIN_FLOOR 0.0015, so the burst test never fires and the
// room check stores a floor.
export const quietRoom = () => pluck(110, SR, SECONDS, { seed: 3, gain: 0.0003 });

// Someone playing as soon as they press Connect: a 110 Hz string plucked every
// 0.7 s (the first at sample 0), 12 plucks, each dying away well before the
// next, peak 0.005. Any 1.5 s window holds at least two plucks, so it is bursty
// and both the automatic and the manual check refuse it. `decay: 0.9` is
// measured, not copied from the Q1 train (0.98): at 0.98 the peak is only
// 2.6 to 3.9 times the median frame against the check's threshold of 3 (the
// browser's own analyser, 8 consecutive 3 s windows: 3.15 to 3.88), and the
// manual check then stored a floor of 0.0012 in 5 of 7 runs. At 0.9 the
// smallest ratio over every loop phase is above 17 and the browser read 34 to 65.
export function learnerPlaying() {
  const b = new Float32Array(Math.round(SR * SECONDS)), period = Math.round(0.7 * SR);
  for (let k = 0, at = 0; at < b.length; k++, at += period) { const p = pluck(110, SR, 0.7, { seed: 5 + k, decay: 0.9 }); b.set(p.subarray(0, Math.min(p.length, b.length - at)), at); }
  return scaleToPeak(b, 0.005);
}

// Writes `samples` to a fresh tmp dir as a mono WAV and returns the path.
export const writeFixture = (name, samples) => writePluckWav(join(mkdtempSync(join(tmpdir(), 'mic-journey-')), name + '.wav'), samples, SR);

// The observer, passed as `initScript`. It reads and never drives: every entry
// is { t: performance.now(), kind, ... } on window.__a04.
//   result / io / dot  text of #calibrateResult and #ioText (empty strings
//                      included) and the class of #ioDot, on every change
//   click / change / visibility  capture-phase, with isTrusted
//   setItem            each write of 'bandcoach.v1': { floor, v, id }
// A setItem timestamp is the WRITE time, 0 to 1.2 s after a floor was set
// (save() is a throttle: the first call schedules writeDB() 1.2 s later and
// every call before that fires is dropped). It proves content and order only;
// timing questions are answered by the result-text timestamps, which are set
// in the same tick as the store. Storage.prototype.setItem is wrapped, never
// localStorage.setItem assigned: a Storage's named setter would store THAT as
// an item called "setItem".
export const RECORDER_SCRIPT = `(() => {
  const log = (window.__a04 = []);
  const push = (kind, extra) => log.push(Object.assign({ t: performance.now(), kind: kind }, extra));
  const seen = { result: '', io: null, dot: null };
  const scan = () => {
    const r = document.getElementById('calibrateResult'), io = document.getElementById('ioText'), dot = document.getElementById('ioDot');
    if (r && r.textContent !== seen.result) { seen.result = r.textContent; push('result', { text: r.textContent }); }
    if (io && io.textContent !== seen.io) { seen.io = io.textContent; push('io', { text: io.textContent }); }
    if (dot && dot.className !== seen.dot) { seen.dot = dot.className; push('dot', { cls: dot.className }); }
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  const idOf = (e) => { const el = e.target && e.target.closest ? e.target.closest('#ioBtn, #calibrateBtn') : null; return el ? el.id : null; };
  document.addEventListener('click', (e) => { const id = idOf(e); if (id) push('click', { id: id, trusted: e.isTrusted }); }, true);
  document.addEventListener('change', (e) => { if (e.target && e.target.id === 'micDeviceSelect') push('change', { value: e.target.value, trusted: e.isTrusted }); }, true);
  document.addEventListener('visibilitychange', (e) => push('visibility', { state: document.visibilityState, trusted: e.isTrusted }), true);
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    try {
      if (key === 'bandcoach.v1' && this === window.localStorage) {
        const p = (JSON.parse(value) || {}).prefs || {};
        push('setItem', { floor: p.noiseFloor == null ? null : p.noiseFloor, v: p.noiseFloorV == null ? null : p.noiseFloorV, id: p.inputDeviceId == null ? null : p.inputDeviceId });
      }
    } catch (e) { /* the recorder never changes what the app stores */ }
    return original.apply(this, arguments);
  };
})();`;
