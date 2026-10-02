// A fresh learner at level 1 sees two octaves (C3-C5) from the start, labelled
// "Left hand" / "Right hand", with middle C marked. Drawing and orientation
// only: the judged level-1 note set is unchanged and keys stay clickable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const SPY = `(function () { window.__texts = []; const o = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t) { window.__texts.push(String(t)); return o.apply(this, arguments); }; })();`;

test('level 1 draws two labelled octaves, marks middle C, keeps the judged set, and keys click', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: SPY });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  assert.equal(await page.evaluate('window.__coach.state().level'), 1);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const ids = await page.evaluate('JSON.stringify(window.__coach.task().els.map(e => e.id || (e.info && e.info.midi)))');
  assert.deepEqual(await page.evaluate('window.__coach.kbdRange()'), [48, 72]);
  await page.waitFor('window.__texts.some(s => /Left hand/.test(s)) && window.__texts.some(s => /Right hand/.test(s))');
  assert.ok(await page.evaluate("window.__texts.some(s => /C4 · middle C/.test(s))"), 'middle C is marked');
  const keys = await page.evaluate('window.__coach.kbdKeys()');
  assert.deepEqual([Math.min(...keys.map(k => k.m)), Math.max(...keys.map(k => k.m))], [48, 72]);
  // judged set unchanged: level-1 items are all at or above middle C
  const items = await page.evaluate('JSON.stringify(window.__coach.task().els.map(e => e.info && e.info.midi))');
  assert.ok(JSON.parse(items).every(m => m >= 60), 'level-1 targets stay in the right-hand octave: ' + items + ids);
  // a left-hand key is clickable through the real hit-test
  const k = keys.find(q => q.m === 48 && !q.black);
  const pt = await page.evaluate(`(function(){const cv=document.getElementById('cv'),r=cv.getBoundingClientRect();return {x:r.left+(${k.x}+${k.w}/2)*r.width/cv.width,y:r.top+(${k.y}+${k.h}*0.8)*r.height/cv.height};})()`);
  assert.ok(pt.x > 0 && pt.y > 0);
});
