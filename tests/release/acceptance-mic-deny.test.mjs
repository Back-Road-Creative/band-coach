// Acceptance: a learner who answers "Block" to the microphone prompt is told so
// in plain words and is not shown a listening state. The answer goes to the
// BROWSER (page.deny), where a person's Block lands, and Connect is a real
// click. The ordinary harness grants the mic by flag, so this path was unseen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

// Picks the Tuner (it listens through the microphone) and presses Connect, the
// way a learner does: instrument button, "Set up input", then Connect.
async function chooseTunerAndConnect(page) {
  await page.clickSelector('#picker button[data-mod="tuner"]');
  await page.clickSelector('#setupBtn');
  await page.clickSelector('#ioBtn');
}

const readIo = (page) =>
  page.evaluate("({ text: document.getElementById('ioText').textContent, dot: document.getElementById('ioDot').className, connectShown: !document.getElementById('ioBtn').hidden })");

test('a microphone the browser has blocked: Connect says it was blocked and nothing is listening', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    await page.deny(['microphone']);
    await chooseTunerAndConnect(page);
    await page.waitFor("/blocked/i.test(document.getElementById('ioText').textContent)");
    const io = await readIo(page);
    assert.match(io.text, /The microphone was blocked\. Allow it in the browser/, 'the app says what happened and what to do');
    assert.doesNotMatch(io.text, /Listening/, 'no listening claim');
    assert.ok(!/\bon\b/.test(io.dot), `the status dot is not "on": ${io.dot}`);
    assert.ok(/\boff\b/.test(io.dot), `the status dot says off: ${io.dot}`);
    assert.ok(io.connectShown, 'Connect is still there so the learner can try again after allowing it');
    assert.equal(
      await page.evaluate("navigator.permissions.query({ name: 'microphone' }).then((p) => p.state)"),
      'denied',
      'and the browser itself is holding the microphone as denied',
    );
  });
});

test('control for the test above: the same clicks with the microphone granted do reach a listening state', async (t) => {
  // If this stops listening, the deny test passes for the wrong reason.
  await withAcceptancePage(t, {}, async (page) => {
    await page.grant(['microphone']);
    await chooseTunerAndConnect(page);
    await page.waitFor("/Listening/.test(document.getElementById('ioText').textContent)");
    const io = await readIo(page);
    assert.match(io.text, /Listening through your microphone/);
    assert.ok(/\bon\b/.test(io.dot), `the status dot is on: ${io.dot}`);
    assert.ok(!io.connectShown, 'Connect is gone once connected');
  });
});
