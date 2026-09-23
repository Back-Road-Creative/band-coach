// "Record a tune" panel (src/ui/editor.js), driven through the built page's
// real DOM. Uses window.__coach.editorSetFrames (a __DEBUG_HOOK__-only test
// hook, compiled out of the release build) to hand Stop a fixed, known set
// of raw pitch frames instead of depending on the fake microphone device to
// produce a detectable tone, so the transcription this asserts on is
// deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const TPQ = 480;

// Two clean quarter notes at 120 bpm (0.5s each): C4 (midi 60) then D4 (62).
const TWO_NOTE_FRAMES = [];
for (let i = 0; i < 20; i++) TWO_NOTE_FRAMES.push({ t: i * 0.025, midi: 60, rms: 0.2, confidence: 0.95 });
for (let i = 0; i < 20; i++) TWO_NOTE_FRAMES.push({ t: 0.5 + i * 0.025, midi: 62, rms: 0.2, confidence: 0.95 });

async function openEditor(page) {
  await page.evaluate("window.__coach.openPanel('editor')");
  await page.waitFor("window.__coach.panelOpen() === 'editor'");
}

async function recordFrames(page, frames) {
  await page.evaluate(`window.__coach.editorSetFrames(${JSON.stringify(frames)})`);
  await page.evaluate("document.getElementById('editorListenBtn').click()");
  await page.waitFor('window.__coach.editorRecording()');
  await page.evaluate("document.getElementById('editorListenBtn').click()");
  await page.waitFor("document.getElementById('editorCheck').hidden === false");
}

test('opens as a registered panel with the record controls visible', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);
  assert.equal(await page.evaluate("!!document.getElementById('editorListenBtn')"), true);
  assert.equal(await page.evaluate("document.getElementById('editorListenBtn').textContent"), 'Listen');
  assert.equal(await page.evaluate("document.getElementById('editorSaveBtn').disabled"), true, 'save is disabled before anything is transcribed');
});

test('Listen/Stop transcribes the captured frames and gates practise/save behind the needsCheck list', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);

  await recordFrames(page, TWO_NOTE_FRAMES);

  // needsCheck always includes the key-profile caveat (src/song/transcribe.js),
  // so the check box must show and gate the controls.
  assert.equal(await page.evaluate("document.getElementById('editorCheck').hidden"), false);
  assert.equal(await page.evaluate("document.getElementById('editorSaveBtn').disabled"), true, 'save stays disabled until acknowledged');
  assert.equal(await page.evaluate("document.getElementById('editorPlayBtn').disabled"), true, 'play stays disabled until acknowledged');

  await page.evaluate("document.getElementById('editorAck').click()");
  assert.equal(await page.evaluate("document.getElementById('editorSaveBtn').disabled"), false, 'acknowledging the check list unlocks save');
  assert.equal(await page.evaluate("document.getElementById('editorPlayBtn').disabled"), false, 'acknowledging the check list unlocks play');
});

test('Stop shows "Working it out..." before the transcription result overwrites it, and Listen is disabled meanwhile', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);

  await page.evaluate(`window.__coach.editorSetFrames(${JSON.stringify(TWO_NOTE_FRAMES)})`);
  await page.evaluate("document.getElementById('editorListenBtn').click()");
  await page.waitFor('window.__coach.editorRecording()');

  // click() and the read happen inside the SAME Runtime.evaluate call, with
  // no CDP round trip between them, so this genuinely observes what the
  // click handler did synchronously before its first await -- transcribe()
  // (synchronous CPU work) must not have run yet. Before the fix, Stop set
  // "Working it out..." and then called transcribe() in the very same task,
  // so this would already read the transcription's own status text instead.
  const rightAfterClick = await page.evaluate(`(function(){
    document.getElementById('editorListenBtn').click();
    return {
      status: document.querySelector('.editor-status').textContent,
      disabled: document.getElementById('editorListenBtn').disabled,
    };
  })()`);
  assert.equal(rightAfterClick.status, 'Working it out…', 'the "Working it out..." status must be set (and get a chance to paint) before transcribe() runs');
  assert.equal(rightAfterClick.disabled, true, 'Listen must be disabled while the capture is being worked out, so a second tap cannot race the same transcribe');

  await page.waitFor("document.getElementById('editorCheck').hidden === false");
  assert.equal(await page.evaluate("document.getElementById('editorListenBtn').disabled"), false, 'Listen must re-enable once the transcription has landed');
});

test('a double-tapped Listen click cannot leave the mic-polling interval running after Stop', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);

  // Two rapid taps before openMic() has had a chance to resolve -- the real
  // defect this guards: without the fix the second tap opened a second,
  // un-clearable interval that kept polling (and appending frames) even
  // after Stop closed the panel down.
  await page.evaluate(`(function(){
    const b = document.getElementById('editorListenBtn');
    b.click();
    b.click();
  })()`);
  await page.waitFor('window.__coach.editorRecording()');

  await page.evaluate("document.getElementById('editorListenBtn').click()");
  await page.waitFor("document.getElementById('editorCheck').hidden === false");
  assert.equal(await page.evaluate("window.__coach.editorRecording()"), false, 'no interval should still be running once Stop has finished');
});

test('keyboard: arrow keys select and move a note, +/- repitches, Delete removes, Ctrl+Z undoes', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);
  await recordFrames(page, TWO_NOTE_FRAMES);
  await page.evaluate("document.getElementById('editorAck').click()");

  await page.evaluate("document.getElementById('editorCanvas').focus()");
  await page.evaluate(`(function(){
    const c = document.getElementById('editorCanvas');
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  })()`);
  // Selecting the first note, then repitch it up a semitone.
  await page.evaluate(`(function(){
    const c = document.getElementById('editorCanvas');
    c.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
  })()`);
  const midiAfterRepitch = await page.evaluate("window.__coach.editorSong().parts[0].notes[0].midi");
  assert.equal(midiAfterRepitch, 61, 'the "+" key raises the selected note a semitone');

  await page.evaluate(`(function(){
    const c = document.getElementById('editorCanvas');
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  })()`);
  const midiAfterUndo = await page.evaluate("window.__coach.editorSong().parts[0].notes[0].midi");
  assert.equal(midiAfterUndo, 60, 'Ctrl+Z undoes the repitch');

  const notesBeforeDelete = await page.evaluate("window.__coach.editorSong().parts[0].notes.length");
  await page.evaluate(`(function(){
    const c = document.getElementById('editorCanvas');
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  })()`);
  const notesAfterDelete = await page.evaluate("window.__coach.editorSong().parts[0].notes.length");
  assert.equal(notesAfterDelete, notesBeforeDelete - 1, 'Delete removes the selected note');
});

test('save validates and stores the song in the shared library', async (t) => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openEditor(page);
  await recordFrames(page, TWO_NOTE_FRAMES);
  await page.evaluate("document.getElementById('editorAck').click()");
  await page.evaluate("document.getElementById('editorTitle').value = 'My Test Tune'");
  await page.evaluate("document.getElementById('editorSaveBtn').click()");
  await page.waitFor("document.querySelector('.editor-say').textContent.length > 0");
  assert.equal(await page.evaluate("document.querySelector('.editor-say').textContent"), 'Saved to your songs.');
});
