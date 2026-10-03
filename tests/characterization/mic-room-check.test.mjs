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
import { mkdtempSync, readFileSync } from 'node:fs';
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
// Unpitched noise hits (drums), one a second, with exact silence between. Every 0.4 s the analyser sees a hit in about half its frames (a 0.12 s hit plus the 85 ms it stays in the window): a loaded box that samples unevenly could tip that over the 60 % where the window's floor stops being 0 and the hits stop reading as bursts (stress run: 2 of 30 T7c failed). One a second is a hit in about a fifth of the frames.
function noiseBursts(peak, secs) { const r = lcg(11), b = new Float32Array(Math.round(SR * secs)), n = Math.round(0.12 * SR); for (let at = 0; at + n < b.length; at += Math.round(1.0 * SR)) for (let i = 0; i < n; i++) b[at + i] = r() * Math.exp(-i / (n / 4)); return scaleToPeak(b, peak); }
// A string plucked every `period` s, each ringing down before the next. The default (0.7 s, slow ring-down) sits near the burst threshold of a 3 s window: a loaded box that samples late or stalls could tip it over (simulated: peak/floor 2.7 at worst against the rule's 3). `playing` is the sturdy one for scenarios that must read as playing: peak/floor 5.7 at worst under the same simulated load.
function pluckTrain(peak, secs, period = 0.7, decay = 0.98) { const b = new Float32Array(Math.round(SR * secs)), step = Math.round(period * SR); for (let k = 0, at = 0; at < b.length; k++, at += step) { const p = pluck(110, SR, period, { seed: 5 + k, decay }); b.set(p.subarray(0, Math.min(p.length, b.length - at)), at); } return scaleToPeak(b, peak); }
const playing = () => pluckTrain(0.005, 4, 1.0, 0.975);
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

// The check ends when it says so, not after a fixed time: it first waits up to 3 s for the stream to deliver
// audio, then listens 1.5 s (auto) or 3 s (manual), so a slow start moves the end by seconds.
const checkDone = (page) => page.waitFor("!/Checking the room/.test(document.getElementById('calibrateResult').textContent)", 9000);
const manualDone = (page) => page.waitFor("!/Listening for/.test(document.getElementById('calibrateResult').textContent)", 12000);

