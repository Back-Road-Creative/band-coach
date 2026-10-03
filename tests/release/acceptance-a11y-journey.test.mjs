// Acceptance: a learner who cannot use a mouse, who has enlarged the text, who
// prefers the other theme or who asked the system for less motion can still
// start, play, pause, stop and leave a screen. The existing keyboard and axe
// checks run the dev build and set state through the debug hook; this runs the
// RELEASE file with real Tab / Shift-Tab / Enter / Escape and letter keys from
// the browser's input pipeline, and reads only what a person could see.
//
// Launch A is one page, walked in order (steps are t.test blocks so a failure
// names the step; viewports change with setViewport, an OS-level setting). Launch
// B starts with the system's reduced-motion setting already on, which is the
// path a person with that setting takes (the app reads it at boot).
//
// Not in here, on purpose: whether a screen reader SPEAKS the feedback (manual:
// NVDA and VoiceOver); Tab order against visual order on a phone (the Start row
// moves to the top visually, a manual note); anything written into the page.
// A finding the product fails today is written in full and marked `todo` with
// its id; fixing it turns the check green without editing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage, VIEWPORTS } from '../helpers/browser.mjs';
import { axeSource, WCAG_TAGS, formatViolations, tabTo, rectOf, assertInFirstScreen } from '../helpers/journey.mjs';

// ---- the recorder: what was drawn and what the live regions were told ------
// Installed before the app boots. It wraps strokeRect and calls the original
// unchanged; it watches #feedback / #feedbackCard / #prompt with observers.
// Each prompt record carries `bid`, an id for the current <b> node (0 when
// there is none), so "a NEW question" is a node change, not a text change (the
// next question may repeat the note). Both lists keep their last 2000 records.
const RECORDER = `(() => {
  const KEEP = 2000;
  const q = (window.__q62 = { strokes: [], texts: [] });
  const ids = new WeakMap();
  let next = 0;
  const push = (a, r) => { a.push(r); if (a.length > KEEP) a.splice(0, a.length - KEEP); };
  const orig = CanvasRenderingContext2D.prototype.strokeRect;
  CanvasRenderingContext2D.prototype.strokeRect = function (x, y, w, h) {
    push(q.strokes, { strokeStyle: String(this.strokeStyle).toLowerCase(), lineWidth: this.lineWidth, x, y, w, h, t: performance.now() });
    return orig.apply(this, arguments);
  };
  document.addEventListener('DOMContentLoaded', () => {
    const rec = (id) => {
      const el = document.getElementById(id);
      const b = id === 'prompt' && el ? el.querySelector('b') : null;
      if (b && !ids.has(b)) ids.set(b, ++next);
      push(q.texts, { id, text: el ? el.textContent : '', hidden: el ? el.hidden : null, bid: b ? ids.get(b) : 0, t: performance.now() });
    };
    const watch = (id, opts) => { const el = document.getElementById(id); if (el) new MutationObserver(() => rec(id)).observe(el, opts); };
    watch('feedback', { childList: true, characterData: true, subtree: true });
    watch('feedbackCard', { attributes: true, attributeFilter: ['hidden'] });
    watch('prompt', { childList: true, characterData: true, subtree: true });
  });
})();`;

const AXE_TAGS = [...WCAG_TAGS, 'wcag22aa'];
const BAD_FLASH = '#ff6b5e';
const FOCUS_BOX = '#ffd23f';
// The selector dialog-focus.js uses to decide what Tab may reach inside the break card.
const DIALOG_FOCUSABLE = 'button:not([hidden]):not(:disabled), [href], input:not([hidden]):not(:disabled), select:not([hidden]):not(:disabled), textarea:not([hidden]):not(:disabled), [tabindex]:not([tabindex="-1"])';

const KBD_BUTTON = '#picker button[data-mod="kbd"]';
const SONGS_NAV = '#mainNav button[data-route="songs"]';
const PRACTICE_NAV = '#mainNav button[data-route="practice"]';
const SETTINGS_NAV = '#mainNav button[data-route="settings"]';

