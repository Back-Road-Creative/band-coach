// VERIFIED DEFECT 3 (mic-gate-and-capture): openMic() requested no
// channelCount, and the browser's own default stereo->mono downmix behaviour
// is not something this app controls. Measured directly against this
// repo's own headless Chromium: with no channelCount constraint, a signal
// that exists ONLY on the right channel of a 2-channel fake device was
// SILENCED entirely (RMS 0, no pitch), not merely halved.
//
// A first fix used a FIXED (L+R)*0.5 sum, which stopped the silencing but
// left a one-sided interface at HALF a true mono capture's level -- on an
// already-quiet instrument, half level can still sit under the calibrated
// gate, so that was a defect of its own, not an acceptable tradeoff. This
// file now proves the adaptive fix: monoSum() in src/app.js measures each
// channel's own RMS after a short settle window and periodically after,
// routes a channel carrying (comfortably) no signal of its own OUT
// entirely, and averages 0.5/0.5 only when both sides carry comparable
// energy -- so a one-sided interface reaches the SAME level as a true mono
// capture, and a duplicated-mono interface (the same signal on both
// channels) never doubles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { pluck, pluckChannelSwitch, writePluckWav } from '../helpers/pluck-wav.mjs';

const htmlPath = HTML_PATH;
const SR = 48000;
const FREQ = 220; // A3, comfortably inside guitar's range

function writeFixture(path, opts) {
  const buf = pluck(FREQ, SR, 3.0, { seed: 5, decay: 0.9999, brightness: 0.4, ...opts });
  writePluckWav(path, buf, SR);
}

// Reads window.__coach.heard() a fixed 900ms after the mic opens: long
// enough for monoSum()'s 150ms settle window PLUS at least one 300ms
// periodic re-check to have run and converged (measured directly -- see
// this file's FINAL REPORT numbers), short enough that the fixture (3s,
// decay 0.9999) is still comfortably above every gate.
async function heardAt900ms(wavPath) {
  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
  try {
    await page.evaluate("window.__coach.setMod('gtr')");
    await page.evaluate("document.getElementById('ioBtn').click()");
    await page.waitFor('window.__coach.devices().length > 0', 5000);
    await page.evaluate('new Promise(r => setTimeout(r, 900))');
    return await page.evaluate('window.__coach.heard()');
  } finally {
    await page.close();
  }
}

// Names the guarantee CLAUDE.md's coordinator asked to have stated
// explicitly: `channelCount: { ideal: 2 }` (src/app.js openMic()) is an
// IDEAL constraint, which the WebRTC spec defines as never causing
// getUserMedia to reject a device that cannot satisfy it -- only `exact`
// (or min/max) constraints can produce OverconstrainedError. This proves it
// empirically too: a genuinely MONO source file, asked for with
// channelCount ideal 2, still opens successfully and delivers real
// (non-silent, correctly pitched) audio -- neither rejected nor silenced.
test('channelCount: { ideal: 2 } does not reject or silence a mono-only capture', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mic-channel-mono-'));
  const wavPath = join(dir, 'mono-only.wav');
  writeFixture(wavPath, {}); // mono WAV -- the underlying "device" only has one channel to offer

  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
  try {
    await page.evaluate("window.__coach.setMod('gtr')");
    let threw = null;
    try { await page.evaluate("document.getElementById('ioBtn').click()"); await page.waitFor('window.__coach.devices().length > 0', 5000); }
    catch (e) { threw = e; }
    assert.equal(threw, null, 'opening a mono-only capture with channelCount ideal 2 must not throw/reject');
    await page.waitFor('window.__coach.heard() && window.__coach.heard().freq > 0', 8000);
    const heard = await page.evaluate('window.__coach.heard()');
    assert.ok(heard.freq > 0, `expected the mono-only capture to be heard, not silenced, got freq ${heard.freq}`);
  } finally {
    await page.close();
  }
});

