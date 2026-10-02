// A learner who never finds "Check my microphone" used to be judged against
// fixed gates tuned for a loud mic. Connect now measures the room once (about
// 1.5 s) when no floor is stored, and the gates follow it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { pluck, writePluckWav } from '../helpers/pluck-wav.mjs';

const SR = 48000;

test('Connect measures the room once, stores prefs.noiseFloor and moves the gates off the defaults', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mic-connect-cal-'));
  const wavPath = join(dir, 'room.wav');
  writePluckWav(wavPath, pluck(110, SR, 6.0, { seed: 3, gain: 0.0003 }), SR); // a very quiet room
  const page = await launchPage(HTML_PATH, { fakeAudioFile: wavPath });
  t.after(() => page.close());

  assert.equal(await page.evaluate('window.__coach.db().prefs.noiseFloor'), null, 'nothing stored before Connect');
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('Number.isFinite(window.__coach.db().prefs.noiseFloor)', 6000);

  const floor = await page.evaluate('window.__coach.db().prefs.noiseFloor');
  const g = await page.evaluate('window.__coach.gates()');
  assert.ok(floor >= 0 && floor < 0.003, `expected a quiet-room floor, got ${floor}`);
  assert.ok(Math.abs(g.pitch - Math.max(floor, 0.0015) * 3) < 1e-9, `gates.pitch ${g.pitch} should follow floor ${floor}`);
  assert.ok(g.pitch < 0.004 + 1e-9 || g.pitch >= 0.0045 - 1e-9, 'gates moved off the stock numbers');
});

test('Connect shows the level meter on the practice screen while a mic instrument is listening', async (t) => {
  const page = await launchPage(HTML_PATH, { fakeAudioFile: (() => { const d = mkdtempSync(join(tmpdir(), 'mic-connect-meter-')); const p = join(d, 'p.wav'); writePluckWav(p, pluck(110, SR, 6.0, { seed: 3, gain: 0.05 }), SR); return p; })() });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.devices().length > 0', 5000);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor("!document.getElementById('practiceMeter').hidden", 6000);
  await page.waitFor("parseFloat(document.getElementById('practiceLevelFill').style.width) > 0", 6000);
});
