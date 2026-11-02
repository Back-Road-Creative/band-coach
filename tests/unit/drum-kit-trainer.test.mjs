// The drum-kit trainer end to end in the built page: a real keydown, a real
// MIDI note-on through a fake Web MIDI port (the app's own Connect button),
// and a real pointer press on the drawn kit all reach the same judge. The
// debug hook is only used to pick the level and read the bar's onset times;
// every hit goes through the app's own input listeners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';
import { PIECES, TRAINER_LEVELS } from '../../src/instruments/drum-kit.js';

const KEY = Object.fromEntries(PIECES.map(p => [p.id, p.key]));
const MIDI = Object.fromEntries(PIECES.map(p => [p.id, p.midi[0]]));
const OSC_COUNT = `
  const __mk = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () { window.__osc = (window.__osc || 0) + 1; return __mk.apply(this, arguments); };
`;

async function startKit(page, level, tick = 0) {
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.evaluate(`window.__coach.state().level = ${level}; window.__coach.state().tick = ${tick}`);
  await page.evaluate('window.__coach.db().latencyMs = 0');
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().onsets && window.__coach.bar().onsets.length > 0');
  return page.evaluate('window.__coach.bar().onsets');
}

// A real keydown whose timeStamp resolves (through the app's own
// tapAudioTime) to `at` on the audio clock, read in the same page task.
async function keyAt(page, key, at) {
  await page.evaluate(`(function () {
    const offset = window.__coach.audioNow() - performance.now() / 1000;
    const ev = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true });
    Object.defineProperty(ev, 'timeStamp', { value: (${at} - offset) * 1000 });
    document.body.dispatchEvent(ev);
  })()`);
}

async function judged(page) {
  await page.waitFor('window.__coach.bar().judged', 20000);
  return page.evaluate("({ failed: window.__coach.task().els[0].failed, say: document.getElementById('feedback').textContent, cls: document.getElementById('feedback').className, coach: document.getElementById('coach').textContent })");
}

test('the drum kit is an instrument you can pick, with keys, MIDI and clicks in its help text', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  const help = await page.evaluate("document.getElementById('helpText').textContent");
  assert.match(help, /MIDI/);
  assert.match(help, /F kick, J snare, D closed hat/);
  assert.match(help, /click the drawn kit/);
});

test('level 1: the bass drum on every beat, played on the F key, is a clean bar', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const onsets = await startKit(page, 1, 0);
  assert.equal(onsets.length, 4);
  assert.ok(onsets.every(o => o.pieces.join() === 'kick'));
  for (const o of onsets) await keyAt(page, KEY.kick, o.t);
  const r = await judged(page);
  assert.equal(r.failed, false, r.say);
  assert.equal(r.cls, 'ok');
  const pieces = await page.evaluate('window.__coach.bar().taps.map(tp => tp.piece)');
  assert.deepEqual(pieces, ['kick', 'kick', 'kick', 'kick']);
});

test('the right time on the wrong drum fails the bar and names the drum it wanted', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const onsets = await startKit(page, 1, 0);
  for (const o of onsets) await keyAt(page, KEY.snare, o.t);
  const r = await judged(page);
  assert.equal(r.failed, true);
  assert.match(r.say, /wrong drum/);
  assert.match(r.say, /Bass drum/);
});

test('a kit key sounds a drum even before a bar starts', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: OSC_COUNT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await keyAt(page, KEY.kick, 0);
  await page.waitFor('(window.__osc || 0) > 0');
});

