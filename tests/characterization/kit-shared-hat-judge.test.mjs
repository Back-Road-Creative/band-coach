// A kit whose closed and open hi-hat send one note: the trainer's judge takes that note for either hat piece. A kit with two notes
// still tells them apart. Hits arrive as real MIDI through a fake port, as in tests/unit/drum-kit-trainer.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort } from '../helpers/fake-midi.mjs';

const DEVICE = 'Test E-kit';
// Level 1: tick 2 is the closed hi-hat bar and tick 4 the open hi-hat bar.
async function bar(t, kit, tick, notePerOnset) {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate(`window.__coach.db().prefs.kit = ${JSON.stringify(kit)}; window.__coach.setMod('drum-kit')`);
  await midiAddPort(page, 'kit', DEVICE);
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  await page.evaluate(`window.__coach.state().level = 1; window.__coach.state().tick = ${tick}; window.__coach.db().latencyMs = 0`);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.bar() && window.__coach.bar().onsets && window.__coach.bar().onsets.length > 0');
  const onsets = await page.evaluate('window.__coach.bar().onsets');
  const list = onsets.flatMap(o => notePerOnset.map(note => ({ note, at: o.t })));
  await page.evaluate(`(function () { ${JSON.stringify(list)}.forEach(function (x) { const fire = function () { if (window.__coach.audioNow() >= x.at) window.__midiSend('kit', [0x99, x.note, 100]); else setTimeout(fire, 4); }; fire(); }); })()`);
  await page.waitFor('window.__coach.bar().judged', 20000);
  return page.evaluate("({ failed: window.__coach.task().els[0].failed, say: document.getElementById('feedback').textContent })");
}
const SHARED = { midiMaps: { [DEVICE]: { 60: 'hihat-closed' } }, hatShared: { [DEVICE]: 60 } };
const SEPARATE = { midiMaps: { [DEVICE]: { 60: 'hihat-closed', 61: 'hihat-open' } } };

test('a shared hat note passes a bar that asks for the open hi-hat', async t => {
  const r = await bar(t, SHARED, 4, [60]);
  assert.equal(r.failed, false, r.say);
});
test('a shared hat note passes a bar that asks for the closed hi-hat (single-hit control)', async t => {
  const r = await bar(t, SHARED, 2, [60]);
  assert.equal(r.failed, false, r.say);
});
test('a shared hat note struck twice per onset is still counted as extra hits (doubled run)', async t => {
  const r = await bar(t, SHARED, 2, [60, 60]);
  assert.equal(r.failed, true);
  assert.match(r.say, /extra/);
});
test('separate notes: the closed note on an open bar still fails as the wrong drum (control)', async t => {
  const r = await bar(t, SEPARATE, 4, [60]);
  assert.equal(r.failed, true);
  assert.match(r.say, /wrong drum/);
});
test('separate notes: the open note on an open bar passes (control)', async t => {
  const r = await bar(t, SEPARATE, 4, [61]);
  assert.equal(r.failed, false, r.say);
});
