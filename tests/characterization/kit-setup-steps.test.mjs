import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { FAKE_MIDI_INIT, midiNoteOn } from '../helpers/fake-midi.mjs';
import { connectFakeMidi } from './kbd-journey-shared.mjs';

// Longer than LEARN_QUIET_MS (250 ms) in src/ui/kit-setup.js: a player pauses between pads.
const pause = () => new Promise(r => setTimeout(r, 300));
const prompt = page => page.evaluate("document.getElementById('kitLearnStatus').textContent");
const coach = page => page.evaluate("document.getElementById('coach').textContent");
const map = page => page.evaluate('window.__coach.db().prefs.kit.midiMaps && window.__coach.db().prefs.kit.midiMaps["XKORCE Kit"]');
const click = (page, id) => page.evaluate(`document.getElementById('${id}').click()`);
const burst = (page, bytes, times = 1) => page.evaluate(`for (let i = 0; i < ${times}; i++) for (const b of ${JSON.stringify(bytes)}) window.__midiSend('p1', b)`);
const cc4 = v => [0xb0, 4, v];
async function startWalk(t, kit) {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate(`${kit ? `window.__coach.db().prefs.kit = ${JSON.stringify(kit)};` : ''} window.__coach.setMod('drum-kit')`);
  await connectFakeMidi(page, 'p1', 'XKORCE Kit');
  await page.evaluate("document.getElementById('setupBtn').click()");
  await click(page, 'kitLearn');
  return page;
}

test('Back returns to the last piece and a new note replaces the old one', async t => {
  const page = await startWalk(t);
  assert.equal(await page.evaluate("document.getElementById('kitLearnBack').disabled"), true, 'nothing to go back to on the first piece');
  await midiNoteOn(page, 'p1', 36); await pause();
  await midiNoteOn(page, 'p1', 38);
  assert.match(await prompt(page), /Hi-hat closed/);
  await click(page, 'kitLearnBack');
  assert.match(await prompt(page), /Snare/);
  await midiNoteOn(page, 'p1', 39); // right after Back: a deliberate step, so it is taken at once
  assert.deepEqual(await map(page), { 36: 'kick', 39: 'snare' });
  assert.match(await prompt(page), /Hi-hat closed/);
});

test('Back then the same note twice at once still teaches one pad (doubled run)', async t => {
  const page = await startWalk(t);
  await midiNoteOn(page, 'p1', 36); await pause();
  await midiNoteOn(page, 'p1', 38);
  await click(page, 'kitLearnBack');
  await burst(page, [[0x90, 41, 100], [0x90, 41, 100]]);
  assert.deepEqual(await map(page), { 36: 'kick', 41: 'snare' });
  assert.match(await prompt(page), /Hi-hat closed now\. Ignored a second signal/);
});

test('the list shows each piece with its note and Relearn redoes just that piece', async t => {
  const page = await startWalk(t);
  await midiNoteOn(page, 'p1', 36); await pause();
  await midiNoteOn(page, 'p1', 38);
  await click(page, 'kitLearnStop');
  const row = id => page.evaluate(`document.getElementById('kitRow-${id}').textContent`);
  assert.match(await row('kick'), /36/);
  assert.match(await row('snare'), /38/);
  assert.match(await row('ride'), /not learned/i);
  await click(page, 'kitRelearn-snare');
  assert.match(await prompt(page), /Snare/);
  await midiNoteOn(page, 'p1', 40);
  assert.deepEqual(await map(page), { 36: 'kick', 40: 'snare' });
  assert.equal(await page.evaluate("document.getElementById('kitLearnStop').hidden"), true, 'a single relearn ends after its one pad');
  assert.equal(await prompt(page), 'Learned 1 pad on XKORCE Kit.');
  assert.match(await row('snare'), /40/);
});

test('Relearn in the middle of the walk jumps to that piece and the walk then continues from there', async t => {
  const page = await startWalk(t);
  await midiNoteOn(page, 'p1', 36); await pause();
  await midiNoteOn(page, 'p1', 38); await pause();
  await click(page, 'kitRelearn-kick');
  assert.match(await prompt(page), /Kick/);
  await midiNoteOn(page, 'p1', 35);
  assert.deepEqual(await map(page), { 35: 'kick', 38: 'snare' });
});

