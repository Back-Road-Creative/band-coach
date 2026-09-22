// Four bowed instrument records (src/instruments/violin.js, viola.js,
// cello.js, double-bass.js) shipped with status: 'planned', curriculum: []
// and no MODS entry -- a learner could never pick or play any of them. This
// drives each one end to end: select it, get a task, answer the correct
// note via the window.__coach debug hook, see it credited (same technique
// tests/characterization/fretted-instruments-playable.test.mjs uses for the
// six fretted instruments it added the same way).
//
// Unlike the fretted six, these are bowed and fretless: MODS.violin etc.
// carry input: 'sustain' (a held, matched-pitch note, the same judging voice
// and wind already use) rather than 'pluck', so the real-mic proof uses
// window.__coach.testSource() (a continuous synthetic tone, the technique
// tests/characterization/octave.test.mjs and wind-octave-policy.test.mjs use
// for their own 'sustain' instruments) instead of testPluck's decaying
// attack, which models a plucked string's envelope, not a bow's.
//
// Double bass's open E1 (~41.2 Hz) is checked directly against the real
// mic-detection chain (window.__coach.heard(), which reflects whatever the
// AudioWorklet/yin pipeline is actually hearing) rather than assumed safe
// because src/audio/range.js's frameSizeForInstrument already doubles the
// analysis frame for the 4-string and 5-string basses' open strings -- the
// same derivation applies to any instrument whose range.low is this low, but
// this is the proof for double-bass specifically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage, retryFlaky } from '../helpers/browser.mjs';
import { byId } from '../../src/instruments/index.js';

const htmlPath = HTML_PATH;
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const BOWED_IDS = ['violin', 'viola', 'cello', 'double-bass'];

for (const id of BOWED_IDS) {
  test(`${id}: selectable, and answering the task note correctly credits it`, async (t) => {
    const page = await launchPage(htmlPath);
    t.after(() => page.close());

    await page.evaluate(`window.__coach.setMod(${JSON.stringify(id)})`);
    assert.equal(await page.evaluate('window.__coach.db().prefs.mod'), id, `${id} should be selectable via setMod`);

    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');

    const info = await page.evaluate('window.__coach.cur().info');
    assert.equal(info.kind, 'note', `${id} level 1 should hand out a note task`);
    assert.ok(Number.isFinite(info.midi), `${id} task note should have a real midi pitch`);

    await page.evaluate(`window.__coach.note(${info.midi}, true)`);
    await page.waitFor('window.__coach.task() && window.__coach.task().done', 4000);

    assert.equal(
      await page.evaluate('window.__coach.task().idx'),
      1,
      `${id}: the correct note should have been credited`
    );
  });
}

for (const id of BOWED_IDS) {
  test(`${id}: a real, held microphone tone at the task pitch is credited (sustain input, not pluck)`, async (t) => {
    const page = await launchPage(htmlPath);
    t.after(() => page.close());

    await page.evaluate(`window.__coach.setMod(${JSON.stringify(id)})`);
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');

    const info = await page.evaluate('window.__coach.cur().info');
    const freq = midiToFreq(info.midi);
    await page.evaluate(`window.__coach.testSource([${freq}])`);

    await page.waitFor('window.__coach.task() && window.__coach.task().done', 8000);

    assert.equal(
      await page.evaluate('window.__coach.task().idx'),
      1,
      `${id}: a real held tone at the target pitch should have been credited`
    );
  });
}

test('double bass: the open E1 string (~41.2 Hz) is actually heard by the real detection pipeline', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('double-bass')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  await retryFlaky({
    what: 'double bass open E1 detection',
    attempt: async () => {
      await page.evaluate('window.__coach.testSource([41.2])');
      await new Promise((r) => setTimeout(r, 1200));
      return page.evaluate('window.__coach.heard() && window.__coach.heard().freq');
    },
    accept: (freq) => Number.isFinite(freq) && Math.abs(freq - 41.2) / 41.2 < 0.03,
    describe: (freq) => `heard freq ${freq}`,
  });
});

test('double bass: the pitch worklet runs at a frame size bigger than the 2048 default (open E1 needs the room)', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('double-bass')");
  await page.evaluate('window.__coach.testSource([41.2])'); // settles ensurePitchWorklet()
  await page.waitFor('window.__coach.pitchWorkletFrameSize() !== undefined');

  const frameSize = await page.evaluate('window.__coach.pitchWorkletFrameSize()');
  assert.ok(frameSize > 2048, `expected a bigger-than-default frame size for double-bass's open E1, got ${frameSize}`);
});

test('UI honesty: a bowed instrument\'s hint never claims a fret exists', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('violin')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const info = await page.evaluate('window.__coach.cur().info');
  assert.ok(info.string, 'level-1 violin items are string/position notes');
  // /\bfret \d/ (not a bare /fret/i) is the same test w-fingerings.test.mjs
  // already uses for the Fingerings panel's violin description: it lets an
  // honest denial ("no fret to feel for") through while still catching a
  // claim of an actual numbered fret ("fret 3").
  assert.doesNotMatch(info.label, /\bfret \d/, 'a fretless instrument\'s item label should never claim a numbered fret');

  const hint = await page.evaluate("document.getElementById('hint').textContent");
  assert.doesNotMatch(hint, /\bfret \d/, 'a fretless instrument\'s hint should never claim a numbered fret');
  assert.match(hint, /no fret/i, 'the hint should say plainly that there is no fret to feel for');
});

for (const id of BOWED_IDS) {
  test(`${id}: registry record is ready with a non-empty curriculum and stays inside its own range`, () => {
    const rec = byId[id];
    assert.equal(rec.status, 'ready');
    assert.equal(rec.family, 'bowed');
    assert.equal(rec.fretted, false);
    assert.ok(rec.curriculum.length > 0);
    for (const t of rec.tuning) assert.ok(t >= rec.range.low && t <= rec.range.high);
  });
}
