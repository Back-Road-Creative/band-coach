// Writes a desktop and a phone PNG of the already-built app to dist/, so a
// UI change can be looked at by the repo, by CI and by a future session
// instead of only by a human pasting an ad hoc shell command. This never
// builds anything itself -- it opens `dist/band-coach.html` exactly as the
// test suite does (see tests/helpers/html-path.mjs), so `npm run build` must
// have already run. Kept a separate step, not folded into `build`, because
// the two answer different questions: `build` asks "does the app still
// bundle", `shots` asks "what does it look like" -- forcing every build to
// also boot a browser would slow the common case for a check most builds
// don't need.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { launchPage } from '../tests/helpers/browser.mjs';
import { build } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const HTML_PATH = join(root, 'dist', 'band-coach.html');
const OUT_DIR = join(root, 'dist');

// A laptop-width desktop layout (above the 1080px `.wrap` max-width AND the
// 860px single-column breakpoint in src/styles.css, so the real multi-column
// desktop layout is what gets captured) and a real phone's logical size
// (390x844, an iPhone 12/13/14 -- comfortably under the 480px/400px
// small-screen breakpoints), rather than arbitrary round numbers, so each
// shot exercises a layout mode the app actually switches into.
export const SHOTS = [
  { name: 'screenshot-desktop.png', width: 1440, height: 900, mobile: false },
  { name: 'screenshot-phone.png', width: 390, height: 844, mobile: true },
];

/**
 * Captures every entry in SHOTS from the built app and writes each PNG into
 * `outDir` (defaults to dist/, the real output). Returns the list of paths
 * written. `outDir` is a parameter for the same reason build()'s is -- a
 * test that ran this should never fight the real `npm run shots` (or another
 * test) over dist/ paths.
 */
export async function captureShots({ htmlPath = HTML_PATH, outDir = OUT_DIR } = {}) {
  if (!existsSync(htmlPath)) {
    throw new Error(`${htmlPath} does not exist -- run "npm run build" first`);
  }
  const page = await launchPage(htmlPath);
  const written = [];
  try {
    for (const { name, width, height, mobile } of SHOTS) {
      await page.setViewport({ width, height, mobile });
      const outPath = join(outDir, name);
      await page.screenshot(outPath);
      written.push(outPath);
    }
  } finally {
    await page.close();
  }
  return written;
}

/**
 * Writes <outDir>/shots/<id>-<idle|how|target>-<desktop|phone>.png for every
 * instrument the picker lists, plus shots/index.html as a contact sheet, so a
 * person or agent can check how each instrument is drawn for learning.
 * The id list is read from the running page's own picker (tools such as ear,
 * rhy, tuner and capture are not instruments and are left out). Needs the dev
 * build: it drives window.__coach. Instruments with no How-to-play chart
 * (the how panel would silently show the guitar) get no how shot and are
 * returned in `noHow`; a target state that cannot be reached is returned in
 * `skipped` with its reason, never dropped.
 */