test('hi-hat steps show their sentence, the pedal step says press and offers the skip', async t => {
  const page = await startWalk(t);
  const step = () => page.evaluate("document.getElementById('kitLearnStep').textContent");
  assert.equal(await step(), '', 'no extra sentence on the kick');
  await midiNoteOn(page, 'p1', 36); await pause();
  await midiNoteOn(page, 'p1', 38); await pause();
  assert.match(await step(), /Hi-hat, closed: .*foot down on the pedal/);
  assert.equal(await page.evaluate("document.getElementById('kitLearnNoSend').hidden"), true);
  await midiNoteOn(page, 'p1', 42); await pause();
  assert.match(await prompt(page), /Press the Hi-hat pedal now/);
  assert.match(await step(), /Hi-hat pedal: press the pedal/);
  assert.equal(await page.evaluate("document.getElementById('kitLearnNoSend').hidden"), false);
  await click(page, 'kitLearnNoSend');
  assert.match(await prompt(page), /Hi-hat pedal.*does not send/);
  assert.match(await prompt(page), /Hi-hat open/);
  assert.match(await step(), /Hi-hat, open: /);
  assert.deepEqual(await map(page), { 36: 'kick', 38: 'snare', 42: 'hihat-closed' }, 'the skipped pedal is not invented');
});

async function walkToOpen(t) {
  const page = await startWalk(t);
  await midiNoteOn(page, 'p1', 36); await pause();
  await midiNoteOn(page, 'p1', 38); await pause();
  await midiNoteOn(page, 'p1', 42); await pause();
  await click(page, 'kitLearnNoSend');
  assert.match(await prompt(page), /Hi-hat open/);
  return page;
}

test('closed and open hi-hat may share a note on purpose: the first owner keeps it, the line says so, and it plays as that piece', async t => {
  const page = await walkToOpen(t);
  await midiNoteOn(page, 'p1', 42);
  assert.match(await prompt(page), /Note 42 is shared: the Hi-hat closed and the Hi-hat open send the same note, so playing it counts as the Hi-hat closed/);
  assert.deepEqual(await map(page), { 36: 'kick', 38: 'snare', 42: 'hihat-closed' });
  await click(page, 'kitLearnStop');
  assert.equal(await prompt(page), 'Learned 4 pads on XKORCE Kit.', 'kick, snare, closed and open each have a note');
  assert.match(await page.evaluate("document.getElementById('kitRow-hihat-open').textContent"), /42.*shared/i);
  await midiNoteOn(page, 'p1', 42);
  assert.match(await coach(page), /Hi-hat closed heard/, 'playing the shared note counts as the closed hi-hat');
});

test('a shared note sent twice at once is still one pad (doubled run)', async t => {
  const page = await walkToOpen(t);
  await burst(page, [[0x90, 42, 100], [0x90, 42, 100]]);
  assert.match(await prompt(page), /Ignored a second signal from your last hit \(note 42\)/);
  assert.deepEqual(await map(page), { 36: 'kick', 38: 'snare', 42: 'hihat-closed' });
  await click(page, 'kitLearnStop');
  assert.equal(await prompt(page), 'Learned 4 pads on XKORCE Kit.');
});

test('only that pair may share: any other repeated note is still refused (control)', async t => {
  const page = await startWalk(t);
  await midiNoteOn(page, 'p1', 36); await pause();
  await midiNoteOn(page, 'p1', 36);
  assert.match(await prompt(page), /Note 36 was already taught as the Kick/);
  await pause(); await midiNoteOn(page, 'p1', 38); await pause();
  await midiNoteOn(page, 'p1', 36); // closed hi-hat on the kick's note
  assert.match(await prompt(page), /already taught as the Kick/);
  assert.deepEqual(await map(page), { 36: 'kick', 38: 'snare' });
});