// ---- small helpers (all input is real browser input; evaluate only reads) ---
const shiftTab = (page) => page.press('Tab', { modifiers: 8 }); // CDP Shift bit; the browser moves focus backward (probe P1)
const read = (page, expr) => page.evaluate(expr);
const isHidden = (page, id) => read(page, `document.getElementById(${JSON.stringify(id)}).hidden`);
const activeId = (page) => read(page, 'document.activeElement.id');
const activeIs = (page, selector) => read(page, `document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
const insideCard = (page) => read(page, "document.getElementById('breakCard').contains(document.activeElement)");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Level 1 asks for C, D or E; the upper computer-key row plays them (a, s, d).
const KEY_FOR = { C: 'a', D: 's', E: 'd' };
const WRONG_KEY_FOR = { C: 's', D: 'd', E: 's' }; // a neighbouring natural, never the target

// Presses the key for the note on screen (or a different natural when `wrong`)
// and says when and against which question. Press as soon as a question shows:
// an idle running session fails the question after 8 s and pauses after 30 s more.
async function playTarget(page, { wrong = false } = {}) {
  const info = await read(page, `(() => {
    const b = document.querySelector('#prompt b');
    const last = window.__q62.texts.filter((r) => r.id === 'prompt').pop();
    return { target: b ? b.textContent.trim() : null, bid: last ? last.bid : 0, t0: performance.now() };
  })()`);
  if (!KEY_FOR[info.target]) throw new Error(`playTarget: expected a level 1 note (C, D or E) in #prompt b, found ${JSON.stringify(info.target)}`);
  const key = wrong ? WRONG_KEY_FOR[info.target] : KEY_FOR[info.target];
  await page.press(key, { text: key });
  return { ...info, key, wrong };
}

// A right answer brings a new question about 0.7 s later; keys pressed in
// between are not judged, so wait for a new <b> node before the next note.
const waitNewQuestion = (page, { bid, t0 }) =>
  page.waitFor(`window.__q62.texts.some((r) => r.id === 'prompt' && r.t > ${t0} && r.bid && r.bid !== ${bid})`);

// What the browser did to the key's focus ring and whether something sits on top of the control.
const readStop = (page, label) =>
  read(page, `(() => {
    const el = document.activeElement, s = getComputedStyle(el), b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { label: ${JSON.stringify(label)}, id: el.id, tag: el.tagName, outlineStyle: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth),
      width: b.width, height: b.height, covered: !(hit && (hit === el || el.contains(hit))), hit: hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : null };
  })()`);

