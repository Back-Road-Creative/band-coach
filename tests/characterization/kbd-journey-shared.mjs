// Four end-to-end keyboard-learner journeys, driven through real entry
// points only (clicks, Tab+Enter, real fake-MIDI messages, real
// KeyboardEvents) -- never window.__coach for a journey STEP, per
// docs/journeys.md lines 1-6. window.__coach is used only to READ state for
// assertions (db(), audioNow(), songsRecordStart(), cur().info -- the one
// thing no real entry point can be asked for) or, where an existing suite
// already established the pattern (kbd-hand-alone-gate.test.mjs), to read a
// mastery item's own numbers. This file imports pathwayState() directly
// (src/core/pathway.js) only where a plain UI read cannot say which
// *action* a pathway step offers as precisely as the pure function can; the
// STEP itself is always read off the real "Your keyboard path" panel.
//
// Mutation-based red-first evidence (see this file's header comment; run
// order and exact commands recorded again in the hand-back):
//   Mutation A -- src/core/learning-events.js isIndependentOk(): loosen the
//     kbd-only strict-midi clause (`ev.input !== 'midi'`) to also accept
//     'computer-key'. Scenario 2 must fail, because its whole point is that
//     a computer-key-only check never counts.
//   Mutation B -- remove the starter-song hand-off fallback in src/app.js
//     (the `if (mod === 'kbd') { const song = songFor(S.level); ... }`
//     block that renders #kbdSongHandoff). Scenario 1 must fail, because it
//     cannot reach the song without that button.
//
// Shared setup for the four kbd-journey-*.test.mjs files (one file per journey so
// node --test runs them in parallel). Not a test: the name does not end in
// .test.mjs, so the tests/characterization/*.test.mjs glob never runs it.
import { HTML_PATH } from '../helpers/html-path.mjs';
import { midiAddPort } from '../helpers/fake-midi.mjs';
import { isIndependentOk } from '../../src/core/learning-events.js';
import { starterSongs } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId as instrumentById } from '../../src/instruments/index.js';

export const htmlPath = HTML_PATH;
export const DAY_MS = 24 * 3600 * 1000;

// Patches Date.now() (only) to add an offset read from localStorage, so a
// day-2 "reload" can be simulated on the SAME page/profile without hand-
// seeding any event row -- day-1 rows all come from real clicks/MIDI, day 2
// only moves the clock. Re-injected fresh on every new document
// (Page.addScriptToEvaluateOnNewDocument), so it survives page.reload();
// the offset itself survives because it lives in localStorage, real
// browser storage, not a JS global.
export const DATE_OFFSET_INIT = `
  (function () {
    const orig = Date.now.bind(Date);
    Date.now = function () { return orig() + Number(localStorage.getItem('__dayOffsetMs') || '0'); };
  })();
`;

export async function advanceOneDay(page) {
  await page.evaluate(`localStorage.setItem('__dayOffsetMs', '${DAY_MS}')`);
  await page.reload();
}

// midi -> physical-key letter, src/core/pckeys.js's PCKEYS map inverted --
// only the notes Hot Cross Buns actually uses (C4/D4/E4) need to resolve,
// but the whole map is kept so a future song swap does not silently drop a
// note.
export const PCKEYS_INV = {
  60: 'a', 61: 'w', 62: 's', 63: 'e', 64: 'd', 65: 'f', 66: 't', 67: 'g', 68: 'y', 69: 'h', 70: 'u', 71: 'j', 72: 'k',
  48: 'z', 50: 'x', 52: 'c', 53: 'v', 55: 'b', 57: 'n', 59: 'm',
};

