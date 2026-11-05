// K2, Windows lane, attended: the hand-test kit sheet, filled in by the lane. A person hits each pad
// when the terminal says so; the app on the release file does everything else, and the sheet is
// copied from the line the app itself shows (#coach), never typed by anyone.
//
// Four rounds: every pad on the app's first-run layout, the app's own "Hit each pad" walk-through,
// every pad again (these rows are the sheet), then the kick played as hard as it goes. Run only by
// name (`--only K2`, see `attended` in run.mjs).
//
// Fresh Chrome profile, so it never sees the pad list saved in a person's own Chrome.
//
// --rehearse sends each hit on the loopback `band-coach-lane` instead, by exact name only, so an
// agent can run all of it on real Chrome before a person's time is spent. No rehearsal is ever a
// PASS: it proves the check works, and nothing about a kit.
import { en } from '../../../src/core/i18n.js';
import { PIECES } from '../../../src/instruments/drum-kit.js';
import { LANE_PORT, LISTEN_MS, listenerScript, padLine, readKit, savedPadsRead, savedPadText } from './k1-kit-reading.win.mjs';
import { sendOnLane } from './w6-kit-walk-through.win.mjs';
import { STRIKES } from './w7-kit-double-hits.win.mjs';

export const id = 'K2';

// The rows of docs/hand-test.md section 2, which is also the walk-through's order.
export const KIT_SHEET_ROWS = PIECES.map((p) => ({ id: p.id, name: p.name, note: p.midi[0] }));

const KICK_HITS = 5;
const FULL_FORCE = 127;
// How long a prompt waits for a person, and for a walk-through step before it is skipped.
const PAD_WAIT_MS = 25000;
const STEP_WAIT_MS = 40000;
// Silence on this many pads in a row, from the very first, means the kit is not reaching Chrome.
const SILENT_PADS = 3;
// After the first line, time for anything else one hit sets off, before the next prompt.
const SETTLE_MS = 500;
const NO_LINE_SETTLE_MS = 1500;
const POLL_MS = 100;
// Past the walk-through's 250 ms quiet wait, so a rehearsed hit is never ignored as a repeat.
const REHEARSE_GAP_MS = 400;

const expectedLine = (name) => `${name} heard -- start an exercise to see it judged.`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pure: the lines one prompt set off and the hits the kit sent, in; a sheet row out. A row passes
// only when each hit got one line and every line names the piece: a wrong name, one strike read
// twice, and a hit the app stayed quiet about all fail.
export function rowFromLines(name, lines, rawHits) {
  if (!lines.length && !rawHits) return notRunRow('nothing heard');
  if (!lines.length) return { heard: 'no line from the app, though the kit sent a note', pass: false, ran: true };
  const named = lines.every((l) => l.startsWith(`${name} heard`));
  return { heard: lines.join(' / '), pass: named && lines.length === Math.max(1, rawHits), ran: true };
}

export const notRunRow = (why) => ({ heard: `not run: ${why}`, pass: false, ran: false });

const cell = (text) => String(text).replace(/\|/g, '\\|');
const passWord = (r) => (!r.ran ? 'not run' : r.pass ? 'Pass' : 'Fail');
const tableRows = (rows) => KIT_SHEET_ROWS.map((r) => {
  const row = (rows || []).find((x) => x.id === r.id) || notRunRow('stopped before this pad');
  return `| ${r.name} | ${expectedLine(r.name)} | ${cell(row.heard)} | ${passWord(row)} |`;
});
const TABLE_HEAD = ['| Pad | Expected heard line | Heard | Pass/Fail |', '|---|---|---|---|'];