test('MIDI: notes from an e-kit on the right drum pass; a note that is not on the kit is an extra and says so', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await midiAddPort(page, 'kit', 'Test E-kit');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  // Each note fires as soon as a short poll finds audioNow() has reached its
  // target, instead of betting on one `setTimeout(delayMs)` computed up
  // front -- a single long timer fires late by however much the runner is
  // starved, with nothing to correct it once scheduled. Polling every 4ms
  // (the same grooveInject pattern src/app.js's debug hook uses for groove
  // input) bounds the lateness to the poll interval on a slow box instead of
  // to how badly the timer queue was backed up.
  const send = (list) => page.evaluate(`(function () {
    ${JSON.stringify(list)}.forEach(function (x) {
      const fire = function () {
        if (window.__coach.audioNow() >= x.at) window.__midiSend('kit', [0x99, x.note, 100]);
        else setTimeout(fire, 4);
      };
      fire();
    });
  })()`);

  let onsets = await startKit(page, 1, 1); // tick 1 = the snare bar
  assert.ok(onsets.every(o => o.pieces.join() === 'snare'));
  await send(onsets.map(o => ({ note: MIDI.snare, at: o.t })));
  let r = await judged(page);
  assert.equal(r.failed, false, r.say);

  await page.waitFor('window.__coach.bar() && !window.__coach.bar().judged && window.__coach.bar().onsets.length > 0', 20000);
  onsets = await page.evaluate('window.__coach.bar().onsets');
  const want = onsets[0].pieces[0];
  await send(onsets.map(o => ({ note: MIDI[o.pieces[0]], at: o.t })).concat([{ note: 39, at: onsets[1].t + 0.3 }]));
  r = await judged(page);
  assert.equal(r.failed, true, 'hand clap is not on the kit: ' + want);
  assert.match(r.say, /1 extra/);
  assert.match(r.coach, /MIDI note 39 is not one of the drums/);
});

test('a click on the drawn kit plays that piece', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const onsets = await startKit(page, 1, 0);
  await page.waitFor('window.__coach.bar().kitBox');
  const box = await page.evaluate('window.__coach.bar().kitBox');
  const { kitRegions } = await import('../../src/instruments/how/drum-kit.js');
  const kick = kitRegions(box).find(p => p.id === 'kick');
  for (const o of onsets) {
    await page.evaluate(`(function () {
      const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
      const x = ${kick.cx}, y = ${kick.cy};
      const offset = window.__coach.audioNow() - performance.now() / 1000;
      const ev = new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + x * r.width / cv.width, clientY: r.top + y * r.height / cv.height });
      Object.defineProperty(ev, 'timeStamp', { value: (${o.t} - offset) * 1000 });
      cv.dispatchEvent(ev);
    })()`);
  }
  const r = await judged(page);
  assert.equal(r.failed, false, r.say);
});

const flamBar = TRAINER_LEVELS[5].bars.findIndex(b => b.hits.every(h => h.flam));

test('a flam is two snare hits within 40 ms; wider apart fails and says why', async (t) => {
  assert.ok(flamBar >= 0, 'level 6 has an all-flam bar');
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  let onsets = await startKit(page, 6, flamBar);
  for (const o of onsets) { await keyAt(page, KEY.snare, o.t); await keyAt(page, KEY.snare, o.t + 0.02); }
  let r = await judged(page);
  assert.equal(r.failed, false, r.say);

  await page.evaluate(`window.__coach.state().tick = ${flamBar}`);
  await page.waitFor('window.__coach.bar() && !window.__coach.bar().judged && window.__coach.bar().onsets.length > 0', 20000);
  onsets = await page.evaluate('window.__coach.bar().onsets');
  assert.ok(onsets.every(o => o.flam));
  for (const o of onsets) { await keyAt(page, KEY.snare, o.t); await keyAt(page, KEY.snare, o.t + 0.09); }
  r = await judged(page);
  assert.equal(r.failed, true);
  assert.match(r.say, /flam/i);
});

test('past the last level the mix level still builds kit bars from the curriculum', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const onsets = await startKit(page, TRAINER_LEVELS.length + 1, 2);
  assert.equal(await page.evaluate('window.__coach.task().kind'), 'kit');
  assert.ok(onsets.length > 0);
});

const STICK_SPY = `
  window.__texts = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (s, ...r) { window.__texts.push({ s: String(s) }); return orig.call(this, s, ...r); };
`;

test('sticking is drawn under the notes and written in the text mirror', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: STICK_SPY });
  t.after(() => page.close());
  await startKit(page, 6, 0);
  await page.waitFor('window.__texts.some(x => x.s === "L")');
  const desc = await page.evaluate("document.getElementById('cvDesc').textContent");
  assert.ok(desc.includes('(R)'));
  assert.equal(desc.split('(L)').length - 1, 4);
});

test('sticking never reaches the judge: every hit on the key scores the same', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  const onsets = await startKit(page, 6, 0);
  assert.deepEqual(Object.keys(onsets[0]).sort(), ['beat', 'flam', 'pieces', 't']);
  for (const o of onsets) await keyAt(page, KEY.snare, o.t);
  assert.equal((await judged(page)).failed, false);
});

