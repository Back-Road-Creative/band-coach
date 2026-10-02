// Field report (v1.9.0, Windows Chrome): "the midi doesn't appear to connect".
// Chrome 124+ prompts on every requestMIDIAccess() call; a dismissed/blocked
// prompt rejects with NotAllowedError, and the app used to answer "Open the
// standalone copy in Chrome" to a learner already in it, with no retry. These
// tests drive the real #setupBtn / #ioBtn clicks against a stub that rejects
// the way Chrome does, then resolves on the second ask.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const stub = (name, msg) => `
  window.__midiAsks = 0;
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: function () {
    window.__midiAsks++;
    if (window.__midiAsks === 1) return Promise.reject(new DOMException(${JSON.stringify(msg)}, ${JSON.stringify(name)}));
    return Promise.resolve({ inputs: new Map(), outputs: new Map(), onstatechange: null });
  } });
`;

async function openIo(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("window.__midiAsks >= 1 && /MIDI/.test(document.getElementById('ioText').textContent) && !/Screen keys and computer keys work/.test(document.getElementById('ioText').textContent)");
}

test('NotAllowedError says Chrome asked, offers a retry, and the retry re-requests', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: stub('NotAllowedError', 'Permission to use Web MIDI API was not granted.') });
  t.after(() => page.close());
  await openIo(page);
  const text = await page.evaluate("document.getElementById('ioText').textContent");
  assert.match(text, /ask again/i);
  assert.match(text, /practice, not proof/i);
  assert.doesNotMatch(text, /standalone copy/i);
  assert.equal(await page.evaluate("document.getElementById('ioBtn').hidden"), false);
  assert.equal(await page.evaluate("document.getElementById('ioBtn').disabled"), false);
  assert.match(await page.evaluate("document.getElementById('ioBtn').textContent"), /Try MIDI again/);
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("/No MIDI device/.test(document.getElementById('ioText').textContent)");
  assert.equal(await page.evaluate('window.__midiAsks'), 2);
  assert.doesNotMatch(await page.evaluate("document.getElementById('ioText').textContent"), /ask again|blocked/i);
});

test('InvalidStateError says the browser could not reach MIDI, not the standalone-copy advice', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: stub('InvalidStateError', 'Platform dependent initialization failed.') });
  t.after(() => page.close());
  await openIo(page);
  const text = await page.evaluate("document.getElementById('ioText').textContent");
  assert.match(text, /could not reach MIDI on this computer/i);
  assert.match(text, /practice, not proof/i);
  assert.doesNotMatch(text, /standalone copy|ask again/i);
});
