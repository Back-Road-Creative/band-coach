// E6c: a single-song notation import, with the keyboard picked, says in
// plain words what changed to fit the keyboard -- built on E6a's
// fidelityReport (src/song/eval/fidelity.js), already in the base. A clean
// report (nothing to say) shows no notice at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { exportMidi } from '../../src/song/export-midi.js';
import { fidelityNoticeText } from '../../src/ui/songs.js';

const htmlPath = HTML_PATH;

// A round-tripped MIDI of these notes gives fitToInstrument's kbd probe an
// out-of-range low C1 (24) next to in-range notes -- an octave-only shift
// would fix a lone low chunk, so in-range notes must sit right beside it
// (see fidelity.js's fitToInstrument/candidateShifts, verified at base).
function songWithNotes(midiNotes) {
  return {
    schema: 'song/1', id: 'low-c-test', title: 'Low C Test', composer: null, licence: null, source: null,
    key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{
      id: 'melody', name: 'Melody',
      notes: midiNotes.map((midi, i) => ({ start: i * 480, dur: 480, midi })),
    }],
    chords: [],
  };
}

function writeMidiFixture(dir, name, midiNotes) {
  const path = join(dir, name);
  writeFileSync(path, Buffer.from(exportMidi(songWithNotes(midiNotes))));
  return path;
}

test('a keyboard import with a note out of the keyboard range shows a plain-words notice', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-fidelity-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const midiPath = writeMidiFixture(dir, 'Low C Test.mid', [60, 62, 64, 24, 65, 67]);

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', midiPath);
  await page.waitFor(
    "document.querySelector('.panel-songs-msg') && document.querySelector('.panel-songs-msg').textContent.includes('Low C Test')"
  );

  const notice = await page.evaluate(
    "(() => { const el = document.querySelector('.panel-songs-fidelity'); return el ? { hidden: el.hidden, text: el.textContent } : null; })()"
  );
  assert.ok(notice, '.panel-songs-fidelity should exist');
  assert.equal(notice.hidden, false);
  assert.match(notice.text, /1 note/);
  assert.match(notice.text, /too low or too high for the keyboard/);
});

test('a clean keyboard import shows no notice, and the song still lands Checked', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-fidelity-clean-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const midiPath = writeMidiFixture(dir, 'Low C Test.mid', [60, 62, 64, 65, 67]);

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', midiPath);
  await page.waitFor(
    "document.querySelector('.panel-songs-msg') && document.querySelector('.panel-songs-msg').textContent.includes('Low C Test')"
  );

  const notice = await page.evaluate(
    "(() => { const el = document.querySelector('.panel-songs-fidelity'); return el ? { hidden: el.hidden, text: el.textContent } : null; })()"
  );
  assert.ok(!notice || notice.hidden || notice.text.trim() === '', 'clean import should show no fidelity notice');

  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row')).some(row => row.textContent.includes('Low C Test') && row.textContent.includes('Checked'))"
  );
});

test('the notice is kbd-only: a non-keyboard instrument gets nothing even with an out-of-range note', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-fidelity-flute-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const midiPath = writeMidiFixture(dir, 'Low C Test.mid', [60, 62, 64, 24, 65, 67]);

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('flute')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', midiPath);
  await page.waitFor(
    "document.querySelector('.panel-songs-msg') && document.querySelector('.panel-songs-msg').textContent.includes('Low C Test')"
  );

  const notice = await page.evaluate(
    "(() => { const el = document.querySelector('.panel-songs-fidelity'); return el ? { hidden: el.hidden, text: el.textContent } : null; })()"
  );
  assert.ok(!notice || notice.hidden || notice.text.trim() === '', 'a non-keyboard instrument should show no fidelity notice');
});

test('fidelityNoticeText: pure node-side wording', () => {
  assert.match(fidelityNoticeText({ dropped: [], merged: [], octaveShift: 0, shiftSemitones: 0, outOfRange: [{ reason: 'out-of-range' }], chordReduced: [], hands: null }), /1 note/);
  assert.equal(
    fidelityNoticeText({ dropped: [], merged: [], octaveShift: 0, shiftSemitones: 0, outOfRange: [{ reason: 'percussion part needs the drum kit' }], chordReduced: [], hands: null }),
    ''
  );
  assert.match(
    fidelityNoticeText({ dropped: [], merged: [], octaveShift: 24, shiftSemitones: 24, outOfRange: [], chordReduced: [], hands: null }),
    /up 2 octaves/
  );
  assert.equal(
    fidelityNoticeText({ dropped: [], merged: [], octaveShift: 0, shiftSemitones: 0, outOfRange: [], chordReduced: [], hands: null }),
    ''
  );
});
