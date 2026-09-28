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
// (it only forwards discrete key/MIDI notes, never durSec/cents; the voice
// instrument's mic branch of beginListening() -- src/ui/songs.js -- never
// subscribes to onMidiNote(), so window.__coach.songsNoteAt does nothing
// for it), so a real capture is the only way to show the shipped app
// actually coaches holding a note.
//
// This test resumes straight to the untimed "pitches" step through the
// app's own saved-lesson-place mechanism, rather than playing through the
// timed "rhythm" step first.
// The rhythm step's rule ({ maxMeanErrorMs: 120 }, src/song/lesson.js) is
// judged against onsets that are stamped with api.now() at the moment a
// setInterval(50) tick runs (src/ui/songs.js beginListening()'s mic
// branch) -- on a starved renderer every onset lands stamped late by more
// than the rule allows, and the loop that used to retry the recording
// itself (this file's own history) could not out-wait that: the JUDGING,
// not just the capture, is timed. The "pitches" step buildLessonPlan
// builds (src/song/lesson.js) has no such rule (bpm 0, maxMeanErrorMs
// null) -- it is exactly the step whose pass/fail this test exists to
// read, so skipping straight to it removes the load-sensitive step
// without touching what is actually being asserted.
//
// The skip works by writing directly into the app's own saved lesson
// place (window.__coach.db().panels.songs.lessons[0].stepIndex) -- the
// same record startPractice()'s saveLesson() writes on every real open,
// and the same one a returning learner's next open reads back
// (src/song/lesson-resume.js) -- and then reopening the song through its
// own challenge-list button, exactly as a learner would. Nothing here
// imports or recomputes lessonKey() itself: the key that gets matched on
// the second open is the one the app already stored on the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, retryFlaky, WAIT_FLOOR_MS } from '../helpers/browser.mjs';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId as instrumentById } from '../../src/instruments/index.js';

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
function challengeSong() {
  return {
    schema: 'song/1', id: 'hold-tune-song', title: 'Hold Tune Song', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: TARGET_MIDI }] }],
    chords: []
  };
}
function challengeJson() {
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'Hold Tune Challenge',
    from: null,
    note: null,
    songs: [challengeSong()],
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

// A repeating pulse: 5ms attack, 0.61s flat, 5ms release, then 1.92s
// silence -- period 2.53s. Repeating for the WHOLE file (not just once)
// means whenever the pitches step's "Your turn" recording starts, an onset
// is never more than ~2.53s away, regardless of the real-world latency
// between the click and the fake microphone actually being open (see
// src/app.js openMic()'s early-return-once-ready -- the FIRST open has real
// getUserMedia latency the test cannot pin down exactly, later ones do
// not). 0.61s is still far too short to read as "held" against this song's
// 1.44-3.6s band, which is the hold assertion this test exists for.
//
// These numbers replace an earlier, much shorter pulse (90ms on/40ms off,
// period 130ms) that a Node-level simulation of the real onset detector
// (src/audio/onset.js) plus YIN (src/audio/yin.js) -- sweeping 60 evenly
// spaced first-tick phases with no jitter, driven exactly as
// src/ui/songs.js's mic branch drives them -- found MISSED the note
// entirely at 16/60 phases even at the real, on-time 50ms tick (3/60 at a
// late 300ms tick, 1/60 at 500ms), yielding at most one note in the whole
// 20s file. Cause: createOnsetDetector only flags an ONSET on a rising
// edge; with the analyser's ~85ms (fftSize/sampleRate) frame never fully
// silent between such short/close pulses, the only onset most trials see is
// the very first frame after the detector is created -- if that one
// frame's YIN clarity happens to read <=0.7, nothing is ever counted for
// the rest of the 20s. This is a one-shot-onset fragility in the STIMULUS,
// not something the tick rate causes: CI failing 'no-note-heard' on 3/3
// retryFlaky attempts in a row (this file's header comment; see also CI run
// 36374323595) is exactly what a near-deterministic first-frame miss looks
// like. The same simulation found THIS period/duty cycle misses 0/60
// phases at 50ms, 300ms, and 500ms ticks (4-7 notes heard in 20s at 50ms
// and 300ms) -- several widely-separated onset attempts instead of one
// clustered burst, so missing the very first one still leaves plenty more
// chances.
function writePulseTrainWav(path) {
  const period = 2.53, active = 0.61, attack = 0.005, release = 0.005;
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

// Makes the mic-listening setInterval(50) (src/ui/songs.js beginListening(),
// the voice/sustain-instrument branch) fire late, the way a starved renderer
// does. Every OTHER setInterval/setTimeout in the page (the count-in
// clicks, this test's own 4ms polls) is left alone; only the exact ms ===
// 50 call is retimed, the same narrow-match technique as
// songs-loop-backing.test.mjs's LATE_SHORT_TIMERS.
function lateFiftyMsTickScript(lateMs) {
  return `(() => {
    const orig = window.setInterval;
    window.setInterval = function (fn, ms, ...rest) { return orig.call(window, fn, ms === 50 ? ${lateMs} : ms, ...rest); };
  })();`;
}

async function clickButton(page, text) {
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`
  );
}

function hasButtonExpr(text) {
  return `Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === ${JSON.stringify(text)})`;
}

async function clickChallengeSong(page) {
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Hold Tune Song')).click()"
  );
}

// The pitches step's index in the plan buildLessonPlan() actually produces
// for this exact song/part/instrument -- computed the same way
// kbd-practice-song-handoff.test.mjs keys its own step lookup, so a future
// change to buildLessonPlan's step ordering breaks this assertion loudly
// instead of this test silently resuming at the wrong step.
const song = challengeSong();
const plan = buildLessonPlan(song, 'melody', instrumentById.voice);
const PITCHES_STEP_INDEX = plan.steps.findIndex((s) => s.kind === 'pitches');

// The flow both tests below drive: open the Songs panel as Voice, load the
// one-note challenge, resume straight to its "pitches" step (see the
// PITCHES_STEP_INDEX comment above), hit "Your turn", wait for the first
// detected note, stop, and read back the coaching line. `launchOptions` is
// forwarded to launchPage() untouched -- the late-tick test's only
// difference from the first is an `initScript` that makes the
// mic-listening tick late.
//
// On a 'no-note-heard' timeout the error string carries what the PAGE saw at
// that moment (mic open per window.__coach.micOpen(), the count text, and
// how long the wait actually ran) so a future failure is actionable from the
// test output alone, never a bare "no-note-heard" that says nothing about
// whether the mic was even open.
async function attemptHoldTune(wavPath, challengePath, launchOptions) {
  const page = await launchPage(htmlPath, launchOptions);
  try {
    await page.evaluate("window.__coach.setMod('voice')");
    await page.evaluate("window.__coach.openPanel('songs')");
    await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
    await page.setFileInput('#songsFileInput', challengePath);
    await page.waitFor(
      "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Hold Tune Song'))"
    );
    await clickChallengeSong(page);
    await page.waitFor("document.querySelector('.panel-songs-practice h4')");

    // The first open writes lessons[0] (saveLesson(), src/ui/songs.js)
    // with the app's OWN lessonKey and stepIndex 0 -- a plain assert,
    // not a retried condition, since this is a structural invariant of
    // the app (a fresh open always writes one), not something a
    // starved runner could make flaky.
    const savedSongId = await page.evaluate("(window.__coach.db().panels.songs.lessons[0] || {}).key && window.__coach.db().panels.songs.lessons[0].key.songId");
    assert.equal(savedSongId, 'hold-tune-song');

    // Jump the saved place straight to the pitches step -- the same
    // record a returning learner's next open would read back, just
    // edited in memory instead of waiting for one to already exist at
    // this step through real play.
    await page.evaluate(`window.__coach.db().panels.songs.lessons[0].stepIndex = ${PITCHES_STEP_INDEX}`);

    // Reopening the same challenge song resumes at the saved place
    // (startPractice() without `fresh`, src/ui/songs.js) -- the
    // challenge list stays visible during practice, so the same button
    // is clicked again exactly as a learner would.
    await clickChallengeSong(page);
    await page.waitFor(
      "(document.querySelector('.panel-songs-practice h4') || {}).textContent && document.querySelector('.panel-songs-practice h4').textContent.startsWith('Play the notes')"
    );

    await clickButton(page, 'Your turn');
    const startedAt = Date.now();
    // One page.evaluate async IIFE, the in-page poll pattern of
    // tests/helpers/songs-note.mjs: poll for the first detected note,
    // then click "Stop and check" in the SAME synchronous turn that
    // observed it. Stopping the instant one note is heard means no
    // later capture tick can stretch that note's durSec with
    // extendHeldEvent (src/ui/songs.js) under a throttled tick rate --
    // this is what replaces the fixed-length sleep the rhythm-step
    // version of this test used, and the same wait absorbs whatever
    // getUserMedia latency the rhythm loop used to absorb.
    const captured = await page.evaluate(`(async () => {
      const deadline = Date.now() + ${WAIT_FLOOR_MS};
      while (Date.now() < deadline) {
        const countEl = document.querySelector('.panel-songs-count');
        if (countEl && /^Notes heard so far: [1-9]/.test(countEl.textContent)) {
          const stopBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check');
          if (stopBtn) { stopBtn.click(); return 'stopped'; }
        }
        await new Promise((r) => setTimeout(r, 4));
      }
      return 'no-note-heard';
    })()`);
    if (captured !== 'stopped') {
      const countText = await page.evaluate("(document.querySelector('.panel-songs-count') || {}).textContent || '(no .panel-songs-count element)'");
      const micOpen = await page.evaluate("typeof window.__coach.micOpen === 'function' ? window.__coach.micOpen() : 'no micOpen() hook'");
      return {
        ok: false,
        error: `no-note-heard after ${Date.now() - startedAt}ms (WAIT_FLOOR_MS=${WAIT_FLOOR_MS}); mic open: ${micOpen}; count text: ${countText}`,
      };
    }

    await page.waitFor(
      "document.querySelector('.panel-say') && document.querySelector('.panel-say').textContent.length > 0 && document.querySelector('.panel-say').textContent !== 'Picking up where you left off.'"
    );
    const sayText = await page.evaluate("document.querySelector('.panel-say').textContent");
    return { ok: sayText === 'Hold each note a little longer.', sayText, exceptions: page.exceptions.slice() };
  } finally {
    await page.close();
  }
}

test('a sustaining instrument that plays the right note but holds it too short is told to hold each note longer', async (t) => {
  assert.ok(PITCHES_STEP_INDEX > 0, 'expected a "pitches" step after listen/rhythm, got kinds: ' + JSON.stringify(plan.steps.map((s) => s.kind)));

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
    attempt: () => attemptHoldTune(wavPath, challengePath, { fakeAudioFile: wavPath }),
  });
  assert.equal(result.sayText, 'Hold each note a little longer.');
});

// Guards the fixed stimulus stays robust when the mic-listening tick itself
// runs late (a starved renderer's setInterval(50) firing every ~300ms
// instead) -- NOT a reproduction of the original bug (see the simulation
// numbers in writePulseTrainWav's comment: the original short-pulse
// stimulus's near-miss was already present at the real, on-time 50ms tick;
// this test's late tick was never the mechanism). Investigated locally
// (2026-09-27/28) with the OLD short-pulse stimulus wrapping
// window.setInterval's ms === 50 call to 300ms/500ms/2000ms, same technique
// as songs-loop-backing.test.mjs's LATE_SHORT_TIMERS: none of 7 runs across
// those three delays went red (most passed in 5-8s with no retryFlaky
// attempt needed), consistent with the simulation's low miss rate at those
// same delays (3/60 and 1/60) -- 7 trials is not enough to expect seeing a
// ~5% event. With the new period-2.53s/active-0.61s stimulus this test is
// not expected to go red either (the simulation found 0/60 misses at
// 300ms and 500ms for it too); it stays in the suite as a regression guard
// against a future change that reintroduces tick-rate sensitivity, not as
// evidence of a bug this file reproduced.
test('when the mic-listening tick runs late, the note is still heard', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-hold-tune-late-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wavPath = writePulseTrainWav(join(dir, 'pulses.wav'));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const result = await retryFlaky({
    attempts: 3,
    what: 'the "hold it longer" hold/tune feedback under a late 50ms tick',
    describe: (r) => r.sayText || r.error || 'no result',
    accept: (r) => r.ok,
    attempt: () => attemptHoldTune(wavPath, challengePath, { fakeAudioFile: wavPath, initScript: lateFiftyMsTickScript(300) }),
  });
  assert.equal(result.sayText, 'Hold each note a little longer.');
});