async function assertAutoAbstained(page, what) {
  // Wait for a minimum time AND the outcome: a build with no "Checking the room" message (base) would otherwise return at once and read the floor before the 1.5 s check has written anything.
  await Promise.all([sleep(2600), checkDone(page)]);
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

test('T2c: drum hits that arrive after more than a second of exact zeros are still not learned as the room', async (t) => {
  // A slow-starting stream: 1.5 s of nothing, then playing. The check waits for the audio, so it ends after
  // about 3 s here, past a fixed 2.6 s sleep; it must still hear the hits and abstain, not store a floor of 0.
  const hits = noiseBursts(0.01, 4), buf = new Float32Array(Math.round(1.5 * SR) + hits.length);
  buf.set(hits, Math.round(1.5 * SR));
  const page = await connect(t, buf);
  await assertAutoAbstained(page, 'drum hits after a 1.5 s zero lead');
});

test('T4: steady unpitched noise is the room: the floor is stored and the noisy message is shown', async (t) => {
  const page = await connect(t, steadyNoise(0.004, 2));
  await page.waitFor('Number.isFinite(window.__coach.db().prefs.noiseFloor)', 6000);
  const floor = await floorOf(page);
  assert.ok(floor > 0.003 && floor < 0.005, `floor ${floor}`);
  assert.match(await resultText(page), /a lot of background noise/, 'the outcome is shown');
  assert.equal(await page.evaluate('window.__coach.db().prefs.noiseFloorV'), 2, 'the floor carries the current check version');
});

// A stream that has not delivered audio reads exactly 0, which a real microphone never does. A window of
// those is no reading: it must not be stored as "your room is quiet" (it stopped the check ever running again).
const digitalSilence = (secs) => new Float32Array(Math.round(SR * secs));
const noReading = /Could not get a reading/;

test('digital silence during Connect is no reading: nothing stored, defaults kept, the learner is told', async (t) => {
  const page = await connect(t, digitalSilence(4));
  await checkDone(page);
  const floor = await floorOf(page), msg = await resultText(page);
  assert.equal(floor, null, `an all-zero window stored a floor of ${floor} (the app said "${msg}")`);
  assert.deepEqual(await page.evaluate('window.__coach.gates()'), DEFAULT_GATES);
  assert.match(msg, noReading, msg);
  assert.match(msg, /Check my microphone/);
  assert.ok(await resultVisible(page));
});

test('a stream that starts with exact zeros and then delivers a quiet room still has its room learned', async (t) => {
  // 1.2 s of nothing (under the app\'s wait for audio), then steady noise: the window must open when the noise arrives.
  const lead = digitalSilence(1.2), room = steadyNoise(0.004, 6), buf = new Float32Array(lead.length + room.length);
  buf.set(room, lead.length);
  const page = await connect(t, buf);
  await checkDone(page);
  const floor = await floorOf(page);
  assert.ok(floor > 0.003 && floor < 0.005, `floor ${floor}, "${await resultText(page)}"`);
  assert.match(await resultText(page), /a lot of background noise/);
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
  const page = await connect(t, playing());
  await checkDone(page); // audio is flowing and the background check is over: the manual window is the only reader
  await pressCheck(page);
  assert.match(await resultText(page), /Listening for 3 seconds/);
  await manualDone(page);
  assert.equal(await floorOf(page), null, 'a manual check that heard playing must store nothing');
  assert.deepEqual(await page.evaluate('window.__coach.gates()'), DEFAULT_GATES);
  const msg = await resultText(page);
  assert.match(msg, /heard playing/i, msg);
  assert.match(msg, /silence/i, msg);
});

test('T7c: a manual check on a slow-starting stream still hears the playing that follows', async (t) => {
  // Drum hits, not plucks: a quiet pluck train sits near the manual check's burst threshold, so which phase the 3 s window lands on decides it; hits are unambiguous.
  const hits = noiseBursts(0.01, 4), buf = new Float32Array(Math.round(1.5 * SR) + hits.length); // 1.5 s of nothing: under the 3 s wait, past what a fixed 3.8 s sleep covers
  buf.set(hits, Math.round(1.5 * SR));
  const page = await connect(t, buf);
  await pressCheck(page);
  await manualDone(page);
  assert.equal(await floorOf(page), null, 'a manual check that heard playing must store nothing');
  const msg = await resultText(page);
  assert.match(msg, /heard playing/i, msg);
});

// Makes the room check's own analyser read throw once. The page has other analyser readers, so the throw is armed only for a call made from inside listenRoom, found by the line numbers of that function in the built file (an interval callback has no name in a stack).
const lineOf = (needle) => readFileSync(HTML_PATH, 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1;
async function throwOnceInCheck(page) {
  const lo = lineOf('async function listenRoom'), hi = lineOf('return { frames, fresh');
  assert.ok(lo > 0 && hi > lo, 'listenRoom must be found in the built file');
  await page.evaluate(`(() => { const orig = AnalyserNode.prototype.getFloatTimeDomainData; let armed = true; AnalyserNode.prototype.getFloatTimeDomainData = function (b) { if (armed && (new Error().stack.match(/:(\\d+):\\d+/g) || []).some((m) => { const n = Number(m.split(':')[1]); return n >= ${lo} && n <= ${hi}; })) { armed = false; throw new Error('probe: analyser read failed'); } return orig.call(this, b); }; })()`);
}

test('T7d: a check that fails while listening says so, apart from "no reading", and stores nothing', async (t) => {
  const page = await connect(t, playing()); // abstains in the background check, so nothing is stored before the manual one
  await checkDone(page); // the background check reads the same analyser: let it finish so the throw lands in the manual check
  await throwOnceInCheck(page);
  const before = await resultText(page);
  await pressCheck(page);
  await page.waitFor(`(t => t !== ${JSON.stringify(before)} && !/Listening for/.test(t))(document.getElementById('calibrateResult').textContent)`, 6000); // the check's own outcome, not the background check's text still on screen
  const msg = await resultText(page);
  assert.match(msg, /went wrong/i, msg);
  assert.doesNotMatch(msg, /Could not get a reading/, 'an error while listening is not the same as no audio arriving: ' + msg);
  assert.equal(await floorOf(page), null);
});

test('T7e: a stale check that failed never writes over a newer check\'s message', async (t) => {
  const page = await connect(t, playing());
  await checkDone(page);
  await throwOnceInCheck(page);
  // Both presses in one task: A starts first (and its first read throws), B supersedes it.
  await page.evaluate("(() => { const b = document.getElementById('calibrateBtn'); b.click(); b.click(); })()");
  await sleep(400);
  const msg = await resultText(page);
  assert.match(msg, /Listening for 3 seconds/, `the failed older check wrote "${msg}" over the check that is still running`);
  await manualDone(page);
  assert.match(await resultText(page), /heard playing/i, 'the newer check runs to its own outcome');
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

// Connect's background check when its own read fails, and drum hits over a faint bed.
const ROOM_ERROR_TEXT = 'Something went wrong while listening to the microphone, so the standard settings are in use. Press "Check my microphone" to try again.';
// The bed sits under MIN_FLOOR (levels.js) and far under a third of the hits' peak (BURST_RATIO 3), so the hits still read as bursts.
const withBed = (buf, rms) => { const bed = steadyNoise(rms, buf.length / SR); return buf.map((x, i) => x + bed[i]); };
// Like `connect`, but the one-shot analyser throw is armed before Connect, so it lands in the background check. With `rival`, a manual check starts the moment the background one says it is checking (a microtask of the same task, before the first 50 ms tick), superseding it.
async function connectArmed(t, samples, { rival = false } = {}) {
  const page = await launchPage(HTML_PATH, { fakeAudioFile: wav('room', samples) });
  t.after(() => page.close());
  await throwOnceInCheck(page);
  if (rival) await page.evaluate("(() => { const el = document.getElementById('calibrateResult'); const mo = new MutationObserver(() => { if (/Checking the room/.test(el.textContent)) { mo.disconnect(); document.getElementById('calibrateBtn').click(); } }); mo.observe(el, { childList: true, characterData: true, subtree: true }); })()");
  await page.evaluate("document.querySelector('#picker button[data-mod=\"gtr\"]').click()");
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor('window.__coach.micOpen()', 8000);
  return page;
}

test('T7f: a failure in the background check shows the error and stores nothing', async (t) => {
  const page = await connectArmed(t, quietRoom()); // a quiet room that would store a floor (T6), so a build that swallows the throw and carries on is caught
  await Promise.all([sleep(2600), checkDone(page)]); // checkDone alone resolves at once: the result starts empty
  assert.equal(await resultText(page), ROOM_ERROR_TEXT, 'a check that failed says so, apart from a blank or "no reading"');
  assert.ok(await resultVisible(page), 'the check result must be visible in the open setup sheet');
  assert.equal(await floorOf(page), null);
  assert.deepEqual(await page.evaluate('window.__coach.gates()'), DEFAULT_GATES);
});

test('T7g: a background check that failed never writes over the newer check that superseded it', async (t) => {
  const page = await connectArmed(t, quietRoom(), { rival: true });
  await sleep(400);
  const msg = await resultText(page);
  assert.match(msg, /Listening for 3 seconds/, `the failed background check wrote "${msg}" over the check that is still running`);
  await manualDone(page);
  assert.match(await resultText(page), /room is quiet/, 'the newer check runs to its own outcome');
});

test('T2d: drum hits over a faint steady bed are not learned as the bed', async (t) => {
  const page = await connect(t, withBed(noiseBursts(0.01, 4), 0.0005));
  await assertAutoAbstained(page, 'drum hits over a bed at RMS 0.0005');
});
