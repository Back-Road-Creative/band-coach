// Ear-training panel (src/ui/ear.js, panel id "ear"): plays a question
// deterministically (seeded via api.store('ear')), grades the answer against
// src/core/ear's checkAnswer, and adapts each exercise's own level. Driven
// through window.__coach.openPanel('ear') and the real DOM, per the wiring
// brief. window.__coach.ear() is a debug-only hook (src/ui/ear.js
// __earTestHook) that exposes the live mounted question/response so a test
// can grade the exact question the deterministic seed produced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

async function openEar(page) {
  await page.evaluate("window.__coach.openPanel('ear')");
  await page.waitFor('window.__coach.panelOpen() === "ear"');
  await page.waitFor('window.__coach.ear() && window.__coach.ear().getQuestion()');
}

async function selectExercise(page, id) {
  await page.evaluate(`document.querySelector('.ear-exercises button[data-exercise="${id}"]').click()`);
  await page.waitFor(`window.__coach.ear().getExerciseId() === ${JSON.stringify(id)}`);
}

test('the ear panel opens, lists all ten exercises in plain words, and plays a question', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openEar(page);

  const labels = await page.evaluate(
    "Array.from(document.querySelectorAll('.ear-exercises button')).map(b => b.textContent)"
  );
  assert.deepEqual(labels, [
    'Scale degrees',
    'Melodic dictation',
    'Dictation from songs',
    'Rhythm dictation',
    'Rhythms from songs',
    'Chord progressions',
    'Scales and modes',
    'Chord inversions',
    'In tune or not',
    'Sing it back',
  ]);

  const prompt = await page.evaluate("document.getElementById('earPrompt').textContent");
  assert.ok(prompt.length > 0, 'a prompt is shown for the first question');

  // Play/reveal/next and every exercise picker control are native buttons,
  // which are keyboard-operable (Tab + Enter/Space) without any extra wiring.
  const controlTags = await page.evaluate(
    "[document.getElementById('earPlayBtn'), document.getElementById('earRevealBtn'), document.getElementById('earNextBtn')].map(b => b.tagName)"
  );
  assert.deepEqual(controlTags, ['BUTTON', 'BUTTON', 'BUTTON']);
});

test('scale degrees: a correct in-order pick sequence grades ok and levels up after three in a row', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openEar(page);
  await selectExercise(page, 'degrees');

  for (let i = 0; i < 3; i++) {
    await page.waitFor('window.__coach.ear().getQuestion()');
    const answer = await page.evaluate('window.__coach.ear().getQuestion().answer');
    for (const label of answer) {
      await page.evaluate(`(function () {
        const btn = Array.from(document.querySelectorAll('#earAnswerArea .ear-choices button')).find(b => b.textContent === ${JSON.stringify(label)});
        btn.click();
      })()`);
    }
    await page.waitFor("document.getElementById('earFeedback').className === 'ear-feedback ok'");
    if (i < 2) await page.evaluate("document.getElementById('earNextBtn').click()");
  }

  const level = await page.evaluate("window.__coach.db().panels.ear.exercises.degrees.level");
  assert.equal(level, 2, 'three correct answers in a row moves scale degrees up to level 2');
});

test('an intonation question graded wrong shows the explanation and does not crash on a repeat grade attempt', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openEar(page);
  await selectExercise(page, 'intonation');
  await page.waitFor('window.__coach.ear().getQuestion()');

  const answer = await page.evaluate('window.__coach.ear().getQuestion().answer');
  const wrong = ['sharp', 'flat', 'same'].find((c) => c !== answer);
  await page.evaluate(`(function () {
    const btn = Array.from(document.querySelectorAll('#earAnswerArea .ear-choices button')).find(b => b.textContent === ${JSON.stringify(wrong)});
    btn.click();
  })()`);
  await page.waitFor("document.getElementById('earFeedback').className === 'ear-feedback no'");
  assert.equal(await page.evaluate("document.getElementById('earExplain').hidden"), false);

  // Clicking a second choice after grading must not throw or change the result.
  await page.evaluate(`(function () {
    const btn = Array.from(document.querySelectorAll('#earAnswerArea .ear-choices button')).find(b => b.textContent === ${JSON.stringify(answer)});
    btn.click();
  })()`);
  assert.equal(await page.evaluate("document.getElementById('earFeedback').className"), 'ear-feedback no');
  assert.deepEqual(page.exceptions, []);
});

