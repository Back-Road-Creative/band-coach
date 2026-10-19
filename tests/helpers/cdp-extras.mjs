// Things an acceptance test needs from the DevTools protocol that
// tests/helpers/browser.mjs does not wrap: where a download lands, and
// localStorage written from OUTSIDE the page. Built only on page.cdp
// (send, browserSend, on), so a test gets no reach into the app.
//
// There is no dialog helper here: chooseFile (file-chooser.mjs) answers the
// dialogs the page raises during a pick, and two answerers would race.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

// Answers requests for one URL from the test instead of the network, through
// Fetch.requestPaused, so the page's own fetch() runs its real code path.
// `answer()` returns { status, body } (body is JSON-encoded unless a string) or
// { fail: 'InternetDisconnected' } to make the request fail as an offline
// browser's would. The CORS header is what the real host sends, so a file://
// page (Origin: null) is let through exactly as it is in production.
// Returns { seen, stop }: `seen` lists the URLs answered.
export async function stubRequests(page, url, answer) {
  const seen = [];
  await page.cdp.send('Fetch.enable', { patterns: [{ urlPattern: url }] });
  const off = page.cdp.on((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    seen.push(request.url);
    const r = answer(request);
    const done = r.fail
      ? page.cdp.send('Fetch.failRequest', { requestId, errorReason: r.fail })
      : page.cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: r.status ?? 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
          body: Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)).toString('base64'),
        });
    done.catch(() => {});
  });
  return { seen, stop: async () => { off(); await page.cdp.send('Fetch.disable'); } };
}

// Opens the browser's file chooser with a KEY on whatever holds focus (Enter or
// Space on a button, a file input, or a label made a button) and answers it with
// `filePath`, the way chooseFile does for a click. The caller has already Tabbed
// to the control; nothing here clicks. Chrome fires the input's own trusted
// change once. It answers NO dialogs: an app that confirm()s after reading the
// file does so after this returns, so the caller registers its own
// Page.javascriptDialogOpening answerer (page.cdp.on) before the pick.
export async function chooseFileByKey(page, key, filePath, { timeoutMs = WAIT_FLOOR_MS } = {}) {
  const file = resolve(filePath);
  const stat = statSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) throw new Error(`chooseFileByKey: no file at ${file}`);
  const waitMs = effectiveWaitMs(timeoutMs);
  let off = () => {};
  let timer;
  try {
    const opened = new Promise((res) => {
      off = page.cdp.on((msg) => { if (msg.method === 'Page.fileChooserOpened') res(msg.params); });
    });
    await page.cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await page.press(key);
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`chooseFileByKey: pressing ${JSON.stringify(key)} opened no file chooser within ${waitMs} ms`)), waitMs);
    });
    const { backendNodeId } = await Promise.race([opened, timeout]);
    await page.cdp.send('DOM.setFileInputFiles', { files: [file], backendNodeId });
  } finally {
    clearTimeout(timer);
    off();
    await page.cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  }
}

// Every control a Tab key can reach that the accessibility tree lists without a
// name. Reads Accessibility.getFullAXTree; a node counts when it is not ignored
// and has the `focusable` property. Returns [{ role, backendDOMNodeId, html }].
export async function unnamedFocusables(page) {
  await page.cdp.send('Accessibility.enable');
  const { nodes } = await page.cdp.send('Accessibility.getFullAXTree');
  const bad = [];
  for (const n of nodes) {
    if (n.ignored) continue;
    const focusable = (n.properties || []).some((p) => p.name === 'focusable' && p.value && p.value.value === true);
    if (!focusable) continue;
    if (n.name && typeof n.name.value === 'string' && n.name.value.trim()) continue;
    let html = '';
    try {
      const { object } = await page.cdp.send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId });
      const r = await page.cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){return this.outerHTML ? this.outerHTML.slice(0, 120) : String(this.nodeName)}', returnByValue: true });
      html = r.result.value;
    } catch { /* node gone */ }
    bad.push({ role: n.role && n.role.value, backendDOMNodeId: n.backendDOMNodeId, html });
  }
  return bad;
}
