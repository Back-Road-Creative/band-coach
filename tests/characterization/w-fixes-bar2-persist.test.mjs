// Item 2 (Wave W, unit w-fixes): rhythm-vocabulary bars (task.kind ===
// 'bar2') credit progress against the item id 'bar2' (src/app.js finishTask,
// via task.els[0].id === 'bar2' for a bar2 task), but validId() only ever
// accepted the n/w/p/v/s/c/i/q/r prefixes -- never the literal id 'bar2'.
// sanitizeModel() drops any S.item entry validId() rejects, and save() runs
// S through sanitizeModel() on its own 1200ms debounce, so the mastery
// record was wiped out of memory within ~1.2s of being earned, not only on
// reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

async function fakeTimeStampFor(page, targetAudioTime) {
  const [refAudio, refPerf] = await page.evaluate('[window.__coach.audioNow(), performance.now()]');
  const offset = refAudio - refPerf / 1000;
  return (targetAudioTime - offset) * 1000;
}

test('bar2 mastery survives the debounced sanitize pass and a reload', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('rhy')");
  // Level 9 = "Rests: halves and wholes", the first task:'bar2' level.
  await page.evaluate('window.__coach.state().level = 9');
  await page.evaluate('window.__coach.db().latencyMs = 0');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().onsets.length > 0');

  const onsets = await page.evaluate('window.__coach.bar().onsets.map(o => o.t)');
  for (const onsetTime of onsets) {
    const ts = await fakeTimeStampFor(page, onsetTime);
    await page.evaluate(`window.__coach.tap({ timeStamp: ${ts} })`);
  }
  await page.waitFor('window.__coach.bar().judged', 12000);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 12000);

  // save() debounces at 1200ms and runs S through sanitizeModel() -- the
  // exact pass that used to drop the bar2 item.
  await new Promise((r) => setTimeout(r, 1600));

  const hasItemAfterSave = await page.evaluate("!!(window.__coach.state().item && window.__coach.state().item['bar2'])");
  assert.equal(hasItemAfterSave, true, 'bar2 mastery should survive the debounced sanitize pass, not just the reload');

  await page.reload();
  await page.evaluate("window.__coach.setMod('rhy')");
  const hasItemAfterReload = await page.evaluate("!!(window.__coach.state().item && window.__coach.state().item['bar2'])");
  assert.equal(hasItemAfterReload, true, 'bar2 mastery should survive a reload');
});
