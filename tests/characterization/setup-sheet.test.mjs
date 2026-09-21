// New behaviour (band-coach UI declutter plan U1): the io strip (Connect,
// the Input select, Check my microphone, MIDI details, the level meter) is
// collapsed into one "Set up input" control instead of four separate
// controls plus readouts sitting on first paint. The status line
// (#ioDot/#ioText) and the MIDI activity dot stay visible always -- they are
// feedback, not controls, and are how a learner knows whether they are being
// heard. Opening the sheet must not disturb #ioBtn's id, click handler, or
// any of the other ids other tests click directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('first paint shows one setup control, not the whole io strip', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Feedback, not a control: always visible.
  assert.equal(await page.evaluate("document.getElementById('ioDot').hidden"), false);
  assert.equal(await page.evaluate("document.getElementById('ioText').hidden"), false);

  // The one control that replaces the strip.
  assert.equal(await page.evaluate("document.getElementById('setupBtn').hidden"), false);
  assert.equal(await page.evaluate("document.getElementById('setupBtn').textContent"), 'Set up input');

  // The rest of the strip starts collapsed inside the sheet.
  assert.equal(await page.evaluate("document.getElementById('setupSheet').hidden"), true);
  assert.equal(await page.evaluate("document.getElementById('setupBtn').getAttribute('aria-expanded')"), 'false');
});

test('the setup button is below the instrument picker in the DOM', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  const order = await page.evaluate(
    "(() => { const p = document.getElementById('picker'); const s = document.getElementById('setupBtn'); return !!(p.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); })()"
  );
  assert.equal(order, true);
});

test('opening the sheet reveals Connect, Input and Check my microphone', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.waitFor("document.getElementById('setupSheet').hidden === false");

  assert.equal(await page.evaluate("document.getElementById('setupBtn').getAttribute('aria-expanded')"), 'true');
  assert.equal(await page.evaluate("document.getElementById('ioBtn').closest('#setupSheet') !== null"), true);
  assert.equal(await page.evaluate("document.getElementById('micDeviceSelect').closest('#setupSheet') !== null"), true);
  assert.equal(await page.evaluate("document.getElementById('calibrateBtn').closest('#setupSheet') !== null"), true);
});

test('#ioBtn stays clickable while the sheet is closed', async (t) => {
  // A direct click on #ioBtn must keep working without opening the sheet
  // first -- 12 other test files click it this way. Not gated on mode
  // (setMod), just that clicking never throws and the click handler ran
  // (ensureAudio side effect: ioState/ioText updates, or at minimum no
  // exception).
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  assert.equal(await page.evaluate("document.getElementById('setupSheet').hidden"), true);
  await page.evaluate("document.getElementById('ioBtn').click()");
  // No exception thrown getting here is the assertion; also confirm the
  // element is still in the live document (not removed/recreated by the
  // sheet toggle).
  assert.equal(await page.evaluate("document.body.contains(document.getElementById('ioBtn'))"), true);
});
