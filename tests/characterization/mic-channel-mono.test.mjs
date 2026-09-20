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
import { launchPage, effectiveWaitMs } from '../helpers/browser.mjs';
import { pluck, pluckChannelSwitch, writePluckWav } from '../helpers/pluck-wav.mjs';

const htmlPath = HTML_PATH;
const SR = 48000;
const FREQ = 220; // A3, comfortably inside guitar's range

function writeFixture(path, opts) {
  const buf = pluck(FREQ, SR, 3.0, { seed: 5, decay: 0.9999, brightness: 0.4, ...opts });
  writePluckWav(path, buf, SR);
}

// PR #23 CI failure (2026-09-20): a fixed 900ms wait followed by a SINGLE
// heard() read was fragile under a loaded runner. Diagnosis (src/app.js
// monoRoute() debug hook, added for this): under simulated CPU load, the
// adaptive routing itself was correct and fast in every run observed --
// gL/gR reached exact 1.000/0.000 (or 0.000/1.000) within ~330-560ms of
// mic-open, and RMS never dropped anywhere near a gate. What blipped was
// pitch detection itself: `heard().freq` intermittently read exactly 0 for
// isolated ~100ms samples on EITHER channel under stress, while RMS and
// gains stayed correct throughout (a transient clarity dropout, not a
// routing or channel-specific defect -- both left-only and right-only
// showed the same blips in the same loaded run). A single fixed-time
// sample can land on exactly one such blip; this is that failure, not a
// left/right asymmetry.
//
// Fixed by polling IN-PAGE (one CDP round trip, avoiding the Node-side
// poll-loop delay a loaded box adds on top) for freq>0 to hold across two
// consecutive ~50ms checks before trusting the reading, using the same
// wait-floor budget (`effectiveWaitMs`, tests/helpers/browser.mjs) the
// tuner lane already uses for exactly this class of flake (commit
// 5ed4d54). This does not relax what is asserted -- ratio-to-mono still
// has to hold -- it only stops a transient zero from being read as "never
// detected".
async function heardStable(wavPath) {
  const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
  try {
    await page.evaluate("window.__coach.setMod('gtr')");
    await page.evaluate("document.getElementById('ioBtn').click()");
    await page.waitFor('window.__coach.devices().length > 0', 5000);
    const budgetMs = effectiveWaitMs(8000);
    // A ratio comparison (unlike a plain freq>0 check) needs the gain RAMP
    // itself to have settled, not just a detectable pitch: monoSum()'s
    // route() calls setTargetAtTime(..., 0.02) (a ~20ms time constant), and
    // the DEFAULT 0.5/0.5 gain before the first measurement is already
    // enough for yin() to report a pitch -- so gating on freq>0 alone read
    // straight through the ramp and measured ~half level (caught here: an
    // early version of this fix regressed exactly that way, ratio ~0.5).
    // Fixed by first waiting for window.__coach.monoRoute() to report a
    // real (non-"skipped") decision, THEN an additional settle buffer (10x
    // the 0.02s time constant, comfortably past 99% convergence) before
    // trusting any reading, on top of the existing freq-stability check.
    return await page.evaluate(`(async () => {
      const start = Date.now();
      let routeSeenAt = null, stable = 0, last = null;
      while (Date.now() - start < ${budgetMs}) {
        const route = window.__coach.monoRoute();
        if (route && !route.skipped && routeSeenAt === null) routeSeenAt = Date.now();
        const rampSettled = routeSeenAt !== null && (Date.now() - routeSeenAt) >= 200;
        const h = window.__coach.heard();
        if (rampSettled && h && h.freq > 0) {
          stable++; last = h;
          if (stable >= 3) return last;
        } else {
          stable = 0;
        }
        await new Promise(r => setTimeout(r, 50));
      }
      return last || window.__coach.heard();
    })()`);
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

  const mono = await heardStable(monoPath);
  const right = await heardStable(rightPath);
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

  const mono = await heardStable(monoPath);
  const left = await heardStable(leftPath);
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

  const mono = await heardStable(monoPath);
  const dup = await heardStable(dupPath);
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
    const t1 = Date.now();

    // Before the 3s switch point: routed off the left channel. Polls
    // in-page (same reasoning as heardStable above -- a single fixed-time
    // read can land on a transient clarity-zero blip under load) but the
    // budget is a fixed 2000ms, NOT effectiveWaitMs: this has to stay
    // comfortably under the fixture's own 3s switch point regardless of
    // how high the wait floor is raised for a slow box, or it would end up
    // reading the POST-switch channel instead.
    const before = await page.evaluate(`(async () => {
      const start = Date.now();
      let stable = 0, last = null;
      while (Date.now() - start < 2000) {
        const h = window.__coach.heard();
        if (h && h.freq > 0) { stable++; last = h; if (stable >= 2) return last; }
        else { stable = 0; }
        await new Promise(r => setTimeout(r, 50));
      }
      return last || window.__coach.heard();
    })()`);
    assert.ok(before.freq > 0, `expected the left channel to be heard before the switch, got freq ${before.freq}`);

    // Past the switch point (3s): wait until at least 3.6s has ELAPSED
    // SINCE MIC-OPEN (measured, not guessed -- the before-poll above can
    // itself take anywhere from ~0ms to 2000ms depending on load, so a
    // fixed follow-up wait would either undershoot the switch point on a
    // slow run or needlessly oversleep on a fast one) before trusting any
    // reading to the right channel: solidly past both the 3s switch and at
    // least one 300ms periodic re-check. Then poll+read in ONE call
    // (rather than waitFor followed by a separate evaluate) so there is no
    // round-trip gap in which a fresh transient blip could land between
    // the check and the read.
    const elapsedMs = Date.now() - t1;
    const remainingMs = Math.max(0, 3600 - elapsedMs);
    if (remainingMs > 0) await page.evaluate(`new Promise(r => setTimeout(r, ${remainingMs}))`);
    const afterBudgetMs = effectiveWaitMs(5000);
    const after = await page.evaluate(`(async () => {
      const start = Date.now();
      let stable = 0, last = null;
      while (Date.now() - start < ${afterBudgetMs}) {
        const h = window.__coach.heard();
        if (h && h.freq > 0) { stable++; last = h; if (stable >= 2) return last; }
        else { stable = 0; }
        await new Promise(r => setTimeout(r, 50));
      }
      return last || window.__coach.heard();
    })()`);
    assert.ok(after.freq > 0, `expected routing to recover onto the right channel after the switch, got freq ${after.freq} (rms ${after.rms})`);
  } finally {
    await page.close();
  }
});
