// Export as a challenge and Share with your band read the saved song library.
// Where that store cannot be opened (IndexedDB blocked or broken), the learner
// must be told their songs could not be read -- never "add some songs first",
// which tells someone who HAS songs that the library is empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const BREAK_IDB = `indexedDB.open = function () { const req = {}; setTimeout(() => { req.error = new Error('blocked'); if (req.onerror) req.onerror(); }, 0); return req; };`;

async function open(t, initScript) {
  const page = await launchPage(HTML_PATH, { initScript });
  t.after(() => page.close());
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  return page;
}
const click = (page, label) => page.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(label)}).click()`);

test('export as a challenge says the songs could not be read when storage fails', async (t) => {
  const page = await open(t, BREAK_IDB);
  await click(page, 'Export as a challenge');
  await page.waitFor("document.querySelector('.panel-songs-export-msg').textContent.length > 0");
  const msg = await page.evaluate("document.querySelector('.panel-songs-export-msg').textContent");
  assert.match(msg, /could not be read from this browser/i);
  assert.match(msg, /blocked/, 'includes the underlying error message');
  assert.doesNotMatch(msg, /add some songs/i);
});

test('share with your band says the songs could not be read when storage fails', async (t) => {
  const page = await open(t, BREAK_IDB);
  // The button is disabled when the list read fails; clear that to reach the handler.
  await page.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Share with your band').removeAttribute('disabled')");
  await click(page, 'Share with your band');
  await page.waitFor("document.querySelector('.panel-songs-share-msg').textContent.length > 0");
  const msg = await page.evaluate("document.querySelector('.panel-songs-share-msg').textContent");
  assert.match(msg, /could not be read from this browser/i);
  assert.doesNotMatch(msg, /add some songs/i);
});

test('a genuinely empty library still says to add songs first', async (t) => {
  const page = await open(t, '');
  await click(page, 'Export as a challenge');
  await page.waitFor("document.querySelector('.panel-songs-export-msg').textContent.length > 0");
  assert.match(await page.evaluate("document.querySelector('.panel-songs-export-msg').textContent"), /add some songs/i);
});
