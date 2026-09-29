// "Play it for me": with a MIDI output connected and picked, the Songs step
// view's Play it for me button sends the song's notes to that output as real
// note-on/note-off bytes, Stop sends All Notes Off (CC 123), and while the
// output is sounding the keyboard's own echoed notes are not judged. Drives
// real fake-MIDI ports (tests/helpers/fake-midi.mjs), never the debug hook
// for the behaviour under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { skipDemo } from '../helpers/songs-demo.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiAddOutput, midiOutSent } from '../helpers/fake-midi.mjs';

const htmlPath = HTML_PATH;
const playBtn = "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => /^(Play it for me|Stop playing)$/.test(b.textContent))";

async function openOde(page) {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Ode to Joy (theme), both hands').click()");
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
}

test('Play it for me sends the song to the picked MIDI output, Stop sends CC 123, echoes are not judged', async () => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  try {
    await midiAddPort(page, 'p1', 'Test Keys');
    await midiAddOutput(page, 'o1', 'Test Keys Out');
    await page.evaluate("document.getElementById('ioBtn').click()");
    await page.waitFor("document.getElementById('ioBtn').hidden === true");
    // The picker lists the output and picking it is a real select change.
    await page.waitFor("document.getElementById('midiOutSelect') && document.getElementById('midiOutSelect').options.length >= 2");
    await page.evaluate("(() => { const s = document.getElementById('midiOutSelect'); s.value = 'o1'; s.dispatchEvent(new Event('change')); })()");

    await openOde(page);
    // Step to a judged step so a count of heard notes exists.
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
    await skipDemo(page);
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()");
    await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')");

    assert.ok(await page.evaluate(`!!(${playBtn})`), 'the Play it for me button is shown once an output is picked');
    await page.evaluate(`${playBtn}.click()`);
    await page.waitFor("window.__midiOutSent.length > 4");
    const sent = await midiOutSent(page);
    assert.deepEqual(sent[0].bytes.slice(0, 1), [0x90], 'first message is a note-on');
    assert.equal(sent[0].id, 'o1');
    const kinds = sent.map(m => m.bytes[0] & 0xf0);
    assert.ok(kinds.includes(0x80), 'note-offs follow');
    for (let i = 1; i < sent.length; i++) assert.ok(sent[i].atMs >= sent[i - 1].atMs, 'messages are in time order');
    assert.ok(sent[0].atMs > await page.evaluate('performance.now()') - 5000, 'timestamps are on the performance.now() timeline');
    assert.equal(await page.evaluate(`${playBtn}.textContent`), 'Stop playing');

    // The keyboard echoing its own note back while sounding is not judged.
    await page.evaluate("window.__midiSend('p1', [0x90, 64, 100])");
    assert.equal(await page.evaluate("document.querySelector('.panel-songs-count').textContent"), 'Notes heard so far: 0');

    const before = sent.length;
    await page.evaluate(`${playBtn}.click()`);
    const after = await midiOutSent(page);
    assert.deepEqual(after[before].bytes, [0xb0, 123, 0], 'Stop sends All Notes Off first');
    assert.equal(await page.evaluate(`${playBtn}.textContent`), 'Play it for me');

    // Judging resumes once playback has stopped.
    await page.evaluate("window.__midiSend('p1', [0x90, 64, 100])");
    await page.waitFor("document.querySelector('.panel-songs-count').textContent === 'Notes heard so far: 1'");
  } finally { await page.close(); }
});

test('no Play it for me button until an output is picked', async () => {
  const page = await launchPage(htmlPath, { initScript: FAKE_MIDI_INIT });
  try {
    await midiAddPort(page, 'p1', 'Test Keys');
    await page.evaluate("document.getElementById('ioBtn').click()");
    await page.waitFor("document.getElementById('ioBtn').hidden === true");
    await openOde(page);
    assert.equal(await page.evaluate(`!!(${playBtn})`), false);
  } finally { await page.close(); }
});
