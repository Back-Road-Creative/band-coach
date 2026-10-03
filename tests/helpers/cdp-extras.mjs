// Things an acceptance test needs from the DevTools protocol that
// tests/helpers/browser.mjs does not wrap: where a download lands, and
// localStorage written from OUTSIDE the page. Built only on page.cdp
// (send, browserSend, on), so a test gets no reach into the app.
//
// There is no dialog helper here: chooseFile (file-chooser.mjs) answers the
// dialogs the page raises during a pick, and two answerers would race.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WAIT_FLOOR_MS, effectiveWaitMs } from './browser.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Downloads. Browser.setDownloadBehavior sends every download of the browser's
// default context to `dir`. Chrome writes "<name>.crdownload" first and renames
// it when the download is done, so a finished file is one that exists, has no
// .crdownload sibling and keeps one size across two polls. Events for a
// download may arrive only on the browser session, which page.cdp.on does not
// see, so this polls the directory and never waits on an event. Give each save
// its own directory: a second save of the same name is renamed "name (1).ext".
export async function captureDownloads(page, dir) {
  mkdirSync(dir, { recursive: true });
  await page.cdp.browserSend('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
  return async function waitForDownload(name, { timeoutMs = WAIT_FLOOR_MS } = {}) {
    const waitMs = effectiveWaitMs(timeoutMs);
    const path = join(dir, name);
    const start = Date.now();
    let lastSize = -1;
    for (;;) {
      const settled = existsSync(path) && !existsSync(`${path}.crdownload`);
      if (settled) {
        const size = statSync(path).size;
        if (size === lastSize) return { path, text: readFileSync(path, 'utf8') };
        lastSize = size;
      } else {
        lastSize = -1;
      }
      if (Date.now() - start > waitMs) {
        throw new Error(`waitForDownload: no finished download named ${name} in ${dir} within ${waitMs} ms; the folder holds ${JSON.stringify(readdirSync(dir))}`);
      }
      await sleep(100);
    }
  };
}

// localStorage from outside the page. DOMStorage addresses the area by origin;
// a file:// page's origin is "file://" (location.origin reads "null"), so it is
// taken from the frame tree. A write the browser refuses for lack of room does
// not raise: the item is simply not there afterwards, so callers read it back.
async function storageIdOf(page) {
  const { frameTree } = await page.cdp.send('Page.getFrameTree');
  await page.cdp.send('DOMStorage.enable');
  return { securityOrigin: frameTree.frame.securityOrigin, isLocalStorage: true };
}

export async function localStorageItem(page, key) {
  const storageId = await storageIdOf(page);
  const { entries } = await page.cdp.send('DOMStorage.getDOMStorageItems', { storageId });
  const hit = entries.find(([k]) => k === key);
  return hit ? hit[1] : null;
}

export async function setLocalStorageItem(page, key, value) {
  const storageId = await storageIdOf(page);
  await page.cdp.send('DOMStorage.setDOMStorageItem', { storageId, key, value });
}

// Reads an item's length without hauling every other item across the wire.
const storedLength = (page, key) =>
  page.evaluate(`(() => { const v = localStorage.getItem(${JSON.stringify(key)}); return v === null ? -1 : v.length; })()`);

// Fills localStorage until one more character in any item is refused. Chrome
// refuses a write only when it makes an item longer than the room left, so
// what stays free afterwards is under one character: a rewrite of an item at
// the same length or shorter still works, any growth does not. Big filler items
// in shrinking chunks first, then a one-letter-key item grown one character at
// a time (at most a dozen small writes), so the room left is under one character.
export async function fillLocalStorage(page, { prefix = '__bc_fill_' } = {}) {
  const storageId = await storageIdOf(page);
  const put = async (key, value) => {
    await page.cdp.send('DOMStorage.setDOMStorageItem', { storageId, key, value });
    return (await storedLength(page, key)) === value.length;
  };
  let n = 0;
  for (let chunk = 1 << 21; chunk >= 1; ) {
    if (await put(`${prefix}${n}`, 'x'.repeat(chunk))) n += 1;
    else chunk >>= 1;
  }
  // -1 means there was no room even for an empty item.
  let tail = -1;
  while (await put('z', 'x'.repeat(tail + 1))) tail += 1;
  return { fillerItems: n, tailLength: tail };
}

// Fallback for a browser where the real fill cannot be provoked: a setItem
// that throws QuotaExceededError for the profile key while the flag
// '__bc_fault_full' is '1'. Flip the flag with setLocalStorageItem, never from
// the page. A test using this must say so: launchPage(..., { initScript:
// FULL_STORAGE_STUB, simulated: ['Storage.prototype.setItem stub: ...'] }).
export const FULL_STORAGE_STUB = `(() => {
  const real = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === 'bandcoach.v1' && this === window.localStorage && window.localStorage.getItem('__bc_fault_full') === '1') {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    return real.call(this, key, value);
  };
})();`;
