// The room check must never learn PLAYING as room noise. A floor learned from
// playing sits under the gates it then sets, so the learner's own notes stop
// registering. Connect's background check and "Check my microphone" now both
// abstain on playing-like sound, say so in #calibrateResult, and discard a
// reading that finishes after the input device changed.
//
// Fixtures are generated here (never read from the audit directory). The fake
// microphone loops the WAV, so every scenario is built to be classified the
// same whatever part of the loop the check lands on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { pluck, writePluckWav } from '../helpers/pluck-wav.mjs';

const SR = 48000;
const DEFAULT_GATES = { pitch: 0.004, note: 0.005, chord: 0.006 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
// Highest RMS over any 4096-sample window (what the app's analyser sees).
function peakRms(buf) { let pk = 0; for (let a = 0; a + 4096 <= buf.length; a += 512) { let s = 0; for (let i = a; i < a + 4096; i++) s += buf[i] * buf[i]; pk = Math.max(pk, Math.sqrt(s / 4096)); } return pk; }
const scaleToPeak = (buf, target) => { const g = target / peakRms(buf); return buf.map((x) => x * g); };
const sine = (hz, rms, secs) => { const b = new Float32Array(Math.round(SR * secs)); for (let i = 0; i < b.length; i++) b[i] = rms * Math.SQRT2 * Math.sin((2 * Math.PI * hz * i) / SR); return b; };
function steadyNoise(rms, secs) { const r = lcg(7), b = new Float32Array(Math.round(SR * secs)); let s = 0; for (let i = 0; i < b.length; i++) { b[i] = r(); s += b[i] * b[i]; } const g = rms / Math.sqrt(s / b.length); return b.map((x) => x * g); }
// Unpitched noise hits (drums) every 0.4 s.
function noiseBursts(peak, secs) { const r = lcg(11), b = new Float32Array(Math.round(SR * secs)), n = Math.round(0.12 * SR); for (let at = 0; at + n < b.length; at += Math.round(0.4 * SR)) for (let i = 0; i < n; i++) b[at + i] = r() * Math.exp(-i / (n / 4)); return scaleToPeak(b, peak); }
// A string plucked every 0.7 s, each ringing down before the next.
function pluckTrain(peak, secs) { const b = new Float32Array(Math.round(SR * secs)), period = Math.round(0.7 * SR); for (let k = 0, at = 0; at < b.length; k++, at += period) { const p = pluck(110, SR, 0.7, { seed: 5 + k, decay: 0.98 }); b.set(p.subarray(0, Math.min(p.length, b.length - at)), at); } return scaleToPeak(b, peak); }
const quietRoom = () => pluck(110, SR, 6.0, { seed: 3, gain: 0.0003 }); // as mic-connect-calibrates

const wav = (name, samples) => writePluckWav(join(mkdtempSync(join(tmpdir(), 'mic-room-')), name + '.wav'), samples, SR);

// Records each time the stored floor goes from nothing to a number, on the
// page's own clock, so a test can say WHEN a floor was written.
const FLOOR_WATCH = `
  window.__floorSets = []; window.__lastFloor = null;
  setInterval(() => { try { const f = window.__coach.db().prefs.noiseFloor; if (f != null && window.__lastFloor == null) window.__floorSets.push(performance.now()); window.__lastFloor = f; } catch (e) {} }, 20);
`;

async function connect(t, samples, { watch = false } = {}) {
  const page = await launchPage(HTML_PATH, { fakeAudioFile: wav('room', samples), initScript: watch ? FLOOR_WATCH : undefined });
  t.after(() => page.close());
  await page.evaluate("document.querySelector('#picker button[data-mod=\"gtr\"]').click()");
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.micOpen()', 8000);
  return page;
}
const floorOf = (page) => page.evaluate('window.__coach.db().prefs.noiseFloor');
const resultText = (page) => page.evaluate("document.getElementById('calibrateResult').textContent");
const resultVisible = (page) => page.evaluate("(() => { const el = document.getElementById('calibrateResult'); return !document.getElementById('setupSheet').hidden && el.getClientRects().length > 0; })()");

async function assertAutoAbstained(page, what) {
  await sleep(2600); // the 1.5 s check window plus slack
  const floor = await floorOf(page);
  assert.equal(floor, null, `${what}: the room check stored a floor of ${floor} while someone was playing`);
  assert.deepEqual(await page.evaluate('window.__coach.gates()'), DEFAULT_GATES, `${what}: gates must stay at the defaults`);
  const msg = await resultText(page);
  assert.ok(await resultVisible(page), 'the check result must be visible in the open setup sheet');
  assert.match(msg, /heard sound/i, `${what}: the learner is told what the check heard (got "${msg}")`);
  assert.match(msg, /standard settings/i);
  assert.match(msg, /Check my microphone/);
}

test('T1: playing a steady note while Connect checks the room stores nothing and says so', async (t) => {
  const page = await connect(t, sine(110, 0.014, 2));
  await assertAutoAbstained(page, 'sine 110 Hz at RMS 0.014');
});

test('T2: a quiet pluck train during Connect is not learned as the room', async (t) => {
  const page = await connect(t, pluckTrain(0.005, 4.2));
  await assertAutoAbstained(page, 'quiet pluck train');
});

test('T2b: drum-like noise bursts during Connect are not learned as the room', async (t) => {
  const page = await connect(t, noiseBursts(0.01, 4));
  await assertAutoAbstained(page, 'drum hits');
});

test('T4: steady unpitched noise is the room: the floor is stored and the noisy message is shown', async (t) => {
  const page = await connect(t, steadyNoise(0.004, 2));
  await page.waitFor('Number.isFinite(window.__coach.db().prefs.noiseFloor)', 6000);
  const floor = await floorOf(page);
  assert.ok(floor > 0.003 && floor < 0.005, `floor ${floor}`);
  assert.match(await resultText(page), /a lot of background noise/, 'the outcome is shown');
  assert.equal(await page.evaluate('window.__coach.db().prefs.noiseFloorV'), 2, 'the floor carries the current check version');
});

test('the background check announces itself while it listens', async (t) => {
  const page = await connect(t, sine(110, 0.014, 2));
  assert.match(await resultText(page), /Checking the room/i);
});

test('T5: a device switch while the background check runs never lets the first reading count for the new device', async (t) => {
  const page = await connect(t, quietRoom(), { watch: true });
  await page.waitFor('window.__coach.devices().length > 1', 5000);
  const ids = await page.evaluate('window.__coach.devices().map(d => d.deviceId)');
  await sleep(400); // part-way through the 1.5 s window
  const switchedAt = await page.evaluate(`(() => { const t = performance.now(), sel = document.getElementById('micDeviceSelect'); sel.value = ${JSON.stringify(ids[1])}; sel.dispatchEvent(new Event('change')); return t; })()`);
  await page.waitFor('window.__floorSets.length > 0', 8000);
  const [first] = await page.evaluate('window.__floorSets');
  assert.ok(first - switchedAt >= 1300, `a floor was written ${Math.round(first - switchedAt)} ms after the switch: that is the old device's reading, the new device needs its own 1.5 s check`);
});

test('T6: a device change clears the stored floor and the new device gets its own check', async (t) => {
  const page = await connect(t, quietRoom());
  await page.waitFor('Number.isFinite(window.__coach.db().prefs.noiseFloor)', 6000);
  await page.waitFor('window.__coach.devices().length > 1', 5000);
  const ids = await page.evaluate('window.__coach.devices().map(d => d.deviceId)');
  await page.evaluate(`(() => { const sel = document.getElementById('micDeviceSelect'); sel.value = ${JSON.stringify(ids[1])}; sel.dispatchEvent(new Event('change')); })()`);
  assert.equal(await floorOf(page), null, 'the old device\'s floor must not carry over to the new one');
  assert.deepEqual(await page.evaluate('window.__coach.gates()'), DEFAULT_GATES);
  assert.equal(await page.evaluate('window.__coach.db().prefs.noiseFloorV'), null, 'its marker goes with it');
  await page.waitFor('Number.isFinite(window.__coach.db().prefs.noiseFloor)', 6000);
  assert.equal(await page.evaluate('window.__coach.db().prefs.noiseFloorV'), 2);
  assert.match(await resultText(page), /room is quiet/);
});

async function pressCheck(page) { await page.evaluate("document.getElementById('calibrateBtn').click()"); }

test('T7: "Check my microphone" while playing stores nothing and asks for silence', async (t) => {
  const page = await connect(t, pluckTrain(0.005, 4.2));
  await pressCheck(page);
  assert.match(await resultText(page), /Listening for 3 seconds/);
  await sleep(3800);
  assert.equal(await floorOf(page), null, 'a manual check that heard playing must store nothing');
  assert.deepEqual(await page.evaluate('window.__coach.gates()'), DEFAULT_GATES);
  const msg = await resultText(page);
  assert.match(msg, /heard playing/i, msg);
  assert.match(msg, /silence/i, msg);
});

test('T7b: a manual check supersedes the background check, so nothing is written twice', async (t) => {
  const page = await connect(t, quietRoom());
  await pressCheck(page);
  await sleep(2300); // past the 1.5 s the background check would have taken
  assert.equal(await floorOf(page), null, 'the superseded background check must not write');
  assert.match(await resultText(page), /Listening for 3 seconds/, 'the manual check\'s message must not be overwritten');
  await page.waitFor('Number.isFinite(window.__coach.db().prefs.noiseFloor)', 6000);
  assert.match(await resultText(page), /room is quiet/);
});

test('T8: a manual check interrupted by a device switch discards its result and says so', async (t) => {
  const page = await connect(t, quietRoom(), { watch: true });
  await page.waitFor('window.__coach.devices().length > 1', 5000);
  const ids = await page.evaluate('window.__coach.devices().map(d => d.deviceId)');
  await pressCheck(page);
  await sleep(500);
  const switchedAt = await page.evaluate(`(() => { const t = performance.now(), sel = document.getElementById('micDeviceSelect'); sel.value = ${JSON.stringify(ids[1])}; sel.dispatchEvent(new Event('change')); return t; })()`);
  await page.waitFor("/interrupted/i.test(document.getElementById('calibrateResult').textContent)", 6000);
  await page.waitFor('window.__floorSets.length > 0', 6000);
  const [first] = await page.evaluate('window.__floorSets');
  assert.ok(first - switchedAt >= 1300, `a floor was written ${Math.round(first - switchedAt)} ms after the switch, before the new device's own check could finish`);
});

test('T8b: a stale interrupted check never writes over a newer manual check\'s message', async (t) => {
  const page = await connect(t, quietRoom());
  await page.waitFor('window.__coach.devices().length > 1', 5000);
  const ids = await page.evaluate('window.__coach.devices().map(d => d.deviceId)');
  const t0 = Date.now();
  await pressCheck(page); // A, interrupted by the switch below
  await sleep(500);
  await page.evaluate(`(() => { const sel = document.getElementById('micDeviceSelect'); sel.value = ${JSON.stringify(ids[1])}; sel.dispatchEvent(new Event('change')); })()`);
  await sleep(500);
  await pressCheck(page); // B, started on the new device and still listening when A finishes
  await sleep(Math.max(0, 3500 - (Date.now() - t0))); // A's 3 s window has ended; B's has not
  const mid = await resultText(page);
  assert.match(mid, /Listening/, `the stale check wrote "${mid}" over the check that is still running`);
  await page.waitFor("/room is quiet/i.test(document.getElementById('calibrateResult').textContent)", 6000);
});

const STORE_KEY = 'bandcoach.v1';
async function loadWithPrefs(t, prefs) {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate(`localStorage.setItem(${JSON.stringify(STORE_KEY)}, ${JSON.stringify(JSON.stringify({ v: 1, mods: {}, sessions: [], prefs: { mod: 'gtr', ...prefs } }))})`);
  await page.reload();
  await page.waitFor('typeof window.__coach !== "undefined"', 8000);
  await page.waitFor('window.__coach.db().mods.gtr', 5000);
  return page;
}

test('T9: a stored floor without the current marker is dropped on load, one with it is kept', async (t) => {
  const old = await loadWithPrefs(t, { noiseFloor: 0.01 });
  assert.equal(await floorOf(old), null, 'a floor stored before the check could abstain may have learned playing');
  assert.deepEqual(await old.evaluate('window.__coach.gates()'), DEFAULT_GATES);
  const current = await loadWithPrefs(t, { noiseFloor: 0.01, noiseFloorV: 2 });
  assert.equal(await floorOf(current), 0.01);
  assert.ok(Math.abs((await current.evaluate('window.__coach.gates()')).pitch - 0.03) < 1e-9);
});

test('T9b: an old backup\'s floor is dropped when its progress file is imported', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const envelope = (prefs) => JSON.stringify({ format: 'band-coach-progress', formatVersion: 1, appVersion: 'test', exportedAt: new Date().toISOString(), db: { v: 1, mods: {}, sessions: [], prefs: { mod: 'gtr', ...prefs } } });
  await page.evaluate(`window.__coach.importProgress(${JSON.stringify(envelope({ noiseFloor: 0.01 }))})`);
  assert.equal(await floorOf(page), null);
  await page.evaluate(`window.__coach.importProgress(${JSON.stringify(envelope({ noiseFloor: 0.01, noiseFloorV: 2 }))})`);
  assert.equal(await floorOf(page), 0.01);
});
