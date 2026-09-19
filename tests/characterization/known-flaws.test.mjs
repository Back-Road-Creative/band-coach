// These tests pin bugs as CURRENT BEHAVIOUR on purpose — the module-split
// unit that follows this one must reproduce them exactly, and a later unit
// will deliberately flip each one. Do not "fix" these assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

// F1 was: for a string/fret item, the judging condition
// `(i.exact && exact) ? midi === i.midi : pc(midi) === pc(i.midi)` fell
// through to a pitch-class-only comparison whenever the item itself had no
// `exact` flag (true for every guitar/bass/uke string item) — regardless of
// whether the caller passed exact:true or exact:false. So a microphone pluck
// (exact:false) on the right string but the wrong octave still passed. Fixed
// by routing the judgement through src/core/judge.js's OCTAVE_POLICY, which
// marks gtr/bass/uke as 'exact'.
test('octave-exact: gtr rejects the right pitch class in the wrong octave from a mic pluck', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.ok(info.string, 'level-1 gtr items are string/fret notes');

  await page.evaluate(`window.__coach.note(${info.midi + 12}, false)`);
  await page.waitFor("document.getElementById('feedback').className !== ''");

  assert.equal(
    await page.evaluate("document.getElementById('feedback').className"),
    'no',
    'the wrong-octave pluck is now judged incorrect'
  );
});

// F9 (band-coach.html:658, :374): a captured-melody task is always built
// with warm: true, and credit() returns before incrementing S.judged /
// sess.judged whenever the task element is warm — so answering captured
// notes never counts toward the session's judged total.
test('CURRENT BEHAVIOUR (flaw F9): answering the captured-melody drill leaves sess().judged at 0', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate('window.__coach.db().custom = [60, 62, 64, 65]');
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate(`
    (function () {
      const cb = document.getElementById('optCustom');
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    })()
  `);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  for (let i = 0; i < 4; i++) {
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
    const midi = await page.evaluate('window.__coach.cur().info.midi');
    await page.evaluate(`window.__coach.note(${midi}, true)`);
  }
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  assert.equal(await page.evaluate('window.__coach.sess().judged'), 0, 'captured-melody answers never register as judged');
});

// E5 (band-coach.html:348, :758): setMod() unconditionally sets the module-
// level `mod` variable before checking MODS[m], and its trailing save() uses
// that same variable — so switching to a tool (no learner model of its own)
// still writes a `mods.<tool>` entry into localStorage.
test('CURRENT BEHAVIOUR (flaw E5): switching to the tuner tool writes a mods.tuner key to storage', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.setMod('tuner')");
  // save() debounces at 1.2s (band-coach.html:348).
  await new Promise((r) => setTimeout(r, 1500));

  const raw = await page.evaluate("localStorage.getItem('bandcoach.v1')");
  const parsed = JSON.parse(raw);
  assert.ok('tuner' in parsed.mods, 'a mods.tuner key exists even though tuner is a tool, not an instrument');
});
