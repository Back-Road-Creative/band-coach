// The shipped file, not the dev build: playing during Connect must not be
// learned as the room. This build has no debug hook, so it observes only what
// a learner can: the page's own text and what was saved to storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPage } from '../helpers/browser.mjs';
import { writePluckWav } from '../helpers/pluck-wav.mjs';

const RELEASE_HTML = fileURLToPath(new URL('../../dist/release/band-coach.html', import.meta.url));
const SR = 48000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('release build: a steady 110 Hz note during Connect is not stored as the room floor', async (t) => {
  const samples = new Float32Array(SR * 2);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.014 * Math.SQRT2 * Math.sin((2 * Math.PI * 110 * i) / SR); // RMS 0.014
  const wavPath = writePluckWav(join(mkdtempSync(join(tmpdir(), 'mic-cal-safe-')), 'note.wav'), samples, SR);
  const page = await launchPage(RELEASE_HTML, { fakeAudioFile: wavPath });
  t.after(() => page.close());

  await page.evaluate("document.querySelector('#picker button[data-mod=\"gtr\"]').click()");
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true", 8000);
  // Wait for a minimum time AND for the check to say it is done (it may first wait for the stream to deliver audio; a build with no "Checking the room" message would otherwise return at once), then the app's 1.2 s debounce before anything reaches storage.
  await Promise.all([sleep(2700), page.waitFor("!/Checking the room/.test(document.getElementById('calibrateResult').textContent)", 9000)]);
  await sleep(1500);

  const stored = await page.evaluate("(() => { try { const v = JSON.parse(localStorage.getItem('bandcoach.v1') || 'null'); return v && v.prefs ? (v.prefs.noiseFloor ?? null) : null; } catch (e) { return 'unreadable'; } })()");
  assert.equal(stored, null, `the shipped build saved a room floor of ${stored} while a note was playing`);
  const msg = await page.evaluate("document.getElementById('calibrateResult').textContent");
  assert.match(msg, /heard sound/i, `the learner is told what the check heard (got "${msg}")`);
  assert.match(msg, /Check my microphone/);
  assert.ok(await page.evaluate("document.getElementById('calibrateResult').getClientRects().length > 0"), 'the message is visible');
});
