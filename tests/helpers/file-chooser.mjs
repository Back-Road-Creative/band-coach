// Pick a file the way a person does: click the visible control that opens the
// file chooser, then answer the chooser through the DevTools protocol. Chrome
// then fires the input's own input and change events, once each and trusted,
// and nothing when the same file is picked again -- as for a person's pick.
// page.setFileInput sets the files and then dispatches a synthetic change on
// top (two changes for one pick), so acceptance tests pick files through here.
//
// Dialogs: DOM.setFileInputFiles returns only after the page's change handler
// returns, and a handler that calls confirm() waits for an answer (the app's
// backup-restore handler does). So chooseFile answers every JavaScript dialog
// the page opens during the pick: { dialog: 'accept' } or { dialog: 'dismiss' }.
// With no option it dismisses the dialog and rejects, naming it, so the page is
// never left stuck in a modal. A caller must not answer dialogs itself during a
// pick (two answers would race); dialogs the page opens after the pick returns
// are the caller's. The result lists the dialogs seen: { dialogs: [{ type, message }] }.
//
// DOM.setFileInputFiles does not apply the input's accept filter (a .txt lands
// in an accept="audio/*" input), so a test cannot use chooseFile to show that
// the app's accept filter keeps a wrong file type out.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { WAIT_FLOOR_MS, effectiveWaitMs } from './browser.mjs';

export async function chooseFile(page, selector, filePath, { timeoutMs = WAIT_FLOOR_MS, dialog } = {}) {
  const file = resolve(filePath);
  const stat = statSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) throw new Error(`chooseFile: no file at ${file}`);
  if (dialog !== undefined && dialog !== 'accept' && dialog !== 'dismiss') throw new Error("chooseFile: dialog must be 'accept' or 'dismiss'");
  const waitMs = effectiveWaitMs(timeoutMs);
  const dialogs = [];
  let off = () => {};
  let timer;
  try {
    const opened = new Promise((res) => {
      off = page.cdp.on((msg) => {
        if (msg.method === 'Page.fileChooserOpened') res(msg.params);
        if (msg.method === 'Page.javascriptDialogOpening') {
          dialogs.push({ type: msg.params.type, message: msg.params.message });
          page.cdp.send('Page.handleJavaScriptDialog', { accept: dialog === 'accept' }).catch(() => {});
        }
      });
    });
    await page.cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await page.clickSelector(selector);
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`chooseFile: clicking ${selector} opened no file chooser within ${waitMs} ms`)), waitMs);
    });
    const { backendNodeId } = await Promise.race([opened, timeout]);
    await page.cdp.send('DOM.setFileInputFiles', { files: [file], backendNodeId });
  } finally {
    clearTimeout(timer);
    off();
    // The page may already be gone; the first error is the one worth seeing.
    await page.cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  }
  if (dialogs.length && !dialog) {
    const { type, message } = dialogs[0];
    throw new Error(`chooseFile: the page opened a ${type} dialog during the pick ("${message}"); pass { dialog: 'accept' } or { dialog: 'dismiss' }`);
  }
  return { dialogs };
}
