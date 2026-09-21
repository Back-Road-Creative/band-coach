// REGRESSION, from the field against v1.4.0: "the midi keyboard didnt seem to
// work ... it stayed on 'found. press any key on it.' no blinking", on a setup
// where MIDI had worked in an earlier version.
//
// That symptom pair is diagnostic. The activity dot blinks on ANY byte before
// anything is parsed or judged (src/app.js handleMidiMessage), so "named
// device, 'found', and no blink" means zero bytes ever reached the page -- not
// a parsing or judging problem, a listening one.
//
// What changed. Before #22 ("earn the connected status") the connect handler
// attached a note listener to EVERY input, unconditionally:
//
//     a.inputs.forEach(i => { n++; i.onmidimessage = ev => ...; });
//
// After #22 it attaches only to ports whose `open()` RESOLVED:
//
//     results.filter(r => r.ok).forEach(r => { r.input.onmidimessage = ... });
//
// #22 was right that "connected" should be earned -- the status it replaced
// lit up green for a keyboard sending nothing. But making the STATUS honest
// quietly narrowed what the app LISTENS to, and those are different jobs. Web
// MIDI opens a port implicitly when onmidimessage is assigned, which is why
// the old code heard keyboards without ever calling open(); gating the
// listener on an explicit open() throws that away. On Windows MIDI ports are
// exclusive, so open() rejecting is ordinary -- a DAW, or the keyboard's own
// utility, holding the port is enough.
//
// Two real keyboards are lost by it. One with several ports (most have a note
// port plus a control or "through" port) where the note port is held and a
// sibling is free: the sibling opens, `midiOn` goes true, the status names the
// device and says "found", and not one byte arrives -- the field report
// exactly. And one with a single held port, which the old code still heard.
//
// So: listen to everything, report honestly about what opened. A listener
// costs nothing and a port that truly cannot deliver simply never fires. The
// status, the activity dot and the details readout keep telling the truth
// about open() separately -- that part of #22 is unchanged, and the third
// test here holds it in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';
import { FAKE_MIDI_INIT, midiAddPort, midiNoteOn, midiSetOpenResult } from '../helpers/fake-midi.mjs';

// The blink is what the user watched for and never saw, so it is what these
// assert on: visible proof a byte reached the page, independent of whether
// anything is running to judge it.
const BLINKED = "document.getElementById('midiActDot').classList.contains('on') === true";

async function connectMidi(page) {
  await page.evaluate("document.getElementById('ioBtn').click()");
}

test('a note is heard from a port whose open() failed, while a sibling port opened', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");

  // A multi-port keyboard: the port carrying the notes is held by something
  // else, its sibling is free. The sibling opening is what makes the app say
  // "found" at all -- reproducing the field report's exact status.
  await midiAddPort(page, 'notes', 'Studio 49 Keyboard');
  await midiAddPort(page, 'control', 'Studio 49 Keyboard DAW Control');
  await midiSetOpenResult(page, 'notes', false);
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  const status = await page.evaluate("document.getElementById('ioText').textContent");
  assert.match(status, /found/i, 'precondition: the sibling port made the app claim a device was found');

  await midiNoteOn(page, 'notes', 60);

  await page.waitFor(BLINKED, 2000).catch(() => {
    assert.fail(
      'a key pressed on the keyboard produced nothing visible. Its note port failed to open, so no ' +
        'listener was ever attached to it, while a sibling port opened and made the status claim a ' +
        'device was found. This is the field report: a named device, "found. Press any key on it.", ' +
        'and not one byte arriving.',
    );
  });

  const log = await page.evaluate('window.__coach.midi().log.join("|")');
  assert.match(log, /90 3c 64/i, 'the note-on should also reach the details log: ' + log);
});

test('a note is heard from a single port whose open() failed, as it was before #22', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");

  // The simpler shape of the same defect, and the clearer statement of the
  // principle: one port, held, so open() rejects. The status is right to stay
  // cautious here -- but the app used to hear this keyboard, and should again.
  await midiAddPort(page, 'p1', 'Busy Keys');
  await midiSetOpenResult(page, 'p1', false);
  await connectMidi(page);
  await page.waitFor("/another program/i.test(document.getElementById('ioText').textContent)");

  await midiNoteOn(page, 'p1', 60);

  await page.waitFor(BLINKED, 2000).catch(() => {
    assert.fail(
      'a note from a port whose open() rejected was never heard. Web MIDI opens a port implicitly ' +
        'when onmidimessage is assigned, so gating the listener on an explicit open() gives up ' +
        'keyboards the app used to work with and gains nothing -- a port that genuinely cannot ' +
        'deliver messages simply never fires.',
    );
  });
});

test('listening more widely does not make the status claim a port opened when it did not', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_MIDI_INIT });
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await midiAddPort(page, 'notes', 'Studio 49 Keyboard');
  await midiAddPort(page, 'control', 'Studio 49 Keyboard DAW Control');
  await midiSetOpenResult(page, 'notes', false);
  await connectMidi(page);
  await page.waitFor("document.getElementById('ioBtn').hidden === true");

  // The honesty #22 added has to survive: hearing a port is not licence to
  // report that it opened, and the name of a port that failed must not appear
  // in the "... is working" status as though it were fine.
  const names = await page.evaluate("document.getElementById('ioText').textContent");
  assert.doesNotMatch(
    names,
    /Studio 49 Keyboard(?! DAW)/,
    'the port that failed to open must not be named as a working device: ' + names,
  );

  await page.evaluate("document.getElementById('midiDetailsBtn').click()");
  await page.waitFor("document.getElementById('midiDetails').hidden === false");
  const details = await page.evaluate("document.getElementById('midiDetailsText').textContent");

  assert.match(
    details,
    /Studio 49 Keyboard -- [^\n]*open failed/,
    'the details readout must still report the failed port as failed: ' + details,
  );
  assert.match(
    details,
    /Studio 49 Keyboard DAW Control -- [^\n]*opened\./,
    'the port that did open must still be reported as opened: ' + details,
  );
});