test('melodic dictation: entering the exact heard notes on the on-screen keys grades ok', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openEar(page);
  await selectExercise(page, 'melodic-dictation');
  await page.waitFor('window.__coach.ear().getQuestion()');

  const answer = await page.evaluate('window.__coach.ear().getQuestion().answer');
  for (const midi of answer) {
    await page.evaluate(`(function () {
      const names = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B']; // the app's default (mixed) spelling
      const pc = (((${midi}) % 12) + 12) % 12, octave = Math.floor((${midi}) / 12) - 1;
      const label = names[pc] + octave;
      const btn = Array.from(document.querySelectorAll('.ear-note-entry button')).find(b => b.textContent === label);
      btn.click();
    })()`);
  }
  await page.waitFor("document.getElementById('earFeedback').className === 'ear-feedback ok'");
});

test('song dictation: entering the exact heard notes grades ok and does not name the song beforehand', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openEar(page);
  await selectExercise(page, 'song-dictation');
  await page.waitFor('window.__coach.ear().getQuestion()');

  assert.ok(await page.evaluate("document.getElementById('earExplain').hidden"), 'the song title is not shown before an answer or reveal');

  const answer = await page.evaluate('window.__coach.ear().getQuestion().answer');
  for (const midi of answer) {
    await page.evaluate(`(function () {
      const names = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B']; // the app's default (mixed) spelling
      const pc = (((${midi}) % 12) + 12) % 12, octave = Math.floor((${midi}) / 12) - 1;
      const label = names[pc] + octave;
      const btn = Array.from(document.querySelectorAll('.ear-note-entry button')).find(b => b.textContent === label);
      btn.click();
    })()`);
  }
  await page.waitFor("document.getElementById('earFeedback').className === 'ear-feedback ok'");
  assert.ok(await page.evaluate("document.getElementById('earExplain').textContent").then((t) => t.startsWith('From "')), 'the song is named only after grading');
});

test('rhythm dictation: tapping the exact onset spacing back grades ok', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openEar(page);
  await selectExercise(page, 'rhythm-dictation');
  await page.waitFor('window.__coach.ear().getQuestion()');

  const onsets = await page.evaluate('window.__coach.ear().getQuestion().answer');
  await tapOnsetsOnFakeClock(page, onsets);
  await page.evaluate("document.querySelector('#earAnswerArea button:nth-of-type(3)').click()"); // Submit rhythm
  await page.waitFor("document.getElementById('earFeedback').className === 'ear-feedback ok'", 3000);
});


// Taps each onset with the app's clock pinned to that exact moment, so the
// grade never depends on timer jitter under a loaded full-suite run. The app
// reads its clock from the AudioContext (performance.now() before one exists);
// both are pinned for the taps, then restored.
async function tapOnsetsOnFakeClock(page, onsets) {
  await page.evaluate(`(function () {
    const onsets = ${JSON.stringify(onsets)};
    const proto = window.BaseAudioContext ? BaseAudioContext.prototype : AudioContext.prototype;
    const ctDesc = Object.getOwnPropertyDescriptor(proto, 'currentTime');
    const realPerfNow = performance.now;
    let t = 0;
    Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return t; } });
    performance.now = () => t * 1000;
    const tapBtn = document.getElementById('earTapBtn');
    try {
      for (const ticks of onsets) { t = 1000 + ticks / 480; tapBtn.click(); } // 60 BPM => 1 tick = 1/480 s
    } finally {
      Object.defineProperty(proto, 'currentTime', ctDesc);
      performance.now = realPerfNow;
    }
  })()`);
}

