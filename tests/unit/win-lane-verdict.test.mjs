// W1's verdict, tested on Linux with made-up observations: the Windows lane's
// first check (README step 1, acceptance finding 6). One bad fact each must
// turn a clean observation into a FAIL that names it, and a clean one is a
// PASS that says what was and was not shown -- never that anything is "fixed".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as w1 from '../acceptance/win/w1-clean-open.win.mjs';

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