test('sharing also works when the open hi-hat is relearned onto the closed one', async t => {
  const page = await startWalk(t, { midiMaps: { 'XKORCE Kit': { 42: 'hihat-closed', 36: 'kick' } } });
  await click(page, 'kitLearnStop');
  await click(page, 'kitRelearn-hihat-open');
  await midiNoteOn(page, 'p1', 42);
  assert.deepEqual(await map(page), { 36: 'kick', 42: 'hihat-closed' }, 'closed is not erased');
  assert.match(await prompt(page), /shared/);
});

// Counts how many times the app announced a hit on the coach line (one per hit it counted, even when the words repeat).
const watchHits = page => page.evaluate("window.__hits = 0; new MutationObserver(m => { window.__hits += m.length; }).observe(document.getElementById('coach'), { childList: true, characterData: true, subtree: true })");
const hits = page => page.evaluate('window.__hits');
const FLAGGED = { cc4Only: { 'XKORCE Kit': true } };
async function kitPage(t, kit) {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate(`${kit ? `window.__coach.db().prefs.kit = ${JSON.stringify(kit)};` : ''} window.__coach.setMod('drum-kit')`);
  await connectFakeMidi(page, 'p1', 'XKORCE Kit');
  await watchHits(page);
  return page;
}
const restore = async page => { const backup = await page.evaluate('window.__coach.exportProgress()'); return page.evaluate(`window.__coach.importProgress(${JSON.stringify(JSON.stringify(backup))}).then(r => r.ok)`); };
const gap = ms => new Promise(r => setTimeout(r, ms));

test('CC4 is opt-in: an unflagged kit that sends CC4 counts nothing from it (single press and doubled)', async t => {
  const page = await kitPage(t);
  await burst(page, [cc4(0), cc4(120), cc4(0)]);
  await pause(); await burst(page, [cc4(0), cc4(120), cc4(0), cc4(120), cc4(0)]);
  assert.equal(await hits(page), 0, 'a foot moving on the pedal is not a hit');
  await midiNoteOn(page, 'p1', 44); // control: its real note still counts
  assert.equal(await hits(page), 1);
});

test('a kit saved as CC4-only: one press is one hit; jitter, falling and staying above are not more', async t => {
  const page = await kitPage(t, FLAGGED);
  await burst(page, [cc4(0), cc4(30), cc4(63)]);
  assert.equal(await hits(page), 0, 'rising but not through 64');
  await burst(page, [cc4(120)]);
  assert.equal(await hits(page), 1, 'single press');
  await burst(page, [cc4(110), cc4(90), cc4(70), cc4(127)]);
  assert.equal(await hits(page), 1, 'staying above or falling does not fire');
  await burst(page, [cc4(0)]); await pause();
  await burst(page, [cc4(100), cc4(50), cc4(100), cc4(50), cc4(100)]); // doubled and jittery
  assert.equal(await hits(page), 2, 'jitter inside the quiet gap is the same press');
  await burst(page, [cc4(0)]); await pause();
  await burst(page, [cc4(100)]);
  assert.equal(await hits(page), 3, 'after a pause a new press is a new hit');
});

test('CC4 does nothing when the kit is not the instrument, even for a flagged device', async t => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());
  await page.evaluate(`window.__coach.db().prefs.kit = ${JSON.stringify(FLAGGED)}`);
  await connectFakeMidi(page, 'p1', 'XKORCE Kit');
  await watchHits(page);
  await burst(page, [cc4(0), cc4(120)]);
  assert.equal(await hits(page), 0);
});

async function toPedalStep(t, kit) {
  const page = await startWalk(t, kit);
  await midiNoteOn(page, 'p1', 36); await pause();
  await midiNoteOn(page, 'p1', 38); await pause();
  await midiNoteOn(page, 'p1', 42); await pause();
  assert.match(await prompt(page), /Press the Hi-hat pedal/);
  return page;
}
const flag = page => page.evaluate('window.__coach.db().prefs.kit.cc4Only && window.__coach.db().prefs.kit.cc4Only["XKORCE Kit"]');