test('rhythms from songs: shows the song title up front and tapping the exact onsets back grades ok', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openEar(page);
  await selectExercise(page, 'song-rhythm');
  await page.waitFor('window.__coach.ear().getQuestion()');

  const prompt = await page.evaluate("document.getElementById('earPrompt').textContent");
  assert.ok(prompt.includes('"'), 'the prompt names the song up front (sight-reading, not ear training)');

  const onsets = await page.evaluate('window.__coach.ear().getQuestion().answer');
  await tapOnsetsOnFakeClock(page, onsets);
  await page.evaluate("document.querySelector('#earAnswerArea button:nth-of-type(3)').click()"); // Submit rhythm
  await page.waitFor("document.getElementById('earFeedback').className === 'ear-feedback ok'", 3000);
});

test('sing it back and chord progressions and scales/inversions panels open without console errors', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openEar(page);
  for (const id of ['sing-back', 'progressions', 'scales-modes', 'inversions']) {
    await selectExercise(page, id);
    await page.waitFor('window.__coach.ear().getQuestion()');
  }
  assert.deepEqual(page.exceptions, []);
  assert.deepEqual(page.consoleErrors, []);
});

test('a wrong dictation answer says the expected notes by name, not as MIDI numbers or JSON', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await openEar(page);
  await selectExercise(page, 'melodic-dictation');
  await page.waitFor('window.__coach.ear().getQuestion()');
  const need = await page.evaluate('window.__coach.ear().getQuestion().answer.length');
  // The lowest key (C3) is never the phrase's note in the C4-ish range, so this is always wrong.
  for (let i = 0; i < need; i++) await page.evaluate("document.querySelector('.ear-note-entry button').click()");
  await page.waitFor("document.getElementById('earFeedback').className === 'ear-feedback no'");
  const fb = await page.evaluate("document.getElementById('earFeedback').textContent");
  assert.match(fb, /^Not quite\. Expected: [A-G][^,\d]*\d(, [A-G][^,\d]*\d)*\.$/, fb);
  assert.ok(!/[\[\]]/.test(fb) && !/\b\d{2}\b/.test(fb), fb);
  assert.ok(!/Notes: \d/.test(await page.evaluate("document.getElementById('earExplain').textContent")));
});

test('the dictation keys follow the Settings note-naming choice', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());
  await page.evaluate(`(function () {
    const s = document.getElementById('optNoteSystem'); s.value = 'solfege'; s.dispatchEvent(new Event('change', { bubbles: true }));
    const a = document.getElementById('optAccidentals'); a.value = 'flats'; a.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await openEar(page);
  await selectExercise(page, 'melodic-dictation');
  const labels = await page.evaluate("Array.from(document.querySelectorAll('.ear-note-entry button')).map(b => b.textContent).slice(0, 5)");
  assert.deepEqual(labels, ['Do3', 'Re♭3', 'Re3', 'Mi♭3', 'Mi3']);
  await page.evaluate("window.__coach.openPanel('theory')");
  await page.waitFor("document.getElementById('theoryExploreTonic')");
  const tonics = await page.evaluate("Array.from(document.querySelectorAll('#theoryExploreTonic option')).map(o => o.textContent).slice(0, 4)");
  // The root list spells both C# and Db, so each keeps its own sign in the chosen system.
  assert.deepEqual(tonics, ['Do', 'Do♯', 'Re♭', 'Re']);
  const roots = await page.evaluate("Array.from(document.querySelectorAll('#theoryExploreChordRoot option')).map(o => o.textContent)");
  assert.ok(roots.includes('Si♭') && !roots.includes('Bb'), roots.join(' '));
});
