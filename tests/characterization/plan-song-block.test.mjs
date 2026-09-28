// Today's plan (src/core/curriculum.js's planSession) gains a keyboard song
// block once a starter song is suggested (src/instruments/kbd-songs.js's
// songFor), and a returning keyboard learner sees one 'Welcome back' line
// naming their next keyboard-path step (src/core/pathway.js's pathwayState).
// Real entry points (clicks, a page reload), not the __coach hook alone, so
// this proves the shipped app, not just the debug surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { playHotCrossBunsToTheEnd } from '../helpers/play-hot-cross-buns.mjs';

const htmlPath = HTML_PATH;

test('the coach line and plan gain a song block at level 2, which turns done after playing it, and survives a reload', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 2');
  await page.evaluate("window.__coach.setMod('kbd')");

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const coachText1 = await page.evaluate("document.getElementById('coach').textContent");
  assert.match(coachText1, /play Hot Cross Buns/, `expected the plan to mention playing the song, got: ${coachText1}`);
  assert.ok(coachText1.includes('Hot Cross Buns: Not yet checked by a player.'), `expected the unreviewed song label, got: ${coachText1}`);

  const songBlock1 = await page.evaluate("window.__coach.plan().find(b => b.kind === 'song')");
  assert.equal(songBlock1.songId, 'hot-cross-buns');
  assert.equal(songBlock1.done, false);

  await page.evaluate("document.getElementById('kbdSongHandoff').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");

  await playHotCrossBunsToTheEnd(page);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Back to practice')",
    15000
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Back to practice').click()"
  );

  const rows = await page.evaluate("window.__coach.db().sessions");
  assert.ok(rows.some((r) => r.source === 'song' && r.songId === 'hot-cross-buns'), 'expected a logged song session row');

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const songBlock2 = await page.evaluate("window.__coach.plan().find(b => b.kind === 'song')");
  assert.equal(songBlock2.done, true, 'expected the song block to read done after playing it today');
  const coachText2 = await page.evaluate("document.getElementById('coach').textContent");
  assert.match(coachText2, /\(done today\)/, `expected the coach line to say done today, got: ${coachText2}`);

  await page.reload();
  await page.evaluate("window.__coach.setMod('kbd')");
  const level = await page.evaluate('window.__coach.state().level');
  assert.equal(level, 2, 'expected the level to survive the reload');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const songBlock3 = await page.evaluate("window.__coach.plan().find(b => b.kind === 'song')");
  assert.equal(songBlock3.done, true, 'expected the song block to still read done after a reload');

  assert.deepEqual(page.exceptions, []);
});

test('a returning keyboard learner sees one Welcome back line naming their next pathway step, once per page load', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate(`(function () {
    const db = window.__coach.db();
    db.mods.kbd.level = 2;
    db.sessions = [{ d: '2020-01-01', mod: 'kbd', min: 5, acc: 1, a1: 1, a2: 1, from: 2, to: 2, breaks: 0 }];
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const coachText1 = await page.evaluate("document.getElementById('coach').textContent");
  assert.ok(
    coachText1.includes('Welcome back. Next on your keyboard path: Connect a MIDI keyboard to start the pathway. Not yet checked by a player.'),
    `expected the welcome-back line, got: ${coachText1}`
  );

  await page.evaluate("document.getElementById('endBtn').click()");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const coachText2 = await page.evaluate("document.getElementById('coach').textContent");
  assert.ok(!coachText2.includes('Welcome back'), `expected no repeat Welcome back line this page load, got: ${coachText2}`);

  assert.deepEqual(page.exceptions, []);
});

test('a fresh keyboard learner with no prior-day session sees no Welcome back line', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate('window.__coach.state().level = 2');
  await page.evaluate("window.__coach.setMod('kbd')");

  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  const coachText = await page.evaluate("document.getElementById('coach').textContent");
  assert.ok(!coachText.includes('Welcome back'), `expected no Welcome back line for a fresh learner, got: ${coachText}`);

  assert.deepEqual(page.exceptions, []);
});
