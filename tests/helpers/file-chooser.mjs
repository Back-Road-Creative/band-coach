// Pick a file the way a person does: click the visible control that opens the
// file chooser, then answer the chooser through the DevTools protocol. Chrome
// then fires the input's own input and change events, once each and trusted,
// and nothing when the same file is picked again -- as for a person's pick.
// page.setFileInput sets the files and then dispatches a synthetic change on
// top (two changes for one pick), so acceptance tests pick files through here.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WAIT_FLOOR_MS, effectiveWaitMs } from './browser.mjs';

export async function chooseFile(page, selector, filePath, { timeoutMs = WAIT_FLOOR_MS } = {}) {
  const file = resolve(filePath);
  if (!existsSync(file)) throw new Error(`chooseFile: no file at ${file}`);
  const waitMs = effectiveWaitMs(timeoutMs);
  let off = () => {};
  const opened = new Promise((res) => {
    off = page.cdp.on((msg) => { if (msg.method === 'Page.fileChooserOpened') res(msg.params); });
  });
  let timer;
  await page.cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
  try {
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
}