// Pure: the sheet, the same shape as docs/hand-test.md section 2.
export function sheetMarkdown(o) {
  const kick = o.kick || notRunRow('stopped before this round');
  const who = o.rehearse
    ? `REHEARSAL on ${LANE_PORT}, no kit: this says the check works, and nothing about a kit.`
    : 'Filled by the lane (K2) from the line the app shows; hits by a person.';
  return [
    who,
    '',
    '| Row | Value |',
    '|---|---|',
    `| Saved pad list before (the list under "Hit each pad" on the set-up sheet, or "none") | ${cell(o.savedBefore ?? 'not run')} |`,
    `| Saved pad list after a full "Hit each pad" | ${cell(o.savedAfter ?? 'not run')} |`,
    '',
    ...TABLE_HEAD,
    ...tableRows(o.after),
    '',
    `Kick, hit as hard as it goes: ${passWord(kick)}. ${kick.ran ? `${kick.rawHits} hits, loudest ${kick.peakVelocity}. ` : ''}Heard: ${cell(kick.heard)}.`,
    `Double hits ignored: ${o.doubleHitsIgnored ?? 'not read'}.`,
    '',
    'Before "Hit each pad", on the layout the app starts with (a wrong name here is what the walk-through is for):',
    '',
    ...TABLE_HEAD,
    ...tableRows(o.before),
  ].join('\n');
}

// Pure: an observation in, { status, text, findings } out.
export function k2Verdict(o) {
  const findings = [];
  if (o.stuck) return { status: 'BLOCKED', text: `K2 stopped: ${o.stuck}`, findings };
  if (o.blocked) return { status: 'BLOCKED', text: `K2 could not check the kit: ${o.blocked}`, findings };
  if (!o.inputs?.length) return { status: 'BLOCKED', text: `K2 found no MIDI input other than ${LANE_PORT}, so there was no kit to check`, findings };
  for (const x of o.exceptions || []) findings.push(`uncaught exception: ${x}`);
  const rows = KIT_SHEET_ROWS.map((r) => ({ ...r, ...notRunRow('stopped before this pad'), ...(o.after || []).find((x) => x.id === r.id) }));
  for (const r of rows) if (r.ran && !r.pass) findings.push(`${r.name}: ${r.heard}`);
  const kick = o.kick || notRunRow('stopped before this round');
  if (kick.ran && !kick.pass) findings.push(`hard kick: ${kick.heard}`);
  if (findings.length) return { status: 'FAIL', text: `K2 found ${findings.length} problem(s): ${findings.join('; ')}`, findings };
  const gaps = rows.filter((r) => !r.ran).map((r) => `${r.name} (${r.heard})`);
  if (!kick.ran) gaps.push(`hard kick (${kick.heard})`);
  else if (kick.peakVelocity < FULL_FORCE) gaps.push(`the kick peaked at ${kick.peakVelocity}, under ${FULL_FORCE}, so the crosstalk rule was not tested`);
  if (gaps.length) return { status: 'OBSERVED', text: `K2 saw no wrong pad, but did not cover: ${gaps.join('; ')}`, findings };
  if (o.rehearse) return { status: 'OBSERVED', text: `K2 rehearsal on ${LANE_PORT}: every pad and the hard kick read right. This is no kit result`, findings };
  return { status: 'PASS', text: `every pad named itself and ${kick.rawHits} full-force kicks read as ${kick.rawHits} kicks. ${o.savedAfter}`, findings };
}

export const verdict = k2Verdict;

const heardLineLog = `(() => {
  const lines = (window.__kitLines = []);
  const box = document.getElementById('coach');
  new MutationObserver(() => {
    const text = box.textContent;
    if (text.includes(' heard') || text.includes('is not one of the drums')) lines.push(text);
  }).observe(box, { childList: true, characterData: true, subtree: true });
})()`;

// Both logs in one read, so a line and the note behind it can never fall either side of a row.
const since = (page, mark) => page.evaluate(`({ lines: window.__kitLines.slice(${mark.lines}), log: window.__kitLog.slice(${mark.log}) })`);
const markNow = (page) => page.evaluate('({ lines: window.__kitLines.length, log: window.__kitLog.length })');
const clickById = (page, elementId) => page.evaluate(`document.getElementById(${JSON.stringify(elementId)}).click()`);
const stepText = (page) => page.evaluate("({ status: document.getElementById('kitLearnStatus').textContent, note: document.getElementById('kitLearnStep').textContent })");

