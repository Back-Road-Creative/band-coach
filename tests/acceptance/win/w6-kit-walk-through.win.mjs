// W6, Windows lane: the kit walk-through ("Hit each pad") driven by real MIDI notes
// on real Chrome, to see what one note and what a doubled note do to it.
//
// ONLY output port in play: the loopback named exactly `band-coach-lane`, reached through
// the page's own Web MIDI outputs. Nothing is ever sent to any other port (a real `USB MIDI`
// kit may be attached): the port is picked by exact name, and if it is absent the scenario
// says so by that name and does not pick another. The app listens to every input, so the
// loopback's input side is what it hears; no learned map is touched beyond this walk-through.
//
// Both cases are judged. One note (the control) must advance the walk-through exactly one pad.
// So must the same note twice, 15 ms apart: that used to skip a pad, and the walk-through's own
// quiet wait (LEARN_QUIET_MS, src/ui/kit-setup.js) is what stops it. The report carries what
// happened (pad before, pad after, pads advanced).
// W5 stays the scenario that sends no MIDI; this one sends only on band-coach-lane.
export const id = 'W6';

export const LANE_PORT = 'band-coach-lane';
// The walk-through order (the pieces #kitPreview lights, src/ui/kit-setup.js), to count pads advanced.
const PIECES = ['kick', 'snare', 'hihat-closed', 'hihat-pedal', 'hihat-open', 'tom-floor', 'tom-mid', 'tom-high', 'crash', 'ride'];
const lit = (page) => page.evaluate("(document.querySelector('#kitPreview .kit-sel') || {dataset: {}}).dataset.piece || null");
// The loopback output, by exact name only. Returns whether it was found; sends nothing else, ever.
const sendOnLane = (page, bytesList, gapMs) => page.evaluate(`(async () => {
  const access = (window.__laneMidi = window.__laneMidi || await navigator.requestMIDIAccess());
  let out = null; access.outputs.forEach((o) => { if (!out && o.name === ${JSON.stringify(LANE_PORT)}) out = o; });
  if (!out) return false;
  const list = ${JSON.stringify(bytesList)};
  for (let i = 0; i < list.length; i++) { if (i) await new Promise((r) => setTimeout(r, ${gapMs})); out.send(list[i]); }
  return true;
})()`);
const settle = (page) => page.evaluate('new Promise((r) => setTimeout(r, 400))');

export async function run(page) {
  await page.grant(['midi', 'midi-sysex']);
  const o = { exceptions: [], laneOutput: undefined, stuck: undefined, connectStatus: undefined };
  try {
    await page.clickSelector('#picker button[data-mod="drum-kit"]');
    await page.clickSelector('#setupBtn');
    await page.waitFor("!document.getElementById('setupSheet').hidden", 10000);
    await page.clickSelector('#ioBtn');
    await page.waitFor("document.getElementById('ioBtn').hidden === true || document.getElementById('ioText').textContent.trim() !== ''", 30000);
    await page.evaluate('new Promise((r) => setTimeout(r, 1000))');
    o.connectStatus = await page.evaluate("document.getElementById('ioText').textContent.trim()");
    await page.clickSelector('#kitLearn');
    await page.waitFor("!!document.querySelector('#kitPreview .kit-sel')", 10000);
  } catch (e) {
    o.stuck = e.message;
  }
  if (!o.stuck) {
    const first = await lit(page);
    // Control: one note.
    o.laneOutput = await sendOnLane(page, [[0x90, 60, 100], [0x80, 60, 0]], 20);
    if (o.laneOutput) {
      await settle(page);
      const afterOne = await lit(page);
      o.single = { before: first, after: afterOne, advanced: PIECES.indexOf(afterOne) - PIECES.indexOf(first) };
      // The same note twice, 15 ms apart.
      const beforeTwo = afterOne;
      await sendOnLane(page, [[0x90, 61, 100], [0x90, 61, 100], [0x80, 61, 0]], 15);
      await settle(page);
      const afterTwo = await lit(page);
      o.doubled = { before: beforeTwo, after: afterTwo, advanced: PIECES.indexOf(afterTwo) - PIECES.indexOf(beforeTwo), gapMs: 15 };
    }
  }
  o.exceptions = [...page.exceptions];
  return o;
}

// Pure: an observation in, { status, text, findings } out.
export function w6Verdict(o) {
  const findings = [];
  for (const x of o.exceptions) findings.push(`uncaught exception: ${x}`);
  if (o.stuck) findings.push(`could not reach the walk-through (${o.stuck})`);
  if (findings.length) return { status: 'FAIL', text: `W6 found ${findings.length} problem(s): ${findings.join('; ')}`, findings };
  if (o.laneOutput === false) return { status: 'BLOCKED', text: `W6 there is no MIDI output port named exactly "${LANE_PORT}" on this machine, so nothing was sent; no other port was tried`, findings };
  const s = o.single;
  if (!s || s.advanced !== 1) return { status: 'FAIL', text: `W6 one note on ${LANE_PORT} moved the walk-through from ${s && s.before} to ${s && s.after} (${s ? s.advanced : 'no'} pads), not one`, findings: ['a single note did not advance the walk-through exactly one pad'] };
  const d = o.doubled;
  if (!d || d.advanced !== 1) return { status: 'FAIL', text: `W6 the same note twice 15 ms apart on ${LANE_PORT} moved the walk-through from ${d && d.before} to ${d && d.after} (${d ? d.advanced : 'no'} pads), not one`, findings: ['a doubled note did not advance the walk-through exactly one pad'] };
  return { status: 'PASS', text: `one note advanced the walk-through one pad (${s.before} to ${s.after}), and the same note twice ${d.gapMs} ms apart also moved it one pad (${d.before} to ${d.after}). Sent only on ${LANE_PORT}`, findings };
}

export const verdict = w6Verdict;
