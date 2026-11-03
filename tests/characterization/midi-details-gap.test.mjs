// MIDI details shows the gap since the previous message from the same input,
// so a player whose e-kit sends two signals per hit can size a filter window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiSend } from '../helpers/fake-midi.mjs';
import { connectFakeMidi } from './kbd-journey-shared.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';

async function lines(page) {
  await page.evaluate("(() => { const el = document.getElementById('midiDetails'); if (el.hidden) document.getElementById('midiDetailsBtn').click(); else { document.getElementById('midiDetailsBtn').click(); document.getElementById('midiDetailsBtn').click(); } })()");
  const t = await page.evaluate("document.getElementById('midiDetailsText').textContent");
  const l = t.split('\n'); return l.slice(l.findIndex(x => x.startsWith('Last messages heard')) + 1);
}

test('two messages from one port show the gap on the newest line', async () => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  try {
    await connectFakeMidi(page, 'p1', 'Kit');
    await midiSend(page, 'p1', [0x99, 0x24, 0x64], 1000);
    await midiSend(page, 'p1', [0x99, 0x24, 0x64], 1015);
    const l = await lines(page);
    assert.equal(l[0], '99 24 64  +15 ms');
    assert.equal(l[1], '99 24 64');
  } finally { await page.close(); }
});

// Keeps the same port object, as a browser may on a replug, so a gap kept per port would survive it.
const setPortState = (page, id, state) => page.evaluate(`(() => { const p = window.__midiPorts.get('${id}'); p.state = '${state}'; window.__midiAccessListeners.forEach(fn => fn({ port: p })); })()`);

test('after the last port goes away and comes back, the first message shows no gap', async () => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  try {
    await connectFakeMidi(page, 'p1', 'Kit');
    await midiSend(page, 'p1', [0x99, 0x24, 0x64], 1000);
    await setPortState(page, 'p1', 'disconnected');
    await page.waitFor("document.getElementById('ioBtn').hidden === false");
    await setPortState(page, 'p1', 'connected');
    await page.waitFor("document.getElementById('ioBtn').hidden === true");
    await midiSend(page, 'p1', [0x99, 0x24, 0x64], 90000);
    const l = await lines(page);
    assert.equal(l[0], '99 24 64');
  } finally { await page.close(); }
});

test('a lone message shows no gap', async () => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  try {
    await connectFakeMidi(page, 'p1', 'Kit');
    await midiSend(page, 'p1', [0x99, 0x24, 0x64], 1000);
    const l = await lines(page);
    assert.equal(l[0], '99 24 64');
    assert.doesNotMatch(l[0], /ms/);
  } finally { await page.close(); }
});

test('a message on another port does not take its gap from the first port', async () => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  try {
    await midiAddPort(page, 'p2', 'Pad');
    await connectFakeMidi(page, 'p1', 'Kit');
    await midiSend(page, 'p1', [0x99, 0x24, 0x64], 1000);
    await midiSend(page, 'p2', [0x99, 0x26, 0x64], 1500);
    let l = await lines(page);
    assert.equal(l[0], '99 26 64');
    await midiSend(page, 'p2', [0x99, 0x26, 0x64], 1520);
    l = await lines(page);
    assert.equal(l[0], '99 26 64  +20 ms');
  } finally { await page.close(); }
});
