// Characterization tests for the rhythm-vocabulary levels (Unit 2.4): 6/8
// bars sum correctly, and a tied bar is judged right — taps at the un-tied
// onsets pass, an extra tap on the tied note does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { tapAtAudioTime } from '../helpers/tap-at.mjs';

const htmlPath = HTML_PATH;

async function startAtLevel(page, level) {
  await page.evaluate("window.__coach.setMod('rhy')");
  await page.evaluate(`window.__coach.state().level = ${level}`);
  await page.evaluate('window.__coach.db().latencyMs = 0');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().onsets.length > 0');
}

test('CHARACTERIZATION: a 6/8 level produces a 6/8 bar that sums exactly to the metre', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Level 14 = "Six-eight time" (levels 9-16 are the new rhythm-vocabulary
  // levels appended after the original eight).
  await startAtLevel(page, 14);
  const metre = await page.evaluate('window.__coach.bar().metre');
  assert.equal(metre, '6/8');
  const total = await page.evaluate("window.__coach.bar().phrase.events.reduce((s, e) => s + e.dur, 0)");
  assert.equal(total, 1440, '6/8 bar should sum to exactly two dotted-quarter beats (1440 ticks)');
});

test('CHARACTERIZATION: a tied bar judged with taps at the un-tied onsets passes', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  // Level 10 = "Ties"; its first (deterministic, S.tick===0) pattern is
  // ['tqq', 'q', 'q'] -- a quarter tied into a quarter, then two plain
  // quarters. Onsets land at beats 0, 2 and 3; beat 1 (the tied note) has
  // no onset of its own.
  await startAtLevel(page, 10);
  const onsets = await page.evaluate('window.__coach.bar().onsets.map(o => o.t)');
  assert.equal(onsets.length, 3, 'a tied beat should not produce its own onset');

  for (const onsetTime of onsets) {
    await tapAtAudioTime(page, onsetTime);
  }
  await page.waitFor('window.__coach.bar().judged', 12000);
  const failed = await page.evaluate("window.__coach.task().els[0].failed");
  assert.equal(failed, false, 'tapping exactly the real onsets should pass the bar');
});

test('CHARACTERIZATION: an extra tap on the tied note fails the bar', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await startAtLevel(page, 10);
  const bar = await page.evaluate('window.__coach.bar()');
  const beatSec = bar.spb;
  const onsets = bar.onsets.map(o => o.t);
  const tiedNoteTime = bar.playAt + beatSec; // beat 1: the tied note, no real onset there

  for (const onsetTime of onsets) {
    await tapAtAudioTime(page, onsetTime);
  }
  await tapAtAudioTime(page, tiedNoteTime);

  await page.waitFor('window.__coach.bar().judged', 12000);
  const failed = await page.evaluate("window.__coach.task().els[0].failed");
  assert.equal(failed, true, 'an extra tap on the tied note should not be tolerated');
});