test('pedal step, CC4 first then the note in one press: the note is learned, no flag, and a press counts one hit', async t => {
  const page = await toPedalStep(t);
  await burst(page, [cc4(0), cc4(120), cc4(0), cc4(120)]); // doubled CC4
  assert.match(await prompt(page), /Press the Hi-hat pedal/, 'the step waits in case the note follows');
  await gap(60); await midiNoteOn(page, 'p1', 44);
  assert.match(await prompt(page), /Hi-hat open/);
  await pause();
  assert.deepEqual(await map(page), { 36: 'kick', 38: 'snare', 42: 'hihat-closed', 44: 'hihat-pedal' });
  assert.ok(!(await flag(page)), 'no CC4-only flag');
  await click(page, 'kitLearnStop');
  await watchHits(page); await pause();
  await burst(page, [cc4(120)]); await gap(60); await midiNoteOn(page, 'p1', 44); await burst(page, [cc4(0)]);
  assert.equal(await hits(page), 1, 'one press, one hit (not the CC4 and the note)');
});

test('pedal step, the note first then CC4: the note is learned, no flag, and a press counts one hit', async t => {
  const page = await toPedalStep(t);
  await midiNoteOn(page, 'p1', 44); await gap(60);
  await burst(page, [cc4(120)]);
  await pause();
  assert.deepEqual(await map(page), { 36: 'kick', 38: 'snare', 42: 'hihat-closed', 44: 'hihat-pedal' });
  assert.ok(!(await flag(page)));
  await click(page, 'kitLearnStop');
  await watchHits(page); await pause();
  await midiNoteOn(page, 'p1', 44); await gap(60); await burst(page, [cc4(120)]);
  assert.equal(await hits(page), 1, 'one press, one hit');
});

test('pedal step, CC4 and no note: after the quiet wait the device is saved as CC4-only and one press counts one hit', async t => {
  const page = await toPedalStep(t);
  await burst(page, [cc4(0), cc4(120)]);
  await pause();
  assert.equal(await flag(page), true);
  assert.match(await prompt(page), /Hi-hat open.*\(CC4\)|\(CC4\).*Hi-hat open/s);
  assert.deepEqual(await map(page), { 36: 'kick', 38: 'snare', 42: 'hihat-closed' });
  assert.match(await page.evaluate("document.getElementById('kitRow-hihat-pedal').textContent"), /CC4/);
  await click(page, 'kitLearnStop');
  assert.equal(await restore(page), true);
  assert.equal(await flag(page), true, 'the flag survives backup and restore');
  await watchHits(page); await pause();
  await burst(page, [cc4(0), cc4(120), cc4(0), cc4(120)]);
  assert.equal(await hits(page), 1, 'doubled press is one hit');
  await pause(); await burst(page, [cc4(120)]);
  assert.equal(await hits(page), 1, 'still above 64: no new hit');
});

test('relearning the pedal with a note clears the CC4-only flag; the skip leaves it alone', async t => {
  const page = await startWalk(t, { midiMaps: { 'XKORCE Kit': { 36: 'kick' } }, ...FLAGGED });
  await click(page, 'kitLearnStop');
  await click(page, 'kitRelearn-hihat-pedal');
  await click(page, 'kitLearnNoSend');
  assert.equal(await flag(page), true, 'skip clears nothing');
  await click(page, 'kitRelearn-hihat-pedal');
  await midiNoteOn(page, 'p1', 44);
  assert.ok(!(await flag(page)), 'a note replaces the flag');
  assert.equal((await map(page))[44], 'hihat-pedal');
});

test('a shared hi-hat note survives backup and reload: the open row does not read "not learned"', async t => {
  const page = await walkToOpen(t);
  await midiNoteOn(page, 'p1', 42);
  await click(page, 'kitLearnStop');
  assert.equal(await page.evaluate('window.__coach.db().prefs.kit.hatShared["XKORCE Kit"]'), 42);
  assert.equal(await restore(page), true);
  await page.evaluate("document.getElementById('kitLearn').click(); document.getElementById('kitLearnStop').click()");
  assert.match(await page.evaluate("document.getElementById('kitRow-hihat-open').textContent"), /42.*shared/i);
});

test('the Back and "my kit does not send this" buttons carry their English labels', async t => {
  const page = await startWalk(t);
  const en = await page.evaluate("[...document.querySelectorAll('#kitLearnBack, #kitLearnNoSend')].map(b => b.textContent)");
  assert.deepEqual(en, ['Back', 'My kit does not send this']);
});
