// W7, Windows lane: the extra notes a real kit sends for one strike, played through real Chrome's
// MIDI on the trainer screen and in a Songs drum step. W6 covers the walk-through.
//
// The strikes copy the real kit's reading (tests/fixtures/midi/kit-reading-usb-midi.json), on the
// drum channel: one note, the same note again softer about 30 ms later, and a loud hi-hat with a
// soft snare note right behind it. Each must count once. Notes go ONLY to the output port named
// exactly `band-coach-lane`; if it is absent the result is BLOCKED and no other port is tried.
//
// The release file has no debug hook, so this reads what a person can read: "Double hits ignored"
// in MIDI details and "Notes heard so far" in Songs. Whether a bar is judged clean, on the beat,
// is tested in tests/characterization/kit-double-hits.test.mjs and in the hand test.
export const id = 'W7';

export const LANE_PORT = 'band-coach-lane';
// The loopback output, by exact name only. Returns whether it was found; sends nothing else, ever.
// A gap of 0 sends in the same tick: a hi-hat's bleed lands within 10 ms and a timer could miss that.
const sendOnLane = (page, bytesList, gapMs) => page.evaluate(`(async () => {
  const access = (window.__laneMidi = window.__laneMidi || await navigator.requestMIDIAccess());
  let out = null; access.outputs.forEach((o) => { if (!out && o.name === ${JSON.stringify(LANE_PORT)}) out = o; });
  if (!out) return false;
  const list = ${JSON.stringify(bytesList)};
  for (let i = 0; i < list.length; i++) { if (i && ${gapMs}) await new Promise((r) => setTimeout(r, ${gapMs})); out.send(list[i]); }
  return true;
})()`);

const ON = 0x99;
const SNARE = 38;
const OPEN_HAT = 46;
const KICK = 36;
// Well past the guard's 70 ms, so one strike never runs into the next.
const BETWEEN_MS = 400;
export const STRIKES = {
  single: { list: [[ON, KICK, 100]], gapMs: 0 },
  repeated: { list: [[ON, SNARE, 110], [ON, SNARE, 45]], gapMs: 30 },
  bleeding: { list: [[ON, OPEN_HAT, 121], [ON, SNARE, 39]], gapMs: 0 },
};
const KINDS = Object.keys(STRIKES);

const settle = (page) => page.evaluate(`new Promise((r) => setTimeout(r, ${BETWEEN_MS}))`);
const ignored = (page) => page.evaluate("Number((document.getElementById('midiDetailsText').textContent.match(/Double hits ignored: (\\d+)/) || [0, 0])[1])");
const heard = (page) => page.evaluate("Number((document.querySelector('.panel-songs-count').textContent.match(/Notes heard so far: (\\d+)/) || [0, -1])[1])");
const button = (label) => `Array.from(document.querySelectorAll('.panel-songs-practice button')).find((b) => b.textContent === ${JSON.stringify(label)})`;
const heading = "(document.querySelector('.panel-songs-practice h4') || {}).textContent || ''";

// Plays each strike once and returns how much `read` moved for each. Undefined if the port is absent.
async function strikes(page, read) {
  const moved = {};
  for (const kind of KINDS) {
    const before = await read(page);
    const sent = await sendOnLane(page, STRIKES[kind].list, STRIKES[kind].gapMs);
    if (!sent) return undefined;
    await settle(page);
    moved[kind] = (await read(page)) - before;
  }
  return moved;
}

export async function run(page) {
  await page.grant(['midi', 'midi-sysex']);
  const o = { exceptions: [], laneOutput: undefined, stuck: undefined };
  try {
    await page.clickSelector('#picker button[data-mod="drum-kit"]');
    await page.clickSelector('#setupBtn');
    await page.waitFor("!document.getElementById('setupSheet').hidden", 10000);
    await page.clickSelector('#ioBtn');
    await page.waitFor("document.getElementById('ioBtn').hidden === true || document.getElementById('ioText').textContent.trim() !== ''", 30000);
    await page.evaluate('new Promise((r) => setTimeout(r, 1000))');
    await page.evaluate("document.getElementById('midiDetailsBtn').click()");
    await page.waitFor("!document.getElementById('midiDetails').hidden", 10000);
    o.trainer = await strikes(page, ignored);
    o.laneOutput = o.trainer !== undefined;
    if (o.laneOutput) {
      await page.evaluate("document.querySelector('button[data-route=\"songs\"]').click()");
      await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-row > button')).some((b) => b.textContent === 'Rock beat')", 15000);
      await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-row > button')).find((b) => b.textContent === 'Rock beat').click()");
      await page.waitFor(`!!${button('Next')}`, 10000);
      await page.evaluate(`${button('Next')}.click()`);
      await settle(page);
      if ((await page.evaluate(heading)).startsWith('Watch and listen')) await page.evaluate(`${button('Next')}.click()`);
      await page.waitFor(`!!${button('Your turn')}`, 10000);
      await page.evaluate(`${button('Your turn')}.click()`);
      await page.waitFor("(document.querySelector('.panel-songs-count') || {textContent: ''}).textContent.startsWith('Notes heard so far')", 15000);
      o.songs = await strikes(page, heard);
    }
  } catch (e) {
    o.stuck = e.message;
  }
  o.exceptions = [...page.exceptions];
  return o;
}

// Pure: an observation in, { status, text, findings } out.
export function w7Verdict(o) {
  const findings = [];
  for (const x of o.exceptions) findings.push(`uncaught exception: ${x}`);
  if (o.stuck) findings.push(`could not finish (${o.stuck})`);
  if (o.laneOutput === false) return { status: 'BLOCKED', text: `W7 there is no MIDI output port named exactly "${LANE_PORT}" on this machine, so nothing was sent; no other port was tried`, findings };
  if (!o.stuck) {
    if (!o.trainer) findings.push('the trainer screen gave no reading');
    if (!o.songs) findings.push('the Songs step gave no reading');
    const want = { trainer: { single: 0, repeated: 1, bleeding: 1 }, songs: { single: 1, repeated: 1, bleeding: 1 } };
    for (const kind of KINDS) {
      if (o.trainer && o.trainer[kind] !== want.trainer[kind]) findings.push(`trainer: a ${kind} strike moved "Double hits ignored" by ${o.trainer[kind]}, not ${want.trainer[kind]}`);
      if (o.songs && o.songs[kind] !== want.songs[kind]) findings.push(`Songs: a ${kind} strike was heard as ${o.songs[kind]} note(s), not 1`);
    }
  }
  if (findings.length) return { status: 'FAIL', text: `W7 found ${findings.length} problem(s): ${findings.join('; ')}`, findings };
  return { status: 'PASS', text: `on the trainer screen a single strike was kept and a repeat and a hi-hat bleed were ignored; in a Songs drum step each strike was heard as one note. Sent only on ${LANE_PORT}`, findings };
}

export const verdict = w7Verdict;
