// F7: nothing on a pitched instrument was ever judged for rhythm — note
// tasks scored reaction time only, and rhythm existed only as tapping a
// key or pad. This exercises the new "play in time" kind end to end: a
// count-in, a metronome, notes played on the beat via the existing
// note-detection path (onNote), scored by src/core/groove.js.
//
// The test drives kbd (input: 'midi') because its note events reach
// onNote() directly with no microphone, deaf window or pitch-detection
// jitter involved — grooveInject (src/app.js, hook slot play-in-time)
// schedules a call to the SAME onNote() a real key press or MIDI message
// would call, by polling the live audio clock (never a single wall-clock
// setTimeout: this suite runs many headless browsers in parallel, and a
// setTimeout scheduled seconds ahead drifts tens of ms against the audio
// clock under that load — see toAudioTime/timing.js for the same class of
// clock-drift bug on the real input path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

async function waitForFreshGrooveTask(page, afterT0) {
  await page.waitFor(
    `window.__coach.task() && window.__coach.task().kind === 'groove' && window.__coach.task().done === false && window.__coach.groove() && window.__coach.groove().t0 !== ${afterT0}`,
    10000
  );
  return page.evaluate('window.__coach.groove().t0');
}

// Plays one groove take with every note offset by `offsetSec` from its grid
// time, and returns { className, summary, t0, bpm } once it has been judged.
// `bpm` is the tempo THIS take was played at, which is what the ladder steps
// from — see the retry note below for why the starting tempo will not do.
async function playGrooveTake(page, offsetSec) {
  const t = await page.evaluate('window.__coach.task()');
  const g = await page.evaluate('window.__coach.groove()');
  for (let i = 0; i < t.els.length; i++) {
    const midi = t.els[i].info.midi;
    const at = g.grid[i] + offsetSec;
    await page.evaluate(`window.__coach.grooveInject(${midi}, ${at})`);
  }
  await page.waitFor('window.__coach.task().done === true', 10000);
  const className = await page.evaluate("document.getElementById('feedback').className");
  const summary = await page.evaluate('window.__coach.grooveLast().summary');
  return { className, summary, t0: g.t0, bpm: g.bpm };
}

test('play in time: on-beat notes pass, a consistent drag is reported late, and tempo rises after a clean take', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.evaluate('window.__coach.grooveOn(true)');
  await page.waitFor("window.__coach.task() && window.__coach.task().kind === 'groove'", 5000);

  let t0 = await page.evaluate('window.__coach.groove().t0');

  // Round 1: every note dead on the beat. Retried a few times because this
  // suite runs many headless browsers concurrently, and an occasional
  // scheduling stall under that shared load can push one note outside the
  // "steady" tendency band without the feature being broken.
  let clean = null;
  for (let attempt = 0; attempt < 5 && !(clean && clean.className === 'ok'); attempt++) {
    if (attempt > 0) t0 = await waitForFreshGrooveTask(page, t0);
    clean = await playGrooveTake(page, 0);
  }
  assert.equal(clean.className, 'ok', `notes landing on the beat should be credited as a clean take: ${JSON.stringify(clean.summary)}`);
  const bpmAfterClean = await page.evaluate('window.__coach.grooveBpm()');
  // Against the tempo the CLEAN take was played at, not the tempo the test
  // started at. The ladder steps 6 bpm each way (src/core/groove.js
  // tempoLadder), so a retry that missed once and then played clean walks
  // 80 -> 74 -> 80 and lands back exactly on the starting value: comparing
  // against `bpmBefore` failed a correct app on any run the first attempt
  // did not pass. The invariant is unchanged and still strict — a clean
  // take must move the tempo UP a step.
  assert.ok(
    bpmAfterClean > clean.bpm,
    `tempo should rise after a clean take: ${clean.bpm} -> ${bpmAfterClean}`
  );

  // Round 2: a fresh groove task, every note a consistent 120ms late.
  t0 = await waitForFreshGrooveTask(page, t0);
  let late = null;
  for (let attempt = 0; attempt < 5 && !(late && late.summary.tendency === 'dragging'); attempt++) {
    if (attempt > 0) t0 = await waitForFreshGrooveTask(page, t0);
    late = await playGrooveTake(page, 0.12);
  }
  assert.equal(late.summary.tendency, 'dragging', `expected a dragging verdict, got ${JSON.stringify(late.summary)}`);
  assert.ok(late.summary.meanErrorMs > 80, `expected a clearly late mean error, got ${late.summary.meanErrorMs}`);
  const feedbackText = await page.evaluate("document.getElementById('feedback').textContent");
  assert.match(feedbackText.toLowerCase(), /late|drag/, `feedback should call out lateness: "${feedbackText}"`);
});