async function runAxe(page, label) {
  const results = await page.evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} } })`);
  assert.equal(results.violations.length, 0, formatViolations(label, results.violations));
}

// Opens the instrument sheet if it is shut, picks Keyboard, and presses Start,
// all with keys; leaves the session running with a question on screen.
async function startKeyboardSession(page, stops) {
  if (await isHidden(page, 'picker')) {
    await tabTo(page, '#navInstrument');
    await page.press('Enter');
    await page.waitFor("!document.getElementById('picker').hidden");
  }
  await tabTo(page, KBD_BUTTON);
  if (stops) stops.push(await readStop(page, 'picker kbd'));
  await page.press('Enter');
  await tabTo(page, '#playBtn');
  if (stops) stops.push(await readStop(page, 'playBtn'));
  await page.press('Enter');
  await page.waitFor("!document.getElementById('endBtn').hidden && !!document.querySelector('#prompt b')");
}

async function endSessionByKeyboard(page, stops) {
  await tabTo(page, '#endBtn');
  if (stops) stops.push(await readStop(page, 'endBtn'));
  await page.press('Enter');
  await page.waitFor("document.getElementById('endBtn').hidden");
}

// The status regions the accessibility tree exposes, each with the text under it
// (read-only DevTools; "Accessibility.getFullAXTree").
async function statusRegionTexts(page) {
  await page.cdp.send('Accessibility.enable');
  const { nodes } = await page.cdp.send('Accessibility.getFullAXTree');
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const textUnder = (n) => [n.name && n.name.value ? n.name.value : '', ...(n.childIds || []).map((c) => (byId.get(c) ? textUnder(byId.get(c)) : ''))].filter(Boolean).join(' ');
  return nodes
    .filter((n) => !n.ignored && n.role && n.role.value === 'status')
    .map((n) => ({ live: ((n.properties || []).find((p) => p.name === 'live') || { value: {} }).value.value, text: textUnder(n) }));
}

const feedbackRecords = (page, since) =>
  read(page, `window.__q62.texts.filter((r) => r.id === 'feedback' && r.t > ${since})`);

// Chooses a theme in #optTheme with ArrowUp / ArrowDown (the order is system, light, dark).
async function chooseTheme(page, want) {
  const order = ['system', 'light', 'dark'];
  for (let i = 0; i < 4; i++) {
    const have = await read(page, "document.getElementById('optTheme').value");
    if (have === want) return i;
    await page.press(order.indexOf(want) > order.indexOf(have) ? 'ArrowDown' : 'ArrowUp');
  }
  assert.equal(await read(page, "document.getElementById('optTheme').value"), want, `could not reach theme ${want} with the arrow keys`);
  return 4;
}

const bodyBackground = (page) => read(page, 'getComputedStyle(document.body).backgroundColor');
const dataTheme = (page) => read(page, 'document.documentElement.dataset.theme || null');

// ---------------------------------------------------------------------------
test('keyboard and accessibility journey on the release file (launch A, one page)', async (t) => {
  await withAcceptancePage(t, { initScript: RECORDER }, async (page) => {
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluate(axeSource);
    const stops = []; // every control reached by Tab, with what the browser drew on it
    const run = { right: null, wrong: null }; // the two notes of the journey

    await t.test('A11-7 axe: first load (the sheet is open on a fresh profile)', async () => {
      assert.equal(await isHidden(page, 'picker'), false, 'a fresh profile starts with the instrument sheet open');
      await runAxe(page, 'first load');
    });

    await t.test('A11-1 pick Keyboard and press Start with keys alone', async () => {
      if (await isHidden(page, 'picker')) { await tabTo(page, '#navInstrument'); await page.press('Enter'); }
      await tabTo(page, KBD_BUTTON);
      stops.push(await readStop(page, 'picker kbd'));
      await shiftTab(page);
      assert.equal(await activeIs(page, KBD_BUTTON), false, 'Shift-Tab moved focus off the Keyboard button');
      await page.press('Tab');
      assert.equal(await activeIs(page, KBD_BUTTON), true, 'Tab brought focus back to the Keyboard button');
      await page.press('Enter');
      const pressed = await read(page, "[...document.querySelectorAll('#picker button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.mod || b.dataset.panel || b.textContent.trim())");
      assert.deepEqual(pressed, ['kbd'], 'only Keyboard is marked pressed in the instrument sheet');
      assert.equal(await isHidden(page, 'picker'), true, 'choosing an instrument closes the sheet');
      await tabTo(page, '#playBtn');
      stops.push(await readStop(page, 'playBtn'));
      await page.press('Enter');
      await page.waitFor("!document.getElementById('endBtn').hidden");
      assert.equal(await isHidden(page, 'endBtn'), false, 'End session is shown once Start is pressed (a session is running)');
      await page.waitFor("!!document.querySelector('#prompt b')");
    });

    await t.test('A11-7 axe: a session running with a question on screen', async () => {
      await runAxe(page, 'session running with a prompt');
    });

    await t.test('A11-1 a right note brings a new question; a wrong note is judged', async () => {
      run.right = await playTarget(page);
      await waitNewQuestion(page, run.right);
      assert.ok(await read(page, "document.querySelector('#prompt b').textContent.trim().length > 0"), 'the new question names a note');
      run.wrong = await playTarget(page, { wrong: true });
      assert.notEqual(run.wrong.key, KEY_FOR[run.wrong.target], 'the second press is not the target note');
      await page.waitFor(`window.__q62.strokes.some((s) => s.t > ${run.wrong.t0} && s.lineWidth === 8 && s.strokeStyle === '${BAD_FLASH}')`);
    });

    await t.test('A11-7 axe: feedback shown', async () => {
      assert.equal(await isHidden(page, 'feedbackCard'), false, 'the feedback card is on screen');
      await runAxe(page, 'feedback shown');
    });

    await t.test('A11-3 the feedback and the question are live regions', async () => {
      assert.equal(await read(page, "document.getElementById('feedback').getAttribute('role')"), 'status', '#feedback has role=status');
      assert.equal(await read(page, "document.getElementById('prompt').getAttribute('aria-live')"), 'polite', '#prompt is aria-live=polite');
      assert.equal(await read(page, "document.getElementById('prompt').getAttribute('aria-atomic')"), 'true', '#prompt is aria-atomic=true');
    });

    await t.test('A11-3 each note put different words in the feedback region', async () => {
      const rightRecs = (await feedbackRecords(page, run.right.t0)).filter((r) => r.t < run.wrong.t0 && r.text);
      assert.ok(rightRecs.length > 0, 'the right note put non-empty text into #feedback');
      const rightText = rightRecs[0].text;
      const card = await read(page, `window.__q62.texts.filter((r) => r.id === 'feedbackCard' && r.t > ${run.right.t0} && r.hidden === false).length`);
      assert.ok(card > 0, 'the feedback card was shown when the right note was judged');
      const wrongRecs = (await feedbackRecords(page, run.wrong.t0)).filter((r) => r.text);
      assert.ok(wrongRecs.length > 0, 'the wrong note put non-empty text into #feedback');
      assert.notEqual(wrongRecs[0].text, rightText, 'the wrong note said something different from the right note');
      assert.notEqual(rightText, '', 'right-note text is not empty');
      // A second signal: the accessibility tree shows a status region carrying the words now on screen.
      let regions = [];
      let latest = '';
      for (let i = 0; i < 3; i++) {
        latest = await read(page, "document.getElementById('feedback').textContent");
        regions = await statusRegionTexts(page);
        if (regions.some((r) => r.text.includes(latest))) break;
      }
      assert.ok(latest.length > 0, 'the feedback on screen is not empty');
      assert.ok(regions.some((r) => r.text.includes(latest)), `the accessibility tree has a status region saying "${latest}"; it has ${JSON.stringify(regions)}`);
    });

    await t.test('A11-1 the break card keeps Tab and Shift-Tab inside it', async () => {
      await tabTo(page, '#playBtn');
      await page.press('Enter');
      await page.waitFor("!document.getElementById('breakCard').hidden");
      const n = await read(page, `document.getElementById('breakCard').querySelectorAll(${JSON.stringify(DIALOG_FOCUSABLE)}).length`);
      assert.ok(n >= 2, `the break card has at least two controls to move between, found ${n}`);
      assert.equal(await insideCard(page), true, 'focus moved into the break card when it opened');
      const first = await activeId(page);
      const walk = async (press, label) => {
        for (let i = 1; i <= n; i++) {
          await press();
          assert.equal(await insideCard(page), true, `${label} ${i} of ${n} left focus inside #breakCard (it is on #${await activeId(page)})`);
          const id = await activeId(page);
          if (label === 'Tab' && i === 1) { assert.notEqual(id, first, 'the first Tab moved focus to a different control'); }
          if (id === 'backBtn' || id === 'endBtn2') stops.push(await readStop(page, id));
        }
      };
      await walk(() => page.press('Tab'), 'Tab');
      assert.equal(await activeId(page), first, `after ${n} Tabs focus wraps back to the first control (#${first})`);
      await walk(() => shiftTab(page), 'Shift-Tab');
      assert.equal(await activeId(page), first, `after ${n} Shift-Tabs focus is back on #${first}`);
    });

    await t.test('A11-7 axe: break card up', async () => {
      assert.equal(await isHidden(page, 'breakCard'), false);
      await runAxe(page, 'break card up');
    });

    await t.test('A11-1 Escape closes the break card, resumes, and gives focus back', async () => {
      await page.press('Escape');
      await page.waitFor("document.getElementById('breakCard').hidden");
      assert.equal(await isHidden(page, 'breakCard'), true, 'the break card is gone');
      assert.equal(await isHidden(page, 'endBtn'), false, 'the session is still running (End session is still shown)');
      assert.equal(await activeIs(page, '#playBtn'), true, `focus is back on Pause (it is on #${await activeId(page)})`);
    });

    await t.test('A11-1 End session by keyboard', async () => {
      const presses = await tabTo(page, '#endBtn');
      assert.equal(presses, 1, 'one Tab from Pause reaches End session');
      stops.push(await readStop(page, 'endBtn'));
      await page.press('Enter');
      await page.waitFor("document.getElementById('endBtn').hidden");
      assert.equal(await isHidden(page, 'endBtn'), true, 'the session ended');
    });

    await t.test('A11-1b Songs opens by keyboard and Tab goes into the panel', async () => {
      await tabTo(page, SONGS_NAV);
      stops.push(await readStop(page, 'songs nav'));
      await page.press('Enter');
      await page.waitFor("!document.getElementById('panelHost').hidden && document.getElementById('panelHost').children.length > 0");
      await page.press('Tab');
      assert.equal(await read(page, "document.getElementById('panelHost').contains(document.activeElement)"), true, 'Tab went into the Songs panel');
    });

    await t.test('A11-7 axe: Songs panel open', async () => {
      await runAxe(page, 'Songs panel open');
    });

    await t.test('A11-1b Escape closes the panel and gives focus back to the Songs button', async () => {
      await page.press('Escape');
      await page.waitFor("document.getElementById('panelHost').children.length === 0");
      assert.equal(await read(page, "document.activeElement === document.querySelector('#mainNav button[data-route=\"songs\"]')"), true, `focus is on the Songs button (it is on ${await read(page, "document.activeElement.tagName + '#' + document.activeElement.id")})`);
    });

    await t.test('A11-1b the screen is not blank after Escape', { todo: 'Q6-2 F1: Escape on an open panel leaves #mainArea hidden (blank screen)' }, async () => {
      const main = await read(page, "(() => { const m = document.getElementById('mainArea'), r = m.getBoundingClientRect(); return { hidden: m.hidden, width: r.width, height: r.height, panelHidden: document.getElementById('panelHost').hidden }; })()");
      assert.equal(main.hidden, false, `#mainArea is shown again (hidden=${main.hidden}, panelHost hidden=${main.panelHidden})`);
      assert.ok(main.width > 0 && main.height > 0, `#mainArea has a size on screen (${main.width}x${main.height})`);
    });

    await t.test('A11-1b Songs then Practice from the keyboard puts the practice screen back', async () => {
      // After Escape the Practice button is a no-op while the app thinks Practice is showing, so a
      // keyboard learner needs Songs then Practice to recover (see F1 above).
      if (await isHidden(page, 'mainArea')) {
        await tabTo(page, SONGS_NAV);
        await page.press('Enter');
        await page.waitFor("!document.getElementById('panelHost').hidden");
      }
      await tabTo(page, PRACTICE_NAV);
      await page.press('Enter');
      await page.waitFor("!document.getElementById('mainArea').hidden");
      assert.equal(await isHidden(page, 'panelHost'), true, 'the panel host is closed');
      assert.ok((await rectOf(page, '#mainArea')).width > 0, 'the practice screen has a size on screen');
    });

    await t.test('C1 control: Tab is not trapped outside a dialog', async () => {
      assert.equal(await activeIs(page, PRACTICE_NAV), true, 'the walk starts from the Practice button, where the last step left focus');
      const count = await read(page, "[...document.querySelectorAll('button, select, input, [tabindex=\"0\"]')].filter((e) => !e.closest('[hidden]')).length");
      const guard = 2 * count + 2;
      const seen = new Set();
      let taken = 0;
      let back = false;
      while (taken < guard && !back) {
        await page.press('Tab');
        taken++;
        seen.add(await read(page, "document.activeElement.tagName + '#' + document.activeElement.id"));
        back = await activeIs(page, PRACTICE_NAV);
      }
      t.diagnostic(`C1: Tab came back to the Practice button after ${taken} presses over ${seen.size} distinct stops (${count} candidate controls, guard ${guard})`);
      assert.ok(back, `Tab never came back to the Practice button within ${guard} presses: a keyboard trap outside a dialog`);
      assert.ok(seen.has('BUTTON#playBtn'), 'the full Tab cycle passed through Start');
      assert.ok(seen.size >= 10, `the Tab cycle visited many different stops (${seen.size})`);
    });

    await t.test('A11-2 the canvas draws a focus box when Tab lands on it, and removes it after', async () => {
      await startKeyboardSession(page, null);
      const countBox = () => read(page, `(() => { const c = document.getElementById('cv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 210 && d[i + 2] === 63 && d[i + 3] === 255) n++; return n; })()`);
      assert.equal(await countBox(), 0, 'no focus box is drawn before the canvas is focused');
      const since = await read(page, 'performance.now()');
      await tabTo(page, '#cv');
      // A few frames to draw it, then count what is on the canvas; a bounded look, so a missing box fails on the count below.
      let drawn = 0;
      for (let i = 0; i < 40 && drawn === 0; i++) { drawn = await countBox(); if (drawn === 0) await sleep(50); }
      t.diagnostic(`A11-2 canvas outline (not asserted): ${JSON.stringify(await read(page, "(() => { const s = getComputedStyle(document.getElementById('cv')); return { style: s.outlineStyle, width: s.outlineWidth, focusVisible: document.getElementById('cv').matches(':focus-visible') }; })()"))}`);
      assert.ok(drawn > 0, `the focused canvas shows the ${FOCUS_BOX} focus box (${drawn} such pixels)`);
      assert.ok(await read(page, `window.__q62.strokes.some((s) => s.t > ${since} && s.strokeStyle === '${FOCUS_BOX}' && s.lineWidth === 4)`), `the canvas was drawn with a ${FOCUS_BOX} strokeRect after focus`);
      await page.press('Tab');
      await page.waitFor(`(() => { const c = document.getElementById('cv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 210 && d[i + 2] === 63 && d[i + 3] === 255) return false; return true; })()`);
      assert.equal(await countBox(), 0, 'the focus box is gone once focus has moved on');
    });

    // A session is left running from the step above; End comes after the narrow sizes.
    const SIZES = [
      { name: '320x568 mobile (1280 CSS px at 400%)', width: 320, height: 568, mobile: true },
      { name: '390x844 mobile', ...VIEWPORTS.phone },
      { name: '844x390 mobile landscape', width: 844, height: 390, mobile: true },
      { name: '640x400 desktop at 200% zoom', width: 640, height: 400, mobile: false, deviceScaleFactor: 2 },
    ];
    await t.test('A11-4 Start, End session and the Keyboard button are not clipped at narrow sizes', async () => {
      const findings = [];
      for (const size of SIZES) {
        await page.setViewport(size);
        await sleep(250);
        assert.equal(await isHidden(page, 'endBtn'), false, `a session is running at ${size.name}`);
        await tabTo(page, '#navInstrument');
        await page.press('Enter');
        await page.waitFor("!document.getElementById('picker').hidden");
        const m = await read(page, '({ innerWidth, innerHeight, dpr: devicePixelRatio, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight })');
        for (const sel of ['#playBtn', '#endBtn', KBD_BUTTON]) {
          const r = await rectOf(page, sel);
          assert.ok(r.width > 0 && r.height > 0, `${sel} has a size at ${size.name} (${r.width}x${r.height})`);
          assert.ok(r.left >= 0, `${sel} left edge ${r.left} is on screen at ${size.name}`);
          assert.ok(r.right <= size.width, `${sel} right edge ${r.right} is inside the ${size.width}px viewport at ${size.name} (innerWidth ${m.innerWidth}, dpr ${m.dpr})`);
          try { assertInFirstScreen(r, size.height, `${sel} at ${size.name}`); }
          catch (e) { findings.push(`${e.message} (page is ${m.scrollHeight}px tall; the page scrolls vertically)`); }
        }
        assert.ok(m.scrollWidth <= size.width, `no horizontal page scroll at ${size.name}: scrollWidth ${m.scrollWidth} vs ${size.width}`);
        await tabTo(page, '#navInstrument', 120); // close the sheet again (focus sits inside the sheet, so the way round is long)
        await page.press('Enter');
        await page.waitFor("document.getElementById('picker').hidden");
        t.diagnostic(`A11-4 ${size.name}: innerWidth ${m.innerWidth} x ${m.innerHeight}, devicePixelRatio ${m.dpr}, scrollWidth ${m.scrollWidth}`);
      }
      // The sheet under 600px scrolls inside itself by design (max-height 40vh), and Start moves to the top visually; neither is a failure.
      for (const f of findings) t.diagnostic(`A11-4 vertical (measured, not asserted): ${f}`);
    });

    await t.test('A11-7 axe: 320x568 with a session running', async () => {
      await page.setViewport(SIZES[0]);
      await sleep(250);
      assert.equal(await isHidden(page, 'endBtn'), false, 'a session is running');
      await runAxe(page, '320x568 session running');
    });

    await t.test('A11-4 End session by keyboard and return to a desktop window', async () => {
      await page.setViewport({ width: 1280, height: 800 });
      await endSessionByKeyboard(page, null);
      assert.equal(await isHidden(page, 'endBtn'), true, 'the session ended');
    });

    const prefersDark = await read(page, "matchMedia('(prefers-color-scheme: dark)').matches");
    t.diagnostic(`A11-5 the system prefers ${prefersDark ? 'dark' : 'light'} in this browser`);
    const wantFirst = prefersDark ? 'light' : 'dark'; // the explicit theme that differs from the system
    const wantSecond = prefersDark ? 'dark' : 'light'; // the other explicit one
    let beforeBg = '';

    await t.test('A11-5 Settings, then the theme chosen with arrow keys', async () => {
      await tabTo(page, SETTINGS_NAV);
      stops.push(await readStop(page, 'settings nav'));
      await page.press('Enter');
      await page.waitFor("!document.getElementById('settingsView').hidden");
      await tabTo(page, '#optTheme');
      stops.push(await readStop(page, 'optTheme'));
      beforeBg = await bodyBackground(page);
      await chooseTheme(page, wantFirst);
      assert.equal(await dataTheme(page), wantFirst, `data-theme is ${wantFirst} after choosing it`);
      assert.notEqual(await bodyBackground(page), beforeBg, `the page background changed (was ${beforeBg})`);
    });

    await t.test('A11-7 axe: Settings in the non-default theme', async () => {
      await runAxe(page, `Settings in the ${wantFirst} theme`);
    });

    await t.test('A11-5 the other theme changes it again, and Practice comes back', async () => {
      const mid = await bodyBackground(page);
      await chooseTheme(page, wantSecond);
      assert.equal(await dataTheme(page), wantSecond, `data-theme is ${wantSecond} after choosing it`);
      assert.notEqual(await bodyBackground(page), mid, 'the page background changed again');
      await tabTo(page, PRACTICE_NAV);
      await page.press('Enter');
      await page.waitFor("!document.getElementById('mainArea').hidden");
      assert.equal(await isHidden(page, 'settingsView'), true, 'Settings is closed');
    });

    await t.test('A11-2 every control reached by Tab shows a focus ring and is not covered', async () => {
      const labels = stops.map((s) => s.label);
      for (const want of ['picker kbd', 'playBtn', 'endBtn', 'backBtn', 'endBtn2', 'songs nav', 'settings nav', 'optTheme']) {
        assert.ok(labels.includes(want), `the journey reached ${want} by keyboard (reached: ${labels.join(', ')})`);
      }
      for (const s of stops) {
        assert.notEqual(s.outlineStyle, 'none', `${s.label}: the focused control has a visible outline (outline-style ${s.outlineStyle})`);
        assert.ok(s.outlineWidth >= 1, `${s.label}: the outline is at least 1px wide (${s.outlineWidth}px)`);
        assert.equal(s.covered, false, `${s.label}: nothing covers the focused control (covered by ${s.hit})`);
        assert.ok(s.width > 0 && s.height > 0, `${s.label}: the focused control has a size`);
      }
    });

    await t.test('A11-6 control (launch A): the same wrong note draws the full-canvas flash', async () => {
      const flash = await read(page, `window.__q62.strokes.filter((s) => s.t > ${run.wrong.t0} && s.lineWidth === 8 && s.strokeStyle === '${BAD_FLASH}').length`);
      assert.ok(flash > 0, 'without reduced motion the wrong note flashes the canvas edge');
      const durations = await read(page, "['readyFill', 'energyFill'].map((id) => getComputedStyle(document.getElementById(id)).transitionDuration)");
      for (const d of durations) assert.ok(d.split(',').some((v) => parseFloat(v) > 0), `without reduced motion the meters animate (transition-duration ${d})`);
    });
  });
});

