// F13 (range half): "Set my keyboard's range" through the real UI with fake MIDI
// note-ons -- the stored prefs, the range line, and a keyboard drill that stays
// inside the stored range. Pure logic: tests/unit/midi-range.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn, midiNoteOff } from '../helpers/fake-midi.mjs';

async function start(t) {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'p1', 'Test Keys');
  await page.evaluate("document.getElementById('ioBtn').click()");
  await page.waitFor("document.getElementById('ioBtn').hidden === true");
  return page;
}
const coach = page => page.evaluate("document.getElementById('coach').textContent");
const line = page => page.evaluate("document.getElementById('midiRangeLine').textContent");
const press = async (page, n) => { await midiNoteOn(page, 'p1', n); await midiNoteOff(page, 'p1', n); };
async function setRange(page, lo, hi) {
  await page.evaluate("document.getElementById('midiRangeBtn').click()");
  await press(page, lo); await press(page, hi);
}

test('lowest then highest key are asked for, stored per keyboard, and shown', async (t) => {
  const page = await start(t);
  await page.evaluate("document.getElementById('midiRangeBtn').click()");
  assert.equal(await coach(page), 'Play your lowest key');
  await press(page, 48);
  assert.equal(await coach(page), 'Play your highest key');
  await press(page, 72);
  assert.equal(await coach(page), 'Range: C3 to C5 (25 keys)');
  assert.equal(await line(page), 'Range: C3 to C5 (25 keys)');
  assert.deepEqual(await page.evaluate('window.__coach.db().prefs.midiRange'), { 'Test Keys': { low: 48, high: 72 } });
  await page.waitFor("(localStorage.getItem('bandcoach.v1') || '').indexOf('midiRange') > 0"); // saved, so it survives a reload and rides in the backup
  assert.deepEqual(page.exceptions, []);
});

test('the capture notes are not judged as an answer', async (t) => {
  const page = await start(t);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');
  await page.evaluate("document.getElementById('midiRangeBtn').click()");
  await press(page, 48); await press(page, 72);
  assert.equal(await page.evaluate("document.getElementById('feedback').className"), '');
});

test('a highest key under an octave away is refused and the app keeps waiting', async (t) => {
  const page = await start(t);
  await page.evaluate("document.getElementById('midiRangeBtn').click()");
  await press(page, 60); await press(page, 64);
  assert.match(await coach(page), /less than an octave/);
  assert.equal(await page.evaluate('window.__coach.db().prefs.midiRange && Object.keys(window.__coach.db().prefs.midiRange).length'), 0);
  await press(page, 84);
  assert.equal(await line(page), 'Range: C4 to C6 (25 keys)');
});

test('Clear removes the stored range', async (t) => {
  const page = await start(t);
  await setRange(page, 48, 72);
  await page.evaluate("document.getElementById('midiRangeClear').click()");
  assert.deepEqual(await page.evaluate('window.__coach.db().prefs.midiRange'), {});
  assert.equal(await line(page), '');
});

test('a keyboard drill picks target notes inside the stored range', async (t) => {
  const page = await start(t);
  await setRange(page, 72, 96);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && window.__coach.cur()');
  const mids = await page.evaluate('window.__coach.task().els.map(e => e.info.midi)');
  assert.ok(mids.length > 0 && mids.every(m => m >= 72 && m <= 96), JSON.stringify(mids));
});

test('with no stored range the drill is unchanged (control)', async (t) => {
  const page = await start(t);
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task() && window.__coach.cur()');
  const mids = await page.evaluate('window.__coach.task().els.map(e => e.info.midi)');
  assert.ok(mids.some(m => m < 72), JSON.stringify(mids));
});