// Same STEP_WORDS/heading-key shape tests/characterization/kbd-practice-
// song-handoff.test.mjs's HOT_CROSS_BUNS_STEPS_BY_HEADING builds, computed
// once against the real starter song and the real buildLessonPlan() the app
// itself calls.
export function stepsByHeading(song, plan) {
  const STEP_WORDS = {
    listen: 'Listen', rhythm: 'Clap the rhythm', pitches: 'Play the notes, any speed',
    'phrase-slow': 'Play it slowly', 'tempo-ladder': 'Play it up to speed',
    chain: 'Play the phrases together', whole: 'Play the whole piece',
  };
  const byHeading = {};
  for (const step of plan.steps) {
    if (!step.passRule) continue; // 'listen' steps are driven by "Next", never by notes
    const key = (STEP_WORDS[step.kind] || step.kind) + ' (bars ' + (step.bars[0] + 1) + '-' + (step.bars[1] + 1) + ')';
    const notes = step.notes.map((n) => ({ midi: n.midi, offsetSec: (n.start - step.originTick) / song.ticksPerQuarter * (60 / step.bpm) }));
    (byHeading[key] = byHeading[key] || []).push(notes);
  }
  return byHeading;
}
export const HOT_CROSS_BUNS = starterSongs.find((s) => s.id === 'hot-cross-buns');
export const HCB_PLAN = buildLessonPlan(HOT_CROSS_BUNS, HOT_CROSS_BUNS.parts[0].id, instrumentById.kbd);
export const HCB_BY_HEADING = stepsByHeading(HOT_CROSS_BUNS, HCB_PLAN);

export async function clickButtonNamed(page, text, scope = '.panel-songs-practice') {
  await page.evaluate(`Array.from(document.querySelectorAll('${scope} button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`);
}
export async function currentHeadingOrPara(page) {
  return page.evaluate(
    "(() => { const h4 = document.querySelector('.panel-songs-practice h4'); if (h4) return h4.textContent; const p = document.querySelector('.panel-songs-practice p'); return p ? p.textContent : null; })()"
  );
}
export async function clickMode(page, mode) {
  await page.evaluate(`document.querySelector('.panel-songs-mode button[data-mode="${mode}"]').click()`);
  await page.waitFor(`document.querySelector('.panel-songs-mode button[data-mode="${mode}"]').getAttribute('aria-pressed') === 'true'`);
}
export async function connectFakeMidi(page, id = 'p1', name = 'Test Keys') {
  await midiAddPort(page, id, name);
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
}
export async function selectKbdMod(page) {
  await page.evaluate("document.querySelector('#picker button[data-mod=\"kbd\"]').click()");
  await page.waitFor("document.getElementById('picker').hidden === true");
}

// Real, timed note delivery for one judged step: waits for each note's own
// offset against the REAL audio clock (window.__coach.audioNow() /
// songsRecordStart() are reads of the running clock, not a driving hook --
// same use C7 in kbd-midi-check-path.test.mjs makes of them), then sends it
// either as a real fake-MIDI message or a real KeyboardEvent -- the two
// routes learning-events.js's isIndependentOk cares about (P1).
export async function driveStepReal(page, notes, route) {
  const js = `(async () => {
    const notes = ${JSON.stringify(notes)};
    const inv = ${JSON.stringify(PCKEYS_INV)};
    for (const n of notes) {
      while ((window.__coach.audioNow() - window.__coach.songsRecordStart()) < n.offsetSec) { await new Promise(r => setTimeout(r, 4)); }
      ${route === 'midi'
        ? "window.__midiSend('p1', [0x90, n.midi, 100]);"
        : "document.dispatchEvent(new KeyboardEvent('keydown', { key: inv[n.midi] }));"}
    }
  })()`;
  await page.evaluate(js);
}