test('bars without sticking show no hand letters', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await startKit(page, 1, 0);
  const desc = await page.evaluate("document.getElementById('cvDesc').textContent");
  assert.ok(!desc.includes('(R)') && !desc.includes('(L)'));
});

// ---- a failed bar comes round again (up to 3 tries) ----
// One hit on the wrong drum is a failure that still has a hit in it.
async function failBar(page) {
  const onsets = await page.evaluate('window.__coach.bar().onsets');
  await keyAt(page, KEY.snare, onsets[0].t);
  return judged(page);
}
async function nextBar(page, prevT0) {
  await page.waitFor(`window.__coach.bar() && !window.__coach.bar().judged && window.__coach.bar().t0 !== ${prevT0}`, 20000);
  return page.evaluate('({ onsets: window.__coach.bar().onsets.map(o => o.pieces.join()), tick: window.__coach.state().tick, ready: window.__coach.state().ready, hint: document.getElementById(\'hint\').textContent, coach: document.getElementById(\'coach\').textContent, t0: window.__coach.bar().t0 })');
}

test('a failed bar replays the same bar, three tries in all, then moves on; readiness is charged once', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await startKit(page, 1, 0);
  const ready0 = await page.evaluate('window.__coach.state().ready');
  let r = await failBar(page);
  assert.equal(r.failed, true);
  const t0a = await page.evaluate('window.__coach.bar().t0');
  const ready1 = await page.evaluate('window.__coach.state().ready');
  assert.ok(ready1 < ready0, 'the first failure is charged');
  const second = await nextBar(page, t0a);
  const first = await page.evaluate('window.__coach.state().tick');
  assert.equal(second.tick, first);
  assert.match(second.coach, /Same bar again: try 2 of 3\./);
  assert.match(second.hint, /try 2 of 3/);
  assert.deepEqual(second.onsets, ['kick', 'kick', 'kick', 'kick']);
  r = await failBar(page);
  assert.match(r.say, /wrong drum/, 'the correction is still shown');
  const third = await nextBar(page, second.t0);
  assert.match(third.coach, /try 3 of 3/);
  assert.equal(third.tick, second.tick, 'repeating does not advance the bar order');
  assert.equal(third.ready, ready1, 'a failed repeat is not charged again');
  r = await failBar(page);
  await page.waitFor("/moving on/.test(document.getElementById('coach').textContent)");
  const fourth = await nextBar(page, third.t0);
  assert.equal(fourth.tick, third.tick + 1, 'after the third failure the next bar is chosen as before');
  assert.equal(fourth.ready, ready1, 'three failures cost readiness once');
  assert.doesNotMatch(fourth.coach, /try \d of 3/);
});

test('a clean repeat is credited and the next bar moves on', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await startKit(page, 1, 0);
  await failBar(page);
  const t0a = await page.evaluate('window.__coach.bar().t0');
  const ready1 = await page.evaluate('window.__coach.state().ready');
  const second = await nextBar(page, t0a);
  const onsets = await page.evaluate('window.__coach.bar().onsets');
  for (const o of onsets) await keyAt(page, KEY.kick, o.t);
  const r = await judged(page);
  assert.equal(r.failed, false, r.say);
  assert.ok(await page.evaluate('window.__coach.state().ready') > ready1, 'a clean repeat earns normal credit');
  const third = await nextBar(page, second.t0);
  assert.equal(third.tick, second.tick + 1);
  assert.doesNotMatch(third.coach, /try \d of 3/);
});

test('a bar with no hits at all does not repeat', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await startKit(page, 1, 0);
  await judged(page);
  const t0a = await page.evaluate('window.__coach.bar().t0');
  const tick0 = await page.evaluate('window.__coach.state().tick');
  const next = await nextBar(page, t0a);
  assert.equal(next.tick, tick0 + 1, 'the next bar was chosen, not the same one');
  assert.doesNotMatch(next.coach, /try \d of 3/);
});

test('above the normal table a failed bar does not repeat', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await startKit(page, TRAINER_LEVELS.length + 1, 0);
  await failBar(page);
  const t0a = await page.evaluate('window.__coach.bar().t0');
  const tick0 = await page.evaluate('window.__coach.state().tick');
  const next = await nextBar(page, t0a);
  assert.equal(next.tick, tick0 + 1);
  assert.doesNotMatch(next.coach, /try \d of 3/);
});
