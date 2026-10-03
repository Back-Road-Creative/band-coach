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
  // ...and a real click (the browser's own pointer pipeline, trusted events at
  // client coordinates) on it plays that note. Device scale 2, so the canvas
  // backing store is twice its CSS size and a hit test that forgot the
  // CSS-to-backing scale would land on the wrong key.
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.waitFor("document.getElementById('cv').width === Math.round(document.getElementById('cv').getBoundingClientRect().width * 2)");
  // One evaluate: the frame's key rects, the click points derived from them, what is under each point, and the target.
  const geo = await page.evaluate(`(function(){const cv=document.getElementById('cv');cv.scrollIntoView({block:'center'});const r=cv.getBoundingClientRect(),keys=window.__coach.kbdKeys();
    const cx=x=>r.left+x*r.width/cv.width,cy=y=>r.top+y*r.height/cv.height,white=m=>keys.find(q=>q.m===m&&!q.black);
    const k48=white(48),k50=white(50),oc={x:cv.width*0.5,y:cv.height*0.09};
    const pts={p48:{x:cx(k48.x+k48.w/2),y:cy(k48.y+k48.h*0.8)},p50:{x:cx(k50.x+k50.w/2),y:cy(k50.y+k50.h*0.8)},out:{x:cx(oc.x),y:cy(oc.y)}};
    const under=p=>{const e=document.elementFromPoint(p.x,p.y);return e&&e.id;};
    return {dpr:devicePixelRatio,cvw:cv.width,rw:r.width,pts,under:{p48:under(pts.p48),p50:under(pts.p50),out:under(pts.out)},outInRect:keys.some(q=>oc.x>=q.x&&oc.x<=q.x+q.w&&oc.y>=q.y&&oc.y<=q.y+q.h),T:window.__coach.cur().info.midi};})()`);
  assert.equal(geo.dpr, 2, 'the page renders at device scale 2');
  assert.equal(geo.cvw, Math.round(geo.rw * 2), 'the canvas backing store is twice its CSS width');
  assert.deepEqual(geo.under, { p48: 'cv', p50: 'cv', out: 'cv' }, 'nothing covers the points a person would click');
  assert.equal(geo.outInRect, false, 'the control point sits outside every key');
  const T = geo.T;
  assert.ok([60, 62, 64].includes(T), 'level-1 target is C4, D4 or E4: ' + T);
  // C3 (48): always a miss at level 1; the app names the note it heard and says where the target is.
  await page.click(geo.pts.p48.x, geo.pts.p48.y);
  await page.waitFor("document.getElementById('feedback').className === 'no'");
  const fb48 = await page.evaluate("document.getElementById('feedback').textContent");
  const where48 = T === 60 ? 'Right note, wrong octave: go one octave up.' : `Go ${T - 48} keys to the right.`;
  assert.ok(fb48.startsWith('That was C, the note is '), 'the click played C3: ' + fb48);
  assert.ok(fb48.endsWith(where48), `the click played 48, target ${T}: ` + fb48);
  // D3 (50), the next white key: a different note, so a mis-scaled or shifted hit test shows.
  await page.click(geo.pts.p50.x, geo.pts.p50.y);
  await page.waitFor("document.getElementById('feedback').textContent.startsWith('That was D,')");
  const fb50 = await page.evaluate("document.getElementById('feedback').textContent");
  const where50 = T === 62 ? 'Right note, wrong octave: go one octave up.' : `Go ${T - 50} keys to the right.`;
  assert.ok(fb50.endsWith(where50), `the click played 50, target ${T}: ` + fb50);
  assert.equal(await page.evaluate('window.__coach.cur().info.midi'), T, 'a miss does not move the target');
  // A click above every key plays nothing: no feedback change, no recorded answer.
  const before = await page.evaluate("document.getElementById('feedback').textContent + '|' + JSON.stringify(window.__coach.state().conf)");
  await page.click(geo.pts.out.x, geo.pts.out.y);
  await page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  assert.equal(await page.evaluate("document.getElementById('feedback').textContent + '|' + JSON.stringify(window.__coach.state().conf)"), before, 'a click outside every key changes nothing');
});
