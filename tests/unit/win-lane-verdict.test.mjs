// W1's verdict, tested on Linux with made-up observations: the Windows lane's
// first check (README step 1, acceptance finding 6). One bad fact each must
// turn a clean observation into a FAIL that names it, and a clean one is a
// PASS that says what was and was not shown -- never that anything is "fixed".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as w1 from '../acceptance/win/w1-clean-open.win.mjs';
import { en } from '../../src/core/i18n.js';

const SHA = 'a'.repeat(64);
const URL_OPENED = 'file:///C:/Users/me/Temp/run-1/band-coach.html';
const clean = (over = {}) => ({
  logEntries: [],
  consoleErrors: [],
  consoleWarnings: [],
  exceptions: [],
  requests: [URL_OPENED],
  requestDetails: [{ url: URL_OPENED, type: 'Document', initiator: { type: 'other' } }],
  openedUrl: URL_OPENED,
  hook: 'undefined',
  sha256: SHA,
  expectedSha256: SHA,
  flags: ['--window-position=-32000,-32000', '--disable-extensions', '--no-default-browser-check'],
  ...over,
});

test('U2 w1Verdict: a clean observation is a PASS that says what was shown', () => {
  const v = w1.w1Verdict(clean());
  assert.equal(v.status, 'PASS');
  assert.match(v.text, /not reproduced in a clean profile, extensions off/);
  assert.deepEqual(v.findings, []);
});

const BAD = {
  'one console error': [{ consoleErrors: ['Uncaught boom'] }, /boom/],
  'one console warning': [{ consoleWarnings: ['AudioContext was not allowed to start.'] }, /AudioContext was not allowed/],
  'one Log entry': [{ logEntries: [{ source: 'security', level: 'error', text: 'Refused to load X', url: URL_OPENED, lineNumber: 1 }] }, /Refused to load X/],
  'one exception': [{ exceptions: ['Uncaught: ReferenceError: x is not defined'] }, /ReferenceError/],
  'a second request': [{ requests: [URL_OPENED, 'https://example.com/ping'] }, /example\.com\/ping/],
  'no request at all': [{ requests: [] }, /request/],
  'a request for some other url': [{ requests: ['file:///C:/other.html'] }, /other\.html/],
  'window.__coach present': [{ hook: 'object' }, /__coach/],
  'sha256 differing from expected': [{ sha256: 'b'.repeat(64) }, new RegExp('b'.repeat(64))],
  'no expected sha256': [{ expectedSha256: undefined }, /sha256/],
  'extensions not turned off': [{ flags: ['--no-default-browser-check'] }, /--disable-extensions/],
};

for (const [name, [over, finding]] of Object.entries(BAD)) {
  test(`U2 w1Verdict: ${name} gives FAIL and names it`, () => {
    const v = w1.w1Verdict(clean(over));
    assert.equal(v.status, 'FAIL');
    assert.match(v.text, finding);
    assert.ok(v.findings.length >= 1);
  });
}

test('U2 w1Verdict: no verdict text says "fixed"', () => {
  const texts = [w1.w1Verdict(clean()).text, ...Object.values(BAD).map(([over]) => w1.w1Verdict(clean(over)).text)];
  for (const t of texts) assert.doesNotMatch(t, /fixed/i);
});

test('the scenario file exports its id, a run function and the verdict', () => {
  assert.equal(w1.id, 'W1');
  assert.equal(typeof w1.run, 'function');
  assert.equal(w1.verdict, w1.w1Verdict);
});

// ---- B2: W2-W5. The scenario modules are loaded inside each test so a missing
// file fails only its own tests. Verdict text for W3 is built from the app's own
// strings (en), never copied, so a reworded message cannot drift past these tests.
const load = (file) => import(`../acceptance/win/${file}`);
const fill = (s, version) => s.replace('{version}', version);

test('U3 w3Verdict: "latest version" with the version expected is a PASS', async () => {
  const w3 = await load('w3-update-check.win.mjs');
  const v = w3.w3Verdict({ text: fill(en['update.upToDate'], '1.9.0'), expectVersion: '1.9.0' });
  assert.equal(v.status, 'PASS');
  assert.match(v.text, /1\.9\.0/);
});

