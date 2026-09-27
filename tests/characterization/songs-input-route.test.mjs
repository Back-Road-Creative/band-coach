// A song's learning-event row (src/ui/songs.js advance()) records which
// route the notes judged in that attempt actually came from -- 'midi' only
// when every judged note in the attempt was a real MIDI note-on, so a later
// reader can trust "input: 'midi'" as evidence a real keyboard was used,
// never a guess from the mere presence of a Web MIDI API. Drives the real
// entry points: a fake Web MIDI port's note-on (tests/helpers/fake-midi.mjs)
// for the MIDI attempt, and a real `keydown` KeyboardEvent (the same
// technique tests/characterization/midi-entry.test.mjs's computer-key test
// uses) for the computer-key attempt -- neither goes through the debug hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, retryFlaky } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';

const htmlPath = HTML_PATH;

// midi 59 -> GM percussion 'ride' (src/instruments/drum-kit.js PIECES),
// and pckeys.js's own 'm' -> 59 (src/core/pckeys.js PCKEYS_LOWER) -- so a
// single computer keydown both names a drum piece the kit listener can
// judge AND exercises the exact key the review's drum-kit finding cites.
function ridePieceChallengeJson() {
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'One Ride',
    from: null,
    note: null,
    songs: [{
      schema: 'song/1', id: 'one-ride-song', title: 'One Ride Song', composer: null, licence: null, source: null,
      key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
      parts: [{ id: 'kit', name: 'Kit', role: 'percussion', notes: [{ start: 0, dur: 480, midi: 59, piece: 'ride' }] }],
      chords: []
    }]
  });
}

// Pure-Node 16-bit PCM mono WAV writer (no deps) -- same technique as
// tests/characterization/songs-hold-tune.test.mjs's writeWav, trimmed to
// this test's own needs (a steady tone, no envelope shaping required to
// prove a source, only that SOME pitch is heard).
function writeToneWav(path, freq, seconds = 20, sampleRate = 48000) {
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
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.85;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}

// Same one-note challenge tests/characterization/songs-session-log.test.mjs
// uses: one phrase, one note at tick 0, so every judged step in the lesson
// expects this note at the very start of listening.
function challengeJson() {
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'One Note',
    from: null,
    note: null,
    songs: [{
      schema: 'song/1', id: 'one-note-song', title: 'One Note Song', composer: null, licence: null, source: null,
      key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
      parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 64 }] }],
      chords: []
    }]
  });
}

async function importAndOpenSong(page, challengePath, songTitle = 'One Note Song') {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    `Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes(${JSON.stringify(songTitle)}))`
  );
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes(${JSON.stringify(songTitle)})).click()`
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
}

// Clicks "Next" past every listen-only step, then, on the first judged step,
// clicks "Your turn", waits for real listening to begin, and fires
// `sendNoteJs` (a page-side JS expression, e.g. a fake-MIDI send or a real
// keydown) in the SAME in-page turn that observed listening had started --
// same reasoning as tests/helpers/songs-note.mjs's playSongNoteWhenListening
// (no Node-side round trip to add lateness before the note lands).
async function judgeFirstStepWith(page, sendNoteJs) {
  for (let i = 0; i < 8; i++) {
    const hasNext = await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')"
    );
    if (!hasNext) break;
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
  }
  await page.evaluate(`(async () => {
    const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
    if (turnBtn) turnBtn.click();
    while (!(document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far'))) {
      await new Promise(r => setTimeout(r, 4));
    }
    ${sendNoteJs}
  })()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
}

test('a keyboard song attempt played through real fake-MIDI note-ons logs input: "midi"', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-input-midi-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await importAndOpenSong(page, challengePath);
  await midiAddPort(page, 'p1', 'Test Keys');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  const before = await page.evaluate('window.__coach.db().events.length');
  await judgeFirstStepWith(page, "window.__midiSend('p1', [0x90, 64, 100]);");
  await page.waitFor('window.__coach.db().events.length > ' + before);

  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.source, 'song');
  assert.equal(row.input, 'midi');
  assert.deepEqual(page.exceptions, []);
});

test('the same attempt played through computer keys never logs input: "midi"', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-input-key-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await importAndOpenSong(page, challengePath);

  const before = await page.evaluate('window.__coach.db().events.length');
  // 'd' -> MIDI 64 (src/core/pckeys.js), the same note this song expects.
  await judgeFirstStepWith(page, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));");
  await page.waitFor('window.__coach.db().events.length > ' + before);

  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.source, 'song');
  assert.equal(row.input, 'computer-key');
  assert.notEqual(row.input, 'midi');
  assert.deepEqual(page.exceptions, []);
});