// Walks the whole open song to the end, every judged step driven with real,
// timed notes over `route` ('midi' or 'computer-key') -- never the debug
// hook's unsourced songsNoteAt seam, unlike the walk-past helpers in
// kbd-midi-check-path.test.mjs/kbd-practice-song-handoff.test.mjs, because a
// journey's STEPS may never go through window.__coach at all, not even the
// ones this test does not care about individually.
export async function playSongToEnd(page, byHeading, route, { maxLoops = 40 } = {}) {
  const attemptCounts = {};
  for (let i = 0; i < maxLoops; i++) {
    const para = await page.evaluate("(document.querySelector('.panel-songs-practice p') || {}).textContent || null");
    if (para && para.includes('whole piece')) return Object.values(attemptCounts).reduce((a, b) => a + b, 0);
    const hasNext = await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')");
    if (hasNext) { await clickButtonNamed(page, 'Next'); continue; }
    const heading = await page.evaluate("(() => { const h4 = document.querySelector('.panel-songs-practice h4'); return h4 && h4.textContent; })()");
    const headingKey = heading && (heading.match(/^(.*\(bars \d+-\d+\))/) || [])[1];
    const rungs = headingKey ? byHeading[headingKey] : null;
    if (!rungs) throw new Error('no known notes for step heading: ' + heading);
    const attemptIndex = Math.min(attemptCounts[headingKey] || 0, rungs.length - 1);
    attemptCounts[headingKey] = (attemptCounts[headingKey] || 0) + 1;
    const notes = rungs[attemptIndex];
    const ratePct = await page.evaluate(
      "(() => { const r = document.querySelector('.panel-songs-rate'); if (!r) return 100; const m = r.textContent.match(/(\\d+)%/); return m ? Number(m[1]) : 100; })()"
    );
    const scale = 100 / Math.max(1, Math.round(100 * (ratePct / 100)));
    const scaledNotes = notes.map((n) => ({ midi: n.midi, offsetSec: n.offsetSec * scale }));
    await clickButtonNamed(page, 'Your turn');
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')", 8000);
    await driveStepReal(page, scaledNotes, route);
    await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')", 15000);
    await clickButtonNamed(page, 'Stop and check');
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  }
  throw new Error('did not reach "whole piece" within the loop budget');
}

// The real "Your keyboard path" panel -- opened with a real click on the
// mod-options button, and closed with a real click on the Practice nav
// destination (src/app.js's navDestFor/routeTo: `dest === 'practice'` calls
// closePanel()), never window.__coach, so the step a journey reports is
// exactly what a learner would see on screen. Escape (src/ui/panels.js's
// container keydown listener) needs the page to already hold real keyboard
// focus, which a plain page.evaluate(...).click() does not reliably give
// it -- the real nav button is just as real an exit and does not depend on
// that.
export async function openPathwayPanel(page) {
  await page.evaluate("document.getElementById('kbdPathwayBtn').click()");
  await page.waitFor("!document.getElementById('panelHost').hidden");
}
export async function readPathwayPanel(page) {
  await openPathwayPanel(page);
  const info = await page.evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('.pathway-steps li')).map(li => ({ step: li.getAttribute('data-step'), current: li.getAttribute('aria-current') }));
    const current = items.find(i => i.current === 'step');
    return {
      step: current ? current.step : null,
      hasAction: !!document.getElementById('pathwayAction'),
      actionText: document.getElementById('pathwayAction') ? document.getElementById('pathwayAction').textContent : null,
      wait: !!document.querySelector('.pathway-wait'),
      retained: !!document.querySelector('.pathway-retained'),
    };
  })()`);
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').click()");
  await page.waitFor("document.getElementById('panelHost').hidden");
  return info;
}
export async function clickPathwayAction(page) {
  await openPathwayPanel(page);
  await page.evaluate("document.getElementById('pathwayAction').click()");
}

// Real nav route to Progress (src/app.js navDestFor: 'history' panel <->
// 'progress' route), read back exactly as a learner would see it.
export async function readRetention(page) {
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"progress\"]').click()");
  await page.waitFor("window.__coach.panelOpen() === 'history'");
  const text = await page.evaluate("document.getElementById('historyRetention').textContent");
  await page.evaluate("document.querySelector('#mainNav button[data-route=\"practice\"]').click()");
  await page.waitFor("window.__coach.panelOpen() === null");
  return text;
}
export function countIn(text, label) {
  const m = text.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': (\\d+)'));
  return m ? Number(m[1]) : 0;
}

