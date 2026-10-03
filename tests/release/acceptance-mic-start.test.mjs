// Acceptance: Start on a microphone instrument asks for the microphone first, and
// leaving for an instrument that does not listen closes it. Before, Start ran an
// exercise that could not hear, said "Time.", then "You stepped away", and never
// asked for the mic; and the mic light stayed on after a switch to Keyboard. The
// answer goes to the BROWSER (page.grant / page.deny) and Start is a real click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

const el = (page, id, prop) => page.evaluate(`document.getElementById('${id}').${prop}`);
// Records every audio track the page opens so a test can see whether one is still live.
const TRACK_WATCH = "window.__tracks = []; const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); s.getTracks().forEach((t) => window.__tracks.push(t)); return s; };";

test('Start on a microphone instrument with the mic blocked says so and does not run a deaf exercise', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    await page.deny(['microphone']);
    await page.clickSelector('#picker button[data-mod="gtr"]');
    await page.clickSelector('#playBtn');
    await page.waitFor("/blocked/i.test(document.getElementById('ioText').textContent)");
    assert.equal(await el(page, 'playBtn', 'textContent.trim()'), 'Start', 'no exercise started');
    assert.match(await el(page, 'coach', 'textContent'), /microphone was blocked.*Set up input.*Connect microphone/s, 'the coach says what happened and what to do');
    assert.equal(await el(page, 'prompt', 'textContent'), '', 'nothing is asked of a learner the app cannot hear');
  });
});

test('control: Start on a microphone instrument with the mic allowed asks for it, then starts', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    await page.grant(['microphone']);
    await page.clickSelector('#picker button[data-mod="gtr"]');
    await page.clickSelector('#playBtn');
    await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'");
    assert.match(await el(page, 'ioText', 'textContent'), /Listening through your microphone/);
    assert.match(await el(page, 'prompt', 'textContent'), /^Play /);
  });
});

test('switching from a microphone instrument to Keyboard closes the microphone and hides the level meter', async (t) => {
  await withAcceptancePage(t, { initScript: TRACK_WATCH }, async (page) => {
    await page.grant(['microphone']);
    await page.clickSelector('#picker button[data-mod="gtr"]');
    await page.clickSelector('#setupBtn');
    await page.clickSelector('#ioBtn');
    await page.waitFor("/Listening/.test(document.getElementById('ioText').textContent)");
    assert.deepEqual(await page.evaluate('window.__tracks.map((x) => x.readyState)'), ['live'], 'the mic is open on Guitar');
    await page.clickSelector('#navInstrument');
    await page.clickSelector('#picker button[data-mod="kbd"]');
    await page.waitFor("window.__tracks.every((x) => x.readyState === 'ended')");
    assert.equal(await el(page, 'practiceMeter', 'hidden'), true, 'no dead level meter on the Keyboard screen');
  });
});
