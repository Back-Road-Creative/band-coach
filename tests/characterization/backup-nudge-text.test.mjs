// The reminder bar under the rail carries two messages: the backup reminder
// after a logged session, and the notice that saved progress could not be read
// at start-up (the unreadable text is kept under bandcoach.v1.corrupt). Both
// are learner-visible, so both come from the i18n tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const nudge = "(() => { const n = document.getElementById('backupNudge'); return { hidden: n.hidden, text: document.getElementById('backupNudgeText').textContent }; })()";

async function loggedSession(page) {
  await page.evaluate('window.__coach.startWithoutMic()');
  await page.evaluate('window.__coach.sess().judged = 8');
  await page.clickSelector('#endBtn');
}

test('the backup reminder after a logged session is in Spanish when the app is', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { locale: 'es', mod: 'kbd' } }));" });
  t.after(() => page.close());
  await loggedSession(page);
  const got = await page.evaluate(nudge);
  assert.equal(got.hidden, false, 'the reminder shows after a logged session');
  assert.match(got.text, /copia de seguridad/, `got: ${JSON.stringify(got.text)}`);
  assert.deepEqual(await page.evaluate('window.__coach.errors ? window.__coach.errors() : []'), []);
});

test('the backup reminder is English by default', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));" });
  t.after(() => page.close());
  await loggedSession(page);
  assert.match((await page.evaluate(nudge)).text, /Save a backup/);
});

test('saved progress that cannot be read is announced at start-up, and the copy is kept', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: "localStorage.setItem('bandcoach.v1', '{not json');" });
  t.after(() => page.close());
  const got = await page.evaluate(nudge);
  assert.equal(got.hidden, false, 'the notice shows without any action');
  assert.match(got.text, /could not be read/i, `got: ${JSON.stringify(got.text)}`);
  assert.match(got.text, /Restore a backup/);
  assert.equal(await page.evaluate("localStorage.getItem('bandcoach.v1.corrupt')"), '{not json');
});

test('readable saved progress shows no start-up notice', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: "localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));" });
  t.after(() => page.close());
  assert.equal((await page.evaluate(nudge)).hidden, true);
});
