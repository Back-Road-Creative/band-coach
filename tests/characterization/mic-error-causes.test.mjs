// A microphone that did not start used to say "The microphone was blocked.
// Allow it in the browser" for EVERY cause: no microphone at all, one held by
// a call app, no audio engine. The learner followed the wrong fix. Now the
// text names the real cause, the failure lands in the error log, and a stream
// that was acquired but could not be wired up is stopped (the OS microphone
// light must not stay on).
//
// initScript runs before any page script (tests/helpers/browser.mjs), so it
// replaces getUserMedia / the AudioContext the way a real machine's failure
// would present: a rejection carrying a DOMException of the real name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const REJECT = (name) => `
  window.__gumCalls = 0;
  navigator.mediaDevices.getUserMedia = async function () { window.__gumCalls++; throw new DOMException('simulated', ${JSON.stringify(name)}); };
`;
const CASES = [
  ['NotAllowedError', /The microphone was blocked\. Allow it in the browser/],
  ['NotFoundError', /no microphone/i],
  ['NotReadableError', /another (program|app)/i],
  ['OverconstrainedError', /cannot be used|different input|another input/i],
  ['SecurityError', /cannot use the microphone/i],
];
const ioText = (page) => page.evaluate("document.getElementById('ioText').textContent");
const waitFailed = (page) => page.waitFor("document.getElementById('ioText').textContent && document.getElementById('ioText').textContent !== 'This one listens through a microphone or audio interface.' && !/Listening|Checking/.test(document.getElementById('ioText').textContent)", 8000);

for (const [name, expected] of CASES) {
  test(`Connect with getUserMedia rejecting ${name} shows that cause`, async (t) => {
    const page = await launchPage(HTML_PATH, { initScript: REJECT(name) });
    t.after(() => page.close());
    await page.evaluate("window.__coach.setMod('gtr')");
    await page.evaluate("document.getElementById('ioBtn').click()");
    await waitFailed(page);
    const text = await ioText(page);
    assert.match(text, expected, text);
    if (name !== 'NotAllowedError') assert.doesNotMatch(text, /blocked|\ballow\b/i, 'must not send the learner to the permission setting: ' + text);
    assert.equal(await page.evaluate("document.getElementById('ioBtn').hidden"), false, 'Connect stays so they can retry');
    const errs = await page.evaluate('window.__coach.errors()');
    assert.ok(errs.some((e) => /^mic/.test(e.where)), 'the failure is in the error log: ' + JSON.stringify(errs));
  });
}

test('Start on a mic instrument with no microphone says so, not "blocked"', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: REJECT('NotFoundError') });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  // Wait for ANY settled failure text (wording-independent), so a wrong text fails the assertions below, not a timeout.
  await page.waitFor("/microphone/i.test(document.getElementById('coach').textContent)", 8000);
  const coachText = await page.evaluate("document.getElementById('coach').textContent");
  assert.match(coachText, /no microphone/i, coachText);
  assert.doesNotMatch(coachText, /blocked|\ballow\b/i, coachText);
  assert.match(await ioText(page), /no microphone/i);
  const errs = await page.evaluate('window.__coach.errors()');
  assert.ok(errs.some((e) => /^mic/.test(e.where)), 'logged: ' + JSON.stringify(errs));
});

test('Start with the mic blocked keeps the start-flow advice', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: REJECT('NotAllowedError') });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("/blocked/i.test(document.getElementById('coach').textContent)", 8000);
  assert.match(await page.evaluate("document.getElementById('coach').textContent"), /microphone was blocked.*Set up input.*Connect microphone/s);
});

test('a stream acquired but not wirable is stopped, and the failure is shown', async (t) => {
  const page = await launchPage(HTML_PATH, {
    initScript: `
      window.__tracks = [];
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); s.getTracks().forEach((tr) => window.__tracks.push(tr)); return s; };
      AudioContext.prototype.createMediaStreamSource = function () { throw new Error('simulated wiring failure'); };
    `,
  });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__tracks.length > 0', 8000);
  await waitFailed(page);
  assert.deepEqual(await page.evaluate('window.__tracks.map((tr) => tr.readyState)'), ['ended'], 'the acquired track was stopped');
  const text = await ioText(page);
  assert.doesNotMatch(text, /blocked|Listening/, text);
  assert.equal(await page.evaluate("document.getElementById('ioBtn').hidden"), false);
});

test('no AudioContext: say so, and never open the microphone', async (t) => {
  const page = await launchPage(HTML_PATH, {
    initScript: `
      window.__gumCalls = 0;
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => { window.__gumCalls++; return gum(c); };
      window.AudioContext = undefined; window.webkitAudioContext = undefined;
    `,
  });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await waitFailed(page);
  const text = await ioText(page);
  assert.match(text, /audio/i, text);
  assert.doesNotMatch(text, /blocked|\ballow\b/i, text);
  assert.equal(await page.evaluate('window.__gumCalls'), 0, 'no microphone was acquired for a page that cannot process it');
});