// ---------------------------------------------------------------------------
test('reduced motion: the system setting is on before the page loads (launch B)', async (t) => {
  await withAcceptancePage(t, { initScript: RECORDER, reducedMotion: true }, async (page) => {
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluate(axeSource);
    const run = { right: null, wrong: null };

    await t.test('A11-7 axe: first load with reduced motion', async () => {
      assert.equal(await read(page, "matchMedia('(prefers-reduced-motion: reduce)').matches"), true, 'the browser reports reduced motion');
      await runAxe(page, 'first load, reduced motion');
    });

    await t.test('A11-6 right note then wrong note by keyboard', async () => {
      await startKeyboardSession(page, null);
      run.right = await playTarget(page);
      await waitNewQuestion(page, run.right);
      run.wrong = await playTarget(page, { wrong: true });
      await page.waitFor(`window.__q62.texts.some((r) => r.id === 'feedback' && r.t > ${run.wrong.t0} && r.text)`);
      await sleep(500); // a flash lasts 220 ms; look after it would have been over
    });

    await t.test('A11-6 no full-canvas flash, and the feedback still appears', async () => {
      const rightText = (await feedbackRecords(page, run.right.t0)).filter((r) => r.t < run.wrong.t0 && r.text);
      const wrongText = (await feedbackRecords(page, run.wrong.t0)).filter((r) => r.text);
      assert.ok(rightText.length > 0 && wrongText.length > 0, 'both notes still put words in the feedback region');
      const flashes = await read(page, "window.__q62.strokes.filter((s) => s.lineWidth === 8).map((s) => s.strokeStyle + ' @' + Math.round(s.t))");
      assert.equal(flashes.length, 0, `no full-canvas flash (lineWidth 8 strokeRect) was drawn under reduced motion; saw ${flashes.length}, first ${JSON.stringify(flashes.slice(0, 3))}`);
    });

    await t.test('A11-6 the meters do not animate', async () => {
      const durations = await read(page, "['readyFill', 'energyFill'].map((id) => getComputedStyle(document.getElementById(id)).transitionDuration)");
      for (const d of durations) assert.ok(d.split(',').every((v) => parseFloat(v) === 0), `transition-duration is zero under reduced motion (${d})`);
    });
  });
});