export async function captureInstrumentShots({ htmlPath = HTML_PATH, outDir = OUT_DIR } = {}) {
  if (!existsSync(htmlPath)) {
    throw new Error(`${htmlPath} does not exist -- run "npm run build" first`);
  }
  const dir = join(outDir, 'shots');
  mkdirSync(dir, { recursive: true });
  const page = await launchPage(htmlPath);
  const written = [];
  const noHow = [];
  const skipped = [];
  const shotsMeta = [];
  const settle = () => page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const snap = async (el, block, id, state, label) => {
    await page.evaluate(`document.getElementById(${JSON.stringify(el)}).scrollIntoView({block:${JSON.stringify(block)}})`);
    await settle();
    const out = join(dir, `${id}-${state}-${label}.png`);
    await page.screenshot(out);
    written.push(out);
    shotsMeta.push({ id, state, size: label, file: basename(out) });
  };
  try {
    const ids = await page.evaluate(
      "[...document.querySelectorAll('#picker button[data-mod]')].filter(b => !b.closest('#pickerTools')).map(b => b.dataset.mod)",
    );
    for (const { width, height, mobile } of SHOTS) {
      const label = mobile ? 'phone' : 'desktop';
      await page.setViewport({ width, height, mobile });
      for (const id of ids) {
        await page.evaluate(`window.__coach.setMod(${JSON.stringify(id)})`);
        await settle();
        await snap('cv', 'center', id, 'idle', label);
        await page.evaluate("window.__coach.openPanel('fingerings')");
        try {
          const shown = await page.evaluate("document.getElementById('fingInstrument') && document.getElementById('fingInstrument').value");
          if (shown === id) await snap('panelHost', 'start', id, 'how', label);
          else if (!noHow.includes(id)) noHow.push(id);
        } finally {
          await page.evaluate('window.__coach.closePanel()');
        }
        try {
          await page.evaluate('window.__coach.startWithoutMic()');
          await page.waitFor('window.__coach.task()', 5000);
          await snap('cv', 'center', id, 'target', label);
        } catch (e) {
          skipped.push({ id, state: 'target', size: label, reason: String((e && e.message) || e) || 'unknown' });
        }
      }
    }
    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const sections = ids.map((id) => {
      const figs = shotsMeta.filter((m) => m.id === id).map((m) =>
        `<figure><img src="${esc(m.file)}" alt="${esc(`${id} ${m.state} ${m.size}`)}"><figcaption>${esc(id)} ${m.state} ${m.size}</figcaption></figure>`);
      return `<section><h2>${esc(id)}</h2>${noHow.includes(id) ? '<p>no how panel</p>' : ''}<div style="display:flex;flex-wrap:wrap;gap:12px">${figs.join('')}</div></section>`;
    });
    const skippedHtml = skipped.length
      ? `<ul>${skipped.map((s) => `<li>${esc(s.id)} ${s.state} ${s.size}: ${esc(s.reason)}</li>`).join('')}</ul>`
      : '<p>none</p>';
    const sheet = join(dir, 'index.html');
    writeFileSync(sheet, `<!doctype html>\n<html><head><meta charset="utf-8"><title>Band Coach instrument shots</title><style>img{max-width:480px;border:1px solid #888}</style></head><body><h1>Instrument shots</h1>${sections.join('\n')}<h2>Skipped</h2>${skippedHtml}</body></html>\n`);
    return { ids, written, noHow, skipped, sheet };
  } finally {
    await page.close();
  }
}

/**
 * Build, then capture. This is what `npm run shots` runs, and it exists so a
 * screenshot cannot depict a stale bundle.
 *
 * `captureShots` only checks that the built file EXISTS, and a stale one
 * exists -- so shooting whatever happened to be in dist/ succeeded silently
 * against a build from hours earlier. A screenshot is the one artefact whose
 * entire job is to be believed, and on 2026-09-21 an out-of-date one showing
 * none of that day's UI work was nearly reported as a regression in shipped
 * code. Checking freshness here would only turn that into a late failure;
 * building first removes the stale-input state altogether.
 *
 * `build` and `shots` stay separate npm SCRIPTS for the reason given at the
 * top of this file -- building should not boot a browser. That argument is
 * about `build` not shooting, and says nothing against `shots` building.
 */
export async function shoot({ outDir = OUT_DIR } = {}) {
  const htmlPath = await build({ outDir });
  return captureShots({ htmlPath, outDir });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv.includes('--instruments')) {
    const htmlPath = await build({ outDir: OUT_DIR });
    const r = await captureInstrumentShots({ htmlPath, outDir: OUT_DIR });
    for (const path of r.written) console.log(`wrote ${path}`);
    console.log(`wrote ${r.sheet}`);
    console.log(`no how panel: ${r.noHow.join(', ') || 'none'}`);
    for (const s of r.skipped) console.log(`skipped ${s.id} ${s.state} ${s.size}: ${s.reason}`);
  } else {
    const written = await shoot();
    for (const path of written) console.log(`wrote ${path}`);
  }
}