const padAction = (r) => {
  if (r.id === 'hihat-pedal') return 'press the Hi-hat pedal once';
  if (r.id === 'hihat-closed') return 'hit the Hi-hat closed once, with the pedal held down';
  if (r.id === 'hihat-open') return 'hit the Hi-hat open once, with the pedal up';
  return `hit the ${r.name} once`;
};
// Every prompt ends by saying where the pad sits: a person at the kit has only the terminal to go on.
// The app's describeHit() words for a fresh profile, read from the table already staged; the unit test holds them equal.
const padPlace = (r) => en[`kit.desc.${r.id}`].replace(/\{left\}/g, en['kit.side.left']).replace(/\{right\}/g, en['kit.side.right']);
export const padPrompt = (r) => `${padAction(r)}. ${padPlace(r)}`;
export const stepPrompt = (r, asked) => `${asked} ${padPlace(r)}`;

// One prompt, one sheet row.
async function padRow(page, env, r, where) {
  if (env.left() < 1000) return { id: r.id, name: r.name, ...notRunRow('time ran out') };
  const mark = await markNow(page);
  env.say(`${where}: ${padPrompt(r)}`);
  if (env.rehearse) await env.send([[0x99, r.note, 100]], 0);
  const deadline = Date.now() + Math.min(PAD_WAIT_MS, env.left());
  let seen = await since(page, mark);
  while (Date.now() < deadline && !seen.lines.length && !readKit(seen.log).hits.length) {
    await sleep(POLL_MS);
    seen = await since(page, mark);
  }
  if (seen.lines.length || readKit(seen.log).hits.length) await sleep(seen.lines.length ? SETTLE_MS : NO_LINE_SETTLE_MS);
  seen = await since(page, mark);
  const hits = readKit(seen.log).hits;
  const row = rowFromLines(r.name, seen.lines, hits.length);
  env.say(`  ${passWord(row)}: ${row.heard}`);
  return { id: r.id, name: r.name, ...row, lines: seen.lines, sent: hits };
}

async function padRound(page, env, round) {
  const rows = [];
  for (const [i, r] of KIT_SHEET_ROWS.entries()) {
    rows.push(await padRow(page, env, r, `${round}, pad ${i + 1} of ${KIT_SHEET_ROWS.length}`));
    if (rows.length === SILENT_PADS && rows.every((x) => !x.ran)) throw Object.assign(new Error(`nothing heard on the first ${SILENT_PADS} pads. Is the kit on, and is every other copy of Band Coach closed? Another program holding the port would look like this`), { blocked: true });
  }
  return rows;
}

// The app's own walk-through, shown in the app's own words.
async function walkThrough(page, env, round) {
  const steps = [];
  await page.clickSelector('#kitLearn');
  await page.waitFor("!!document.querySelector('#kitPreview .kit-sel')", 10000);
  for (const [i, r] of KIT_SHEET_ROWS.entries()) {
    const asked = en[r.id === 'hihat-pedal' ? 'kit.learnPromptPress' : 'kit.learnPrompt'].replace('{piece}', r.name);
    const { status, note } = await stepText(page);
    if (!status.startsWith(asked)) throw new Error(`the walk-through shows "${status}" where it should ask "${asked}"`);
    env.say(`${round}, pad ${i + 1} of ${KIT_SHEET_ROWS.length}: ${stepPrompt(r, `${asked}${note ? ` ${note}` : ''}`)}`);
    if (env.rehearse) await env.send([[0x99, r.note, 100]], 0);
    const deadline = Date.now() + Math.min(STEP_WAIT_MS, env.left());
    let shown = status;
    let moved = false;
    while (Date.now() < deadline) {
      const now = (await stepText(page)).status;
      if (!now.startsWith(asked)) { moved = true; break; }
      if (now !== shown) { shown = now; env.say(`  ${now}`); }
      await sleep(POLL_MS);
    }
    if (!moved) await clickById(page, r.id === 'hihat-pedal' ? 'kitLearnNoSend' : 'kitLearnSkip');
    steps.push({ id: r.id, outcome: moved ? 'taught' : 'skipped: nothing heard in time', shown });
    env.say(`  ${moved ? 'OK' : 'Nothing heard, skipped'}`);
  }
  await sleep(REHEARSE_GAP_MS);
  return { steps, status: (await stepText(page)).status };
}