test('U3 w3Verdict: a different version, "behind", "error", "dev build" and "still checking" each give FAIL', async () => {
  const w3 = await load('w3-update-check.win.mjs');
  const cases = {
    'a different version': [fill(en['update.upToDate'], '1.8.0'), /1\.8\.0/],
    behind: [fill(en['update.behind'], '2.0.0') + 'Get it here', /2\.0\.0/],
    error: [en['update.error'] + 'Get it here', /reach the update server/i],
    'dev build': [fill(en['update.devBuild'], 'dev'), /development build/i],
    'still checking': [en['update.checking'], /Checking/],
    'some other text': ['Something else entirely', /Something else entirely/],
  };
  for (const [name, [text, finding]] of Object.entries(cases)) {
    const v = w3.w3Verdict({ text, expectVersion: '1.9.0' });
    assert.equal(v.status, 'FAIL', name);
    assert.match(v.text, finding, name);
  }
});

test('U3 w3Verdict: with no version expected the result is OBSERVED with the version, never PASS', async () => {
  const w3 = await load('w3-update-check.win.mjs');
  const v = w3.w3Verdict({ text: fill(en['update.upToDate'], '1.9.0'), expectVersion: undefined });
  assert.equal(v.status, 'OBSERVED');
  assert.match(v.text, /1\.9\.0/);
  assert.match(v.text, /--expect-version/);
});

test('U3 w3 exports its id, a run function and the verdict', async () => {
  const w3 = await load('w3-update-check.win.mjs');
  assert.equal(w3.id, 'W3');
  assert.equal(typeof w3.run, 'function');
  assert.equal(w3.verdict, w3.w3Verdict);
});

const MIDI_BASE = 'Screen and computer keys work. MIDI is optional.';
const midi = (over = {}) => ({ before: MIDI_BASE, after: 'USB MIDI Interface found. Press any key on it.', exceptions: [], midiOutValue: '', ...over });

test('U7 w5Verdict: each handled outcome is a PASS that names its branch', async () => {
  const w5 = await load('w5-midi-outcome.win.mjs');
  const accepted = {
    found: 'USB MIDI Interface found. Press any key on it.',
    'found (several)': 'A and B found. Press any key on one.',
    working: 'USB MIDI Interface is working.',
    'working (several)': 'A and B are working.',
    'no device': 'No MIDI device is plugged in. Plug it in and it will be picked up. Screen and computer keys still work as practice, not proof a real keyboard works.',
    busy: 'Another program may be using this keyboard. Close it and press Connect again.',
  };
  for (const [branch, after] of Object.entries(accepted)) {
    const v = w5.w5Verdict(midi({ after }));
    assert.equal(v.status, 'PASS', branch);
    assert.match(v.text, new RegExp(branch.replace(/ \(several\)$/, '')), branch);
  }
});

test('U7 w5Verdict: the "could not reach MIDI" text, the other error texts and an exception each give FAIL', async () => {
  const w5 = await load('w5-midi-outcome.win.mjs');
  const bad = {
    'could not reach MIDI': 'This browser could not reach MIDI on this computer. Screen and computer keys still work as practice, not proof a real keyboard works.',
    'blocked here': 'MIDI was blocked here. Open the standalone copy in Chrome.',
    'cannot read MIDI': 'This browser cannot read MIDI. Use Chrome or Edge.',
    'text nobody knows': 'Something unexpected happened.',
  };
  for (const [name, after] of Object.entries(bad)) {
    const v = w5.w5Verdict(midi({ after }));
    assert.equal(v.status, 'FAIL', name);
    assert.match(v.text, new RegExp(after.slice(0, 20)), name);
  }
  const ex = w5.w5Verdict(midi({ exceptions: ['Uncaught: TypeError: x'] }));
  assert.equal(ex.status, 'FAIL');
  assert.match(ex.text, /TypeError/);
});

test('U7 w5Verdict: "the answer was no" is judged by the browser: BLOCKED when it refused too, FAIL when it would have allowed', async () => {
  const w5 = await load('w5-midi-outcome.win.mjs');
  const no = 'Chrome asked to use your MIDI devices and the answer was no (or the box was closed). Click Try MIDI again to ask again.';
  for (const direct of ['NotAllowedError: Permission to use Web MIDI API was not granted.', 'no answer in 10 s', undefined]) {
    const v = w5.w5Verdict(midi({ after: no, direct }));
    assert.equal(v.status, 'BLOCKED', String(direct));
    assert.match(v.text, /could not get Chrome to honour/);
  }
  const fail = w5.w5Verdict(midi({ after: no, direct: 'ok, inputs 1' }));
  assert.equal(fail.status, 'FAIL');
  assert.match(fail.text, /succeeded/);
});