test('a guitar plugged into only the right channel of a 2-channel interface is heard at the SAME level as mono', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mic-channel-mono-'));
  const monoPath = join(dir, 'mono.wav');
  const rightPath = join(dir, 'right-only.wav');
  writeFixture(monoPath, {});
  writeFixture(rightPath, { channels: 'stereo', channelSide: 'right' });

  const mono = await heardAt900ms(monoPath);
  const right = await heardAt900ms(rightPath);
  assert.ok(right.freq > 0, `expected a detected pitch from the right-only channel, got freq ${right.freq}`);
  const ratio = right.rms / mono.rms;
  assert.ok(ratio > 0.75 && ratio < 1.3, `expected the right-only capture's level to match mono (ratio ~1), got ratio ${ratio} (mono ${mono.rms}, right-only ${right.rms})`);
});

test('a guitar plugged into only the left channel of a 2-channel interface is also heard at the SAME level as mono', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mic-channel-mono-'));
  const monoPath = join(dir, 'mono.wav');
  const leftPath = join(dir, 'left-only.wav');
  writeFixture(monoPath, {});
  writeFixture(leftPath, { channels: 'stereo', channelSide: 'left' });

  const mono = await heardAt900ms(monoPath);
  const left = await heardAt900ms(leftPath);
  assert.ok(left.freq > 0, `expected a detected pitch from the left-only channel, got freq ${left.freq}`);
  const ratio = left.rms / mono.rms;
  assert.ok(ratio > 0.75 && ratio < 1.3, `expected the left-only capture's level to match mono (ratio ~1), got ratio ${ratio} (mono ${mono.rms}, left-only ${left.rms})`);
});

// Regression: a 1.0/1.0 unconditional sum (rejected in this unit's own
// design notes) would DOUBLE a duplicated-mono interface's level. The
// adaptive routing must classify comparable L/R energy as "both carrying
// signal" and average 0.5/0.5, exactly like a genuine stereo signal would,
// so a duplicated-mono source reads the SAME as before -- never doubled.
test('a duplicated-mono interface (same signal on both channels) does not get louder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mic-channel-mono-'));
  const monoPath = join(dir, 'mono.wav');
  const dupPath = join(dir, 'duplicated.wav');
  writeFixture(monoPath, {});
  writeFixture(dupPath, { channels: 'stereo', channelSide: 'both' });

  const mono = await heardAt900ms(monoPath);
  const dup = await heardAt900ms(dupPath);
  const ratio = dup.rms / mono.rms;
  assert.ok(ratio > 0.75 && ratio < 1.3, `expected duplicated-mono to read the SAME as mono (ratio ~1), got ratio ${ratio} (mono ${mono.rms}, duplicated ${dup.rms}) -- a ratio near 2 would mean the sum doubled it`);
});

// A channel falling silent mid-session (a cable re-patched, an interface
// input switched) must be noticed by the periodic re-check, not just the
// one-time decision made when the mic first opened.
test('routing recovers when the live channel switches mid-session (a cable re-patch)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mic-channel-mono-'));
  const wavPath = join(dir, 'switch.wav');
  const buf = pluckChannelSwitch(FREQ, SR, 6.0, 3.0, { seed: 5, decay: 0.99995, brightness: 0.4, firstSide: 'left' });
  writePluckWav(wavPath, buf, SR);

  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
  try {
    await page.evaluate("window.__coach.setMod('gtr')");
    await page.evaluate("document.getElementById('ioBtn').click()");
    await page.waitFor('window.__coach.devices().length > 0', 5000);

    // Before the 3s switch point: routed off the left channel.
    await page.evaluate('new Promise(r => setTimeout(r, 1500))');
    const before = await page.evaluate('window.__coach.heard()');
    assert.ok(before.freq > 0, `expected the left channel to be heard before the switch, got freq ${before.freq}`);

    // Past the switch point (3s) plus enough time for the periodic re-check
    // (every 300ms) to notice the left channel went silent and route the
    // right channel instead.
    await page.evaluate('new Promise(r => setTimeout(r, 2200))'); // now ~3.7s into the fixture
    await page.waitFor('window.__coach.heard() && window.__coach.heard().freq > 0', 5000);
    const after = await page.evaluate('window.__coach.heard()');
    assert.ok(after.freq > 0, `expected routing to recover onto the right channel after the switch, got freq ${after.freq} (rms ${after.rms})`);
  } finally {
    await page.close();
  }
});