async function hardKick(page, env, round) {
  const r = KIT_SHEET_ROWS[0];
  if (env.left() < 1000) return notRunRow('time ran out');
  const mark = await markNow(page);
  env.say(`${round}: hit the Kick as hard as you can, ${KICK_HITS} times, about a second apart`);
  if (env.rehearse) for (let i = 0; i < KICK_HITS; i++) await env.send(STRIKES.crosstalk.list, STRIKES.crosstalk.gapMs);
  const deadline = Date.now() + Math.min(STEP_WAIT_MS, env.left());
  let seen = await since(page, mark);
  while (Date.now() < deadline && readKit(seen.log).hits.length < KICK_HITS) {
    await sleep(POLL_MS);
    seen = await since(page, mark);
  }
  await sleep(NO_LINE_SETTLE_MS);
  seen = await since(page, mark);
  const reading = readKit(seen.log, r.id);
  const row = rowFromLines(r.name, seen.lines, reading.hits.length);
  if (!row.ran) return row;
  const peakVelocity = Math.max(...reading.hits.map((h) => h.velocities[0] ?? 0));
  env.say(`  ${passWord(row)}: ${seen.lines.length} line(s) from ${reading.hits.length} hit(s), loudest ${peakVelocity}. ${padLine(reading.pad)}`);
  return { ...row, rawHits: reading.hits.length, peakVelocity, lines: seen.lines, sent: reading.hits, padLine: padLine(reading.pad) };
}

export async function run(page, ctx = {}) {
  const say = ctx.say || (() => {});
  const t0 = Date.now();
  const rehearse = Boolean(ctx.rehearse);
  const o = { rehearse, inputs: [], openErrors: [], exceptions: [], log: [] };
  const env = {
    say,
    rehearse,
    left: () => LISTEN_MS - (Date.now() - t0),
    send: async (list, gapMs) => {
      await sleep(REHEARSE_GAP_MS);
      if (!(await sendOnLane(page, list, gapMs))) throw Object.assign(new Error(`there is no MIDI output port named exactly "${LANE_PORT}", so nothing was sent; no other port was tried`), { blocked: true });
    },
  };
  await page.grant(['midi', 'midi-sysex']);
  try {
    await page.evaluate(listenerScript({ includeLane: rehearse }));
    await page.clickSelector('#picker button[data-mod="drum-kit"]');
    await page.clickSelector('#setupBtn');
    await page.waitFor("!document.getElementById('setupSheet').hidden", 10000);
    await page.clickSelector('#ioBtn');
    await page.waitFor("document.getElementById('ioBtn').hidden === true || document.getElementById('ioText').textContent.trim() !== ''", 30000);
    await sleep(1000);
    o.connectStatus = await page.evaluate("document.getElementById('ioText').textContent.trim()");
    o.inputs = await page.evaluate('window.__kitInputs');
    o.ports = await page.evaluate('window.__kitPorts()');
    await page.evaluate(heardLineLog);
    o.savedBefore = savedPadText(await page.evaluate(savedPadsRead));
    if (o.inputs.length) {
      say(rehearse ? `REHEARSAL on ${LANE_PORT}: no one needs to hit anything.` : `Kit check on ${o.inputs.join(', ')}. About 3 minutes. Hit only when this terminal says to, one hit each.`);
      o.before = await padRound(page, env, 'Round 1 of 4');
      o.walk = await walkThrough(page, env, 'Round 2 of 4, teaching the app');
      o.savedAfter = savedPadText(await page.evaluate(savedPadsRead));
      o.after = await padRound(page, env, 'Round 3 of 4');
      o.kick = await hardKick(page, env, 'Round 4 of 4');
      await clickById(page, 'midiDetailsBtn');
      await page.waitFor("!document.getElementById('midiDetails').hidden", 10000);
      o.doubleHitsIgnored = await page.evaluate("Number((document.getElementById('midiDetailsText').textContent.match(/Double hits ignored: (\\d+)/) || [0, 0])[1])");
    }
  } catch (e) {
    if (e.blocked) o.blocked = e.message;
    else o.stuck = e.message;
  }
  try {
    o.log = await page.evaluate('window.__kitLog');
    o.openErrors = await page.evaluate('window.__kitOpenErrors');
  } catch (e) {
    o.stuck = o.stuck || e.message;
  }
  o.exceptions = [...page.exceptions];
  o.sheetMd = sheetMarkdown(o);
  say(`\n${o.sheetMd}\n`);
  return o;
}