test('U7 w5Verdict: a status unchanged after the deadline is BLOCKED, and a picked MIDI output is a FAIL', async () => {
  const w5 = await load('w5-midi-outcome.win.mjs');
  const stuck = w5.w5Verdict(midi({ after: MIDI_BASE }));
  assert.equal(stuck.status, 'BLOCKED');
  assert.match(stuck.text, /unchanged/);
  const out = w5.w5Verdict(midi({ midiOutValue: 'output-1' }));
  assert.equal(out.status, 'FAIL');
  assert.match(out.text, /midiOutSelect/);
});

test('U7 w5 exports its id, a run function and the verdict', async () => {
  const w5 = await load('w5-midi-outcome.win.mjs');
  assert.equal(w5.id, 'W5');
  assert.equal(typeof w5.run, 'function');
  assert.equal(w5.verdict, w5.w5Verdict);
});

const prog = (over = {}) => {
  const before = { stored: null, shown: 'Fresh · 0 min today', ready: '20' };
  const played = { stored: '{"sessions":[1]}', shown: 'Fresh · 0 min today · last keyboard session 100%', ready: '65' };
  return { before, played, afterReload: { ...played }, exceptions: [], ...over };
};

test('W2 w2Verdict: progress written, shown, and the same after a reload is a PASS', async () => {
  const w2 = await load('w2-progress-reload.win.mjs');
  const v = w2.w2Verdict(prog());
  assert.equal(v.status, 'PASS');
  assert.match(v.text, /Page\.reload/);
});

test('W2 w2Verdict: each broken link gives FAIL; a step that could not be done is BLOCKED', async () => {
  const w2 = await load('w2-progress-reload.win.mjs');
  const p = prog();
  const cases = {
    'play wrote nothing': [{ played: { ...p.played, stored: null } }, /bandcoach\.v1/],
    'play changed nothing shown': [{ played: { ...p.played, shown: p.before.shown }, afterReload: { ...p.played, shown: p.before.shown } }, /shown/],
    'reload lost what was stored': [{ afterReload: { ...p.played, stored: null } }, /stored/],
    'reload lost what was shown': [{ afterReload: { ...p.played, shown: p.before.shown } }, /back to/],
    'an exception': [{ exceptions: ['Uncaught: boom'] }, /boom/],
  };
  for (const [name, [over, finding]] of Object.entries(cases)) {
    const v = w2.w2Verdict(prog(over));
    assert.equal(v.status, 'FAIL', name);
    assert.match(v.text, finding, name);
  }
  const b = w2.w2Verdict({ blocked: 'the exercise prompt was "Tune up"; no key for it' });
  assert.equal(b.status, 'BLOCKED');
  assert.match(b.text, /Tune up/);
  assert.equal(w2.id, 'W2');
  assert.equal(w2.verdict, w2.w2Verdict);
});

const sound = (over = {}) => ({ load: { running: 0, warnings: [] }, labelBefore: 'Start', after: { running: 1, warnings: [] }, labelAfter: 'Pause', exceptions: [], ...over });

test('W4 w4Verdict: silent on load, one running context after a click, no warning is a PASS', async () => {
  const w4 = await load('w4-audio-gesture.win.mjs');
  assert.equal(w4.w4Verdict(sound()).status, 'PASS');
  assert.equal(w4.id, 'W4');
  assert.equal(w4.verdict, w4.w4Verdict);
});

test('W4 w4Verdict: sound before a click, a warning, no sound after the click, a wrong label or an exception each give FAIL', async () => {
  const w4 = await load('w4-audio-gesture.win.mjs');
  const warn = 'warning: The AudioContext was not allowed to start.';
  const cases = {
    'sound already running on load': [{ load: { running: 1, warnings: [] } }, /on load/],
    'a warning on load': [{ load: { running: 0, warnings: [warn] } }, /not allowed to start/],
    'no sound after the click': [{ after: { running: 0, warnings: [] } }, /0 running/],
    'two contexts after the click': [{ after: { running: 2, warnings: [] } }, /2 running/],
    'a warning after the click': [{ after: { running: 1, warnings: [warn] } }, /not allowed to start/],
    'button not Pause': [{ labelAfter: 'Start' }, /Pause/],
    'an exception': [{ exceptions: ['Uncaught: boom'] }, /boom/],
  };
  for (const [name, [over, finding]] of Object.entries(cases)) {
    const v = w4.w4Verdict(sound(over));
    assert.equal(v.status, 'FAIL', name);
    assert.match(v.text, finding, name);
  }
});
