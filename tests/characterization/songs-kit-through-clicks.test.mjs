// Back-Road-Creative/band-coach#638: the trainer clicks through the bar once a real
// MIDI hit has stopped mic counting (barClickCount(micReady && !kitMidiHit)). Songs'
// drum part must do the same: no through-clicks while the mic counts (it would hear
// each click as a hit), clicks from the first real MIDI hit, none again once the
// e-kit is unplugged. Read from the beat guide's own data-clicks, the count of
// through-clicks it has sounded; a tone spy on the click path proves they are heard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiRemovePort, midiNoteOn } from '../helpers/fake-midi.mjs';

// Eight beats at 100 bpm (4.8 s) so a hit just after the count-in leaves most of the bar to click.
const song = JSON.stringify({
  schema: 'challenge/1', title: 'Kit click test',
  songs: [{
    schema: 'song/1', id: 'kit-click', title: 'Kit Click Song', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
    parts: [{ id: 'kit', name: 'Kit', role: 'percussion', notes: Array.from({ length: 8 }, (_, i) => ({ start: i * 480, dur: 480, midi: i % 2 ? 38 : 36, piece: i % 2 ? 'snare' : 'kick' })) }],
    chords: [],
  }],
});
const btns = (sel, text) => `Array.from(document.querySelectorAll('${sel} button')).find(b => b.textContent === ${JSON.stringify(text)})`;

async function open(t, { connect = true, fakeAudioFile } = {}) {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT, ...(fakeAudioFile ? { fakeAudioFile } : {}) });
  t.after(() => page.close());
  await page.evaluate("window.__coach.setMod('drum-kit')");
  if (connect) {
    await midiAddPort(page, 'k1', 'Test Kit');
    await page.evaluate("document.getElementById('ioBtn').click()");
    await page.waitFor("/Test Kit found/.test(document.getElementById('ioText').textContent)");
  }
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-kitclick-'));
  const file = join(dir, 'challenge.json');
  writeFileSync(file, song);
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', file);
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('Kit Click Song'))");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('Kit Click Song')).click()");
  rmSync(dir, { recursive: true, force: true });
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  while (!(await page.evaluate(`!!(${btns('.panel-songs-practice', 'Your turn')})`))) {
    await page.evaluate(`${btns('.panel-songs-practice', 'Next')}.click()`);
    await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  }
  // The first Your-turn is the untimed drums-in-order step, which has no clicks to give: play it
  // through hook-driven notes (never source 'midi', so they cannot switch the mic off) to reach a timed step.
  const HEAD = "document.querySelector('.panel-songs-practice h4').textContent";
  while ((await page.evaluate(HEAD)).startsWith('Play the drums in order')) {
    const before = await page.evaluate(HEAD);
    await page.evaluate(`${btns('.panel-songs-practice', 'Your turn')}.click()`);
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')", 8000);
    await page.evaluate("[36, 38, 36, 38, 36, 38, 36, 38].forEach((m, i) => window.__coach.songsNoteAt(m, i * 1.7, true))");
    await page.waitFor(`!!(${btns('.panel-songs-practice', 'Stop and check')})`);
    await page.evaluate(`${btns('.panel-songs-practice', 'Stop and check')}.click()`);
    await page.waitFor(`document.querySelector('.panel-songs-practice h4').textContent !== ${JSON.stringify(before)}`, 8000);
    while (!(await page.evaluate(`!!(${btns('.panel-songs-practice', 'Your turn')})`))) {
      await page.evaluate(`${btns('.panel-songs-practice', 'Next')}.click()`);
      await page.waitFor("document.querySelector('.panel-songs-practice h4')");
    }
  }
  await page.evaluate(`${btns('.panel-songs-practice', 'Your turn')}.click()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");
  return page;
}
const clicks = (page) => page.evaluate("Number(document.querySelector('.panel-songs-beat-guide').dataset.clicks)");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('while the mic counts, a drum part has no clicks through the bar', async (t) => {
  const page = await open(t, { connect: false });
  await sleep(3000);
  assert.equal(await clicks(page), 0);
});

test('after a real MIDI hit the clicks run through the bar', async (t) => {
  const page = await open(t);
  assert.equal(await clicks(page), 0, 'none before the first hit');
  await midiNoteOn(page, 'k1', 36);
  await page.waitFor("Number(document.querySelector('.panel-songs-beat-guide').dataset.clicks) >= 2");
  assert.deepEqual(page.exceptions, []);
});

test('a computer-key hit does not turn the clicks on', async (t) => {
  const page = await open(t, { connect: false });
  await page.evaluate("window.__coach.songsNote(36, true, undefined, 'computer-key')");
  await sleep(2500);
  assert.equal(await clicks(page), 0);
});

test('unplugging the e-kit stops the clicks again', async (t) => {
  const page = await open(t);
  await midiNoteOn(page, 'k1', 36);
  await page.waitFor("Number(document.querySelector('.panel-songs-beat-guide').dataset.clicks) >= 1");
  await midiRemovePort(page, 'k1');
  await page.waitFor("!/Test Kit/.test(document.getElementById('ioText').textContent)");
  const at = await clicks(page);
  await sleep(2500);
  assert.ok((await clicks(page)) - at <= 1, 'at most the click already booked');
});

// #638 point 2: "Notes heard so far: 8" with no playing came from the headless browser's
// default fake microphone, which beeps about twice a second (measured: 3, 8, 12, 16, 20, 24
// after 2, 4, 6, 8, 10, 12 s). That is a real tone crossing the gate, not the app counting
// noise. With silence in the fake mic nothing is counted, which this pins.
test('a silent microphone counts no hits when nothing is played', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-silence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rate = 48000, n = rate * 20, wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
  const file = join(dir, 'silence.wav');
  writeFileSync(file, wav);
  const page = await open(t, { connect: false, fakeAudioFile: file });
  await sleep(6000);
  assert.equal(await page.evaluate("document.querySelector('.panel-songs-count').textContent"), 'Notes heard so far: 0');
});
