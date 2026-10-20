// E9 agent-led qualification of the "Human on device" rows
// (docs/release-acceptance-record.md, D2 / E9 ledger). What an emulated
// Chromium CAN show about each row, measured through real input where input
// matters: the accessibility tree a screen reader reads (CDP Accessibility
// domain), Start reached and pressed with real Tab/Enter key events, phone
// width with touch emulation, the browser's default font size (the setting a
// "text size" control changes, CDP Page.setFontSizes) and an e-kit's General
// MIDI notes through the fake Web MIDI port. Target-size and font-size
// figures go out as diagnostics so the record can quote them; the asserts pin
// only what holds today. None of this is a claim about a real phone, screen
// reader, keyboard or kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn } from '../helpers/fake-midi.mjs';

const STATES = ['first-paint', 'songs', 'progress', 'settings'];
const PHONE = { width: 390, height: 844, mobile: true };
const INTERACTIVE = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'combobox', 'slider', 'tab', 'menuitem', 'spinbutton', 'listbox']);

async function goTo(page, state) {
  if (state === 'first-paint') return;
  await page.evaluate(`document.querySelector('#mainNav button[data-route="${state}"]').click()`);
  await page.waitFor(`document.querySelector('#mainNav button[data-route="${state}"]').getAttribute('aria-current') === 'page'`);
}

async function axNodes(page) {
  const { nodes } = await page.cdp.send('Accessibility.getFullAXTree', {});
  return nodes.filter((n) => !n.ignored);
}

const TARGET_BOXES = `JSON.stringify([...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,label[for],summary,[role=button],[tabindex]:not([tabindex="-1"])')]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'); })
  .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height) }; }))`;

test('screen-reader rows: every control in the four main states has a role and a name in the accessibility tree', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.setViewport(PHONE);
  await page.cdp.send('Accessibility.enable', {});
  for (const state of STATES) {
    await goTo(page, state);
    const controls = (await axNodes(page)).filter((n) => INTERACTIVE.has(n.role?.value));
    assert.ok(controls.length >= 20, `${state}: only ${controls.length} controls in the tree`);
    const unnamed = controls.filter((n) => !(n.name?.value || '').trim()).map((n) => `${n.role.value} (backend node ${n.backendDOMNodeId})`);
    assert.deepEqual(unnamed, [], `${state}: controls a screen reader would announce with no name`);
    t.diagnostic(`${state}: ${controls.length} named controls`);
  }
});

test('screen-reader lesson: Start reached and pressed with real keys; the canvas reads as an image with the task as its description; the prompt is polite', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.setViewport({ width: 1280, height: 800 });
  await page.cdp.send('Accessibility.enable', {});
  let presses = 0;
  // One question first: the instrument is chosen with the keyboard too, then Start appears.
  while (presses < 80 && !(await page.evaluate("!!(document.activeElement && document.activeElement.closest('#picker button'))"))) { await page.press('Tab'); presses++; }
  await page.press('Enter');
  while (presses < 80 && !(await page.evaluate("document.activeElement.id === 'playBtn'"))) { await page.press('Tab'); presses++; }
  assert.equal(await page.evaluate('document.activeElement.id'), 'playBtn', `Start not reached in ${presses} Tab presses`);
  t.diagnostic(`Start reached after ${presses} Tab presses from the top of the page`);
  await page.press('Enter');
  await page.waitFor('window.__coach.task()');
  const canvas = (await axNodes(page)).filter((n) => n.role?.value === 'image' && n.name?.value === 'Exercise display');
  assert.equal(canvas.length, 1, 'one canvas image named "Exercise display"');
  const desc = canvas[0].description?.value || '';
  assert.equal(desc, await page.evaluate("document.getElementById('cvDesc').textContent"), 'the image description is the live task sentence');
  assert.ok(desc.length > 10, `description too short: ${JSON.stringify(desc)}`);
  assert.equal(await page.evaluate("document.getElementById('prompt').getAttribute('aria-live')"), 'polite');
  // Start blurs itself (src/app.js playBtn handler) so letter and space keys
  // reach the instrument; the next Tab lands on End. Pinned as found, so a
  // change to it is a deliberate one.
  assert.equal(await page.evaluate('document.activeElement === document.body'), true, 'focus after Start');
  await page.press('Tab');
  assert.equal(await page.evaluate('document.activeElement.id'), 'endBtn', 'Tab after Start reaches End');
  assert.deepEqual(page.exceptions, []);
});

test('phone and text-size rows: measured at 390 px with touch, and with the default font at 100/150/200%', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.setViewport(PHONE);
  await page.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (const state of STATES) {
    await goTo(page, state);
    const boxes = JSON.parse(await page.evaluate(TARGET_BOXES));
    const small = (n) => boxes.filter((b) => Math.min(b.w, b.h) < n);
    t.diagnostic(`${state}: ${boxes.length} targets, ${small(44).length} under 44 px, under 24 px: ${small(24).map((b) => `${b.id} ${b.w}x${b.h}`).join(', ') || 'none'}`);
    assert.ok(boxes.length >= 20, `${state}: only ${boxes.length} targets measured`);
  }
  for (const px of [16, 24, 32]) {
    await page.cdp.send('Page.setFontSizes', { fontSizes: { standard: px, fixed: Math.round((px * 13) / 16) } });
    for (const state of STATES) {
      await goTo(page, state);
      const m = JSON.parse(await page.evaluate("JSON.stringify({ root: getComputedStyle(document.documentElement).fontSize, body: getComputedStyle(document.body).fontSize, sideways: document.documentElement.scrollWidth - innerWidth })"));
      assert.equal(m.sideways, 0, `default font ${px}px, ${state}: page scrolls sideways by ${m.sideways}px`);
      if (state === 'first-paint') t.diagnostic(`default font ${px}px: root ${m.root}, body ${m.body}`);
    }
  }
});

test('e-kit row: General MIDI drum notes through a MIDI port name the right drum, on channel 10 and channel 1', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await midiAddPort(page, 'k1', 'Synthetic e-kit');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioText').textContent.length > 0");
  const cases = [[36, 9, /^Bass drum heard/], [38, 9, /^Snare heard/], [42, 9, /^Hi-hat \(closed\) heard/], [44, 9, /^Hi-hat \(pedal\) heard/], [38, 0, /^Snare heard/], [99, 9, /^MIDI note 99 is not one of the drums on this kit/]];
  for (const [note, channel, want] of cases) {
    await page.evaluate("document.getElementById('coach').textContent = ''");
    await midiNoteOn(page, 'k1', note, 100, channel);
    await page.waitFor("document.getElementById('coach').textContent.length > 0");
    const said = await page.evaluate("document.getElementById('coach').textContent");
    assert.match(said, want, `note ${note} on channel ${channel + 1}`);
  }
  assert.match(await page.evaluate("document.getElementById('ioText').textContent"), /Synthetic e-kit is working/);
});