// The drum-kit path is a SEPARATE listener from the pitched-instrument one
// above (src/ui/songs.js beginListening's `if (practice.instrument.kit)`
// branch) -- it used to hard-code `source: 'midi'` on every hit whatever
// route actually played it, so a drum lesson never told a computer-key
// press from a real MIDI note-on. mod stays 'kbd' throughout: the physical
// computer-key layout (src/core/pckeys.js) fires regardless of which
// instrument the CURRENT song lesson is set to, and a learner can pick
// "Drum kit" on the "Play it on…" cards without ever leaving 'kbd' mod.
test('a drum-kit song lesson played through computer keys never logs input: "midi"', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-input-kit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, ridePieceChallengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Opened on drum-kit mod, the same way tests/characterization/
  // songs-drums.test.mjs does -- a percussion part fits ONLY the drum kit
  // (src/song/lesson.js fitToInstrument); opened on any other instrument it
  // has zero playable notes/steps and the lesson jumps straight to "Nicely
  // done", never reaching a "Your turn" button at all.
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('One Ride Song'))"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('One Ride Song')).click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  // Now switch the app's OWN mod back to 'kbd' -- src/app.js's physical
  // computer-key keydown branch only fires while `mod === 'kbd'` (the
  // exact review scenario: a learner leaves the main screen on 'kbd', picks
  // "Drum kit" for THIS song only, and never leaves 'kbd' mod). setMod()
  // only touches the main screen's own state (read once, by reference, at
  // startPractice() above) -- the already-running lesson's `practice.
  // instrument` stays drum-kit, so its kit listener (src/ui/songs.js
  // beginListening) is still the one subscribed.
  await page.evaluate("window.__coach.setMod('kbd')");

  const before = await page.evaluate('window.__coach.db().events.length');
  // 'm' -> MIDI 59 (src/core/pckeys.js) -> the 'ride' piece (src/instruments/drum-kit.js), the same piece this song expects.
  await judgeFirstStepWith(page, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));");
  await page.waitFor('window.__coach.db().events.length > ' + before);

  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.source, 'song');
  assert.notEqual(row.input, 'midi');
  assert.equal(row.input, 'computer-key');
  assert.deepEqual(page.exceptions, []);
});

// The pitched mic path (beginListening's plain `else` branch, the mic-only
// instruments) never stamped a source at all before this fix, so a mic
// attempt's judged notes carried `played.source === undefined` and the
// row's `input` was left off entirely rather than naming the mic. Drives a
// real fake-microphone capture (Chromium's
// --use-file-for-fake-audio-capture, same technique
// tests/characterization/songs-hold-tune.test.mjs uses), never the debug
// hook, since window.__coach's own note hooks cannot fake a pitch capture.
test('a mic-detected pitched song attempt logs input: "mic"', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-input-mic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const TARGET_MIDI = 64;
  const TARGET_FREQ = 440 * Math.pow(2, (TARGET_MIDI - 69) / 12);
  const wavPath = writeToneWav(join(dir, 'tone.wav'), TARGET_FREQ);
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const result = await retryFlaky({
    attempts: 3,
    what: 'a mic-detected pitch song attempt logging input: "mic"',
    describe: (r) => (r.input === undefined ? 'input never got recorded' : ('input: ' + r.input)),
    accept: (r) => r.input === 'mic',
    attempt: async () => {
      const page = await launchPage(htmlPath, { fakeAudioFile: wavPath });
      try {
        await page.evaluate("window.__coach.setMod('voice')");
        await page.evaluate("window.__coach.openPanel('songs')");
        await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
        await page.setFileInput('#songsFileInput', challengePath);
        await page.waitFor(
          "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('One Note Song'))"
        );
        await page.evaluate(
          "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('One Note Song')).click()"
        );
        await page.waitFor("document.querySelector('.panel-songs-practice h4')");

        const before = await page.evaluate('window.__coach.db().events.length');
        await judgeFirstStepWith(page, "await new Promise(r => setTimeout(r, 400));");
        const gotEvent = await page
          .waitFor('window.__coach.db().events.length > ' + before, 5000)
          .then(() => true)
          .catch(() => false);
        if (!gotEvent) return { input: undefined, exceptions: page.exceptions.slice() };

        const events = await page.evaluate('window.__coach.db().events');
        const row = events[events.length - 1];
        return { input: row.input, exceptions: page.exceptions.slice() };
      } finally {
        await page.close();
      }
    },
  });
  assert.equal(result.input, 'mic');
  assert.deepEqual(result.exceptions, []);
});

// A caller that never told onNote() a source at all -- the debug hook, or a
// screen-key click -- leaves `played.source` undefined; advance()'s own
// "left off rather than guessed" convention (src/ui/songs.js, the comment
// above `judgedSources` in advance()) means the row's `input` key is absent
// entirely, never a guessed value. `songsNoteAt` (the hook itself, see
// src/app.js's `songsNoteAt: forwardSongNoteAt` assignment) is called here
// with no trailing `source` argument, the same shape every caller used
// before this unit added one.
test('a hook-driven note with no source leaves the row\'s input key off entirely', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-input-none-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await importAndOpenSong(page, challengePath);

  const before = await page.evaluate('window.__coach.db().events.length');
  await judgeFirstStepWith(page, "window.__coach.songsNoteAt(64, 0, true);");
  await page.waitFor('window.__coach.db().events.length > ' + before);

  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.source, 'song');
  assert.equal('input' in row, false);
  assert.deepEqual(page.exceptions, []);
});
