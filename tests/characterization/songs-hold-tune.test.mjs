// Songs panel hold/tune coaching (Wave E, unit E3): on a sustaining
// instrument (family bowed/wind/free-reed/voice -- src/audio/voices.js
// recipeForFamily === 'sustain') a pitch-bearing practice step now also
// requires actually HOLDING the note and playing it in tune
// (src/song/lesson.js's HOLD_MIN_DURATION_SCORE/TUNE_MAX_MEAN_ABS_CENTS),
// and a step that fails ONLY on that says so in plain words
// (src/ui/songs/practice.js holdTuneFeedback(), wired in src/ui/songs.js).
//
// Drives the REAL mic-listening path through a fake microphone playing a
// synthesized WAV, the same technique tests/characterization/tuner-holds.test.mjs
// uses -- this is the one class of assertion window.__coach cannot prove
// (it only forwards discrete key/MIDI notes, never durSec/cents; see
// src/ui/songs.js's own header comment), so a real capture is the only way
// to show the shipped app actually coaches holding a note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, retryFlaky } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// midi 60 (C4) -- inside Voice's mic range (48-72, src/instruments/voice.js).
const TARGET_MIDI = 60;
const TARGET_FREQ = 440 * Math.pow(2, (TARGET_MIDI - 69) / 12);

// One custom song, ONE phrase, ONE note -- deliberately as small as buildLessonPlan
// allows, so this test only has to get one pitch right, not a whole phrase in
// order, and can isolate "held too short" from every other way a step can fail.
// bpm 100, a whole note (1920 ticks = 4 beats) -- practice.js's default
// durationTolerance (0.6-1.5x) means it must be held 1.44-3.6s to count as
// held right; the WAV below never holds a pulse anywhere near that long.
function challengeJson() {
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'Hold Tune Challenge',
    from: null,
    note: null,
    songs: [{
      schema: 'song/1', id: 'hold-tune-song', title: 'Hold Tune Song', composer: null, licence: null, source: null,
      key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
      parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: TARGET_MIDI }] }],
      chords: []
    }]
  });
}

// Pure-Node 16-bit PCM mono WAV writer (no deps), same technique as
// tests/characterization/tuner-holds.test.mjs's writeEnvelopedWav.
function writeWav(path, { seconds, freq, sampleRate = 48000, envelopeAt }) {
  const numSamples = Math.round(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = envelopeAt(t);
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.85 * env;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}

// A short, repeating "clipped" pulse: 5ms attack, 80ms flat, 5ms release,
// then 40ms silence -- period 130ms. Repeating for the WHOLE file (not just
// once) means whenever a "Your turn" recording starts, an onset the app can
// detect is never more than ~130ms away, regardless of the real-world
// latency between the click and the fake microphone actually being open
// (see src/app.js openMic()'s early-return-once-ready -- the FIRST open has
// real getUserMedia latency the test cannot pin down exactly, later ones do
// not). Every single pulse is far too short to read as "held" against this
// song's 1.44-3.6s band, so the SAME file drives both the rhythm step (any
// one clean-enough pulse passes hitRate/timing) and the pitches step (the
// hold assertion this test exists for).
function writePulseTrainWav(path) {
  const period = 0.13, active = 0.09, attack = 0.005, release = 0.005;
  return writeWav(path, {
    seconds: 20, freq: TARGET_FREQ,
    envelopeAt: (t) => {
      const phase = t % period;
      if (phase >= active) return 0;
      if (phase < attack) return phase / attack;
      if (phase > active - release) return (active - phase) / release;
      return 1;
    },
  });
}

async function stepTitle(page) {
  return page.evaluate(
    "(document.querySelector('.panel-songs-practice h4') || {}).textContent || ''"
  );
}

async function clickButton(page, text) {
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`
  );
}

function hasButtonExpr(text) {
  return `Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === ${JSON.stringify(text)})`;
}

test('a sustaining instrument that plays the right note but holds it too short is told to hold each note longer', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-hold-tune-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = writePulseTrainWav(join(dir, 'pulses.wav'));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const result = await retryFlaky({
    attempts: 3,
    what: 'the "hold it longer" hold/tune feedback',
    describe: (r) => r.sayText || r.error || 'no result',
    accept: (r) => r.ok,
    attempt: async () => {
      const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
      try {
        await page.evaluate("window.__coach.setMod('voice')");
        await page.evaluate("window.__coach.openPanel('songs')");
        await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
        await page.setFileInput('#songsFileInput', challengePath);
        await page.waitFor(
          "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Hold Tune Song'))"
        );
        await page.evaluate(
          "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Hold Tune Song')).click()"
        );
        await page.waitFor("document.querySelector('.panel-songs-practice h4')");
        // listen step: just Next.
        await clickButton(page, 'Next');
        await page.waitFor(hasButtonExpr('Your turn'));

        // rhythm step: retry the recording itself (bounded) until it
        // passes, absorbing the mic's own cold-open latency (the very
        // first getUserMedia() this test makes) without needing to predict
        // it -- see writePulseTrainWav's header.
        let rhythmPassed = false;
        for (let i = 0; i < 8 && !rhythmPassed; i++) {
          await clickButton(page, 'Your turn');
          await new Promise((r) => setTimeout(r, 400));
          await clickButton(page, 'Stop and check');
          await page.waitFor(hasButtonExpr('Your turn'));
          rhythmPassed = (await stepTitle(page)).startsWith('Play the notes');
        }
        if (!rhythmPassed) return { ok: false, error: 'rhythm step never passed in 8 tries' };

        // pitches step (untimed, order-only) -- the same short pulses that
        // passed rhythm above are, deliberately, far too short to satisfy
        // this song's 1.44-3.6s hold band.
        await clickButton(page, 'Your turn');
        await new Promise((r) => setTimeout(r, 400));
        await clickButton(page, 'Stop and check');
        await page.waitFor("document.querySelector('.panel-say').textContent.length > 0");
        const sayText = await page.evaluate("document.querySelector('.panel-say').textContent");
        return { ok: sayText === 'Hold each note a little longer.', sayText, exceptions: page.exceptions.slice() };
      } finally {
        await page.close();
      }
    },
  });
  assert.equal(result.sayText, 'Hold each note a little longer.');
});
