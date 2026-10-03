// W5, Windows lane: acceptance A03 on real hardware (does Connect handle the
// outcome the browser gives it?). The lane answers Chrome's MIDI question with
// Allow through Browser.grantPermissions (page.grant, recorded in the report;
// midi and midi-sysex are both granted, see below), then Set up input and
// Connect are clicked for real. Whatever the machine has -- a keyboard
// found, one already working, none plugged in, one busy -- must come out as the
// app's own plain sentence. A "could not reach MIDI" after an Allow, an
// exception, or a status that never changes is not a pass. The one case the lane
// cannot judge on its own is "the answer was no": either the app misreported a
// grant, or Chrome never honoured the lane's Allow. The browser settles it: the
// same call made straight from the page is asked, and only an "ok" there makes
// the app's "no" a FAIL; a refusal there is BLOCKED (the lane could not answer
// Chrome's prompt; the app told the truth). On Windows Chrome 154 a plain 'midi'
// grant was refused this way (measured 2026-10-03: requestMIDIAccess rejected with
// NotAllowedError) and granting 'midi-sysex' as well was honoured, so both are granted.
// NO MIDI IS SENT: the app only sends through "Play it for me", which needs an
// output the learner picked in #midiOutSelect; this scenario never touches that
// select or any such control, and reads its value at the end to prove it.
// README check 2 (found -> working needs key presses on a real keyboard) is not
// covered here and stays a human step.
export const id = 'W5';

// A lane choice, not a product threshold: how long Connect gets to change the status line.
const ANSWER_MS = 30000;
const status = (page) => page.evaluate("document.getElementById('ioText').textContent.trim()");
// The browser's own answer for MIDI on this page (a read, no prompt), 'granted' once an Allow has landed.
const midiState = (page) => page.evaluate("navigator.permissions.query({ name: 'midi' }).then((r) => r.state, (e) => 'unreadable: ' + e.message)");

export async function run(page) {
  await page.grant(['midi', 'midi-sysex']);
  const before = await status(page);
  const stateAfterGrant = await midiState(page);
  // A Set up input click that never opens the sheet is the finding, not a lane limit: report it, do not throw.
  let stuck;
  try {
    await page.clickSelector('#setupBtn');
    await page.waitFor("!document.getElementById('setupSheet').hidden", 10000);
  } catch (e) {
    stuck = e.message;
  }
  if (!stuck) {
    await page.clickSelector('#ioBtn');
    try {
      await page.waitFor(`document.getElementById('ioText').textContent.trim() !== ${JSON.stringify(before)}`, ANSWER_MS);
      // Real hardware can settle in two steps (found, then working): read it again after a moment.
      await new Promise((r) => setTimeout(r, 1000));
    } catch {}
  }
  const after = await status(page);
  // Only when the app said "no": what the browser says to the same request made straight from the page.
  const direct = DENIED.test(after) ? await page.evaluate("Promise.race([navigator.requestMIDIAccess().then((a) => 'ok, inputs ' + a.inputs.size, (e) => e.name + ': ' + e.message), new Promise((r) => setTimeout(() => r('no answer in 10 s'), 10000))])") : undefined;
  return {
    stuck,
    before,
    after,
    direct,
    stateAfterGrant,
    stateAfterConnect: await midiState(page),
    exceptions: [...page.exceptions],
    midiOutValue: await page.evaluate("document.getElementById('midiOutSelect').value"),
    permission: 'answered with Allow by the lane (Browser.grantPermissions: midi and midiSysex both granted, because a plain midi grant was not honoured on Windows Chrome 154, measured 2026-10-03)',
    midiSent: false,
  };
}

// What Connect says for each outcome it handles, by branch (src/app.js ioRefresh and connectMidi).
const ACCEPTED = [
  ['found', /found\. Press any key on (it|one)\.$/],
  ['working', /(is|are) working\.$/],
  ['no device', /^No MIDI device is plugged in\./],
  ['busy', /^Another program may be using this keyboard\./],
];
// What it says when the browser could not give it MIDI after the lane's Allow.
const REFUSED = [/^MIDI was blocked here\./, /^This browser could not reach MIDI/, /^This browser cannot read MIDI/];
// What it says when the permission answer was no (NotAllowedError).
const DENIED = /^Chrome asked to use your MIDI devices and the answer was no/;

// Pure: an observation in, { status, text, findings } out.
export function w5Verdict(o) {
  const findings = [];
  for (const x of o.exceptions) findings.push(`uncaught exception: ${x}`);
  if (o.stuck) findings.push(`Set up input did not open its sheet after a click (${o.stuck})`);
  if (o.midiOutValue !== '') findings.push(`#midiOutSelect is "${o.midiOutValue}", not empty: an output was picked, which this scenario never does`);
  if (REFUSED.some((re) => re.test(o.after))) findings.push(`after an Allow, Connect said: "${o.after}"`);
  if (findings.length) return { status: 'FAIL', text: `W5 found ${findings.length} problem(s): ${findings.join('; ')}`, findings };
  if (o.after === o.before) return { status: 'BLOCKED', text: `W5 the status line was unchanged ("${o.before}") after Connect and the deadline: Connect gave no outcome, or the permission prompt was never answered`, findings };
  if (DENIED.test(o.after)) {
    if (typeof o.direct === 'string' && o.direct.startsWith('ok')) return { status: 'FAIL', text: `W5 after an Allow the app said "no" ("${o.after}") but the same request made from the page succeeded (${o.direct})`, findings: ['the app reports a refusal the browser did not make'] };
    return { status: 'BLOCKED', text: `W5 the lane could not get Chrome to honour its Allow for MIDI (the same request from the page said: ${o.direct || 'not asked'}); the app reported the refusal in plain words, so this is the lane's limit, not a pass`, findings: [] };
  }
  const hit = ACCEPTED.find(([, re]) => re.test(o.after));
  if (!hit) return { status: 'FAIL', text: `W5 Connect said something the lane does not know: "${o.after}"`, findings: [`unrecognised status: ${o.after}`] };
  return { status: 'PASS', text: `Connect handled the outcome (${hit[0]}): "${o.after}"; MIDI permission answered with Allow by the lane; no MIDI sent; README check 2 is not covered`, findings };
}

export const verdict = w5Verdict;
