// K1, Windows lane, attended: what a real drum kit sends for one hit. A person hits the pads;
// this listens, reads the messages and names which double-hit fix they point to.
//
// It listens on every input except the loopback `band-coach-lane`, through one MIDI connection of
// its own, and the app's Connect is never pressed, so a repeat in the log came from the kit or
// its driver and not from the app. It sends nothing to any port.
//
// Run only by name (`--only K1`, see `attended` in run.mjs), so a full lane run never waits on a
// person. Its result is OBSERVED or BLOCKED: it reports a reading and never passes anything.
export const id = 'K1';

export const LANE_PORT = 'band-coach-lane';
// Note-ons closer than this are one hit. The walk-through's own wait (LEARN_QUIET_MS, src/ui/kit-setup.js).
export const HIT_QUIET_MS = 250;
// Two snare hits are judged within this (src/instruments/drum-kit.js).
export const FLAM_MS = 40;
// "Clearly shorter than a flam": at or under half of it. The report carries every gap for a closer look.
const SHORT_GAP_MS = FLAM_MS / 2;
// Enough for each of ten pads twice, once hard and once soft.
export const TARGET_HITS = 20;
const ENOUGH_HITS = 6;
const DONE_QUIET_MS = 3000;
const GAVE_UP_QUIET_MS = 60000;
export const LISTEN_MS = 11 * 60 * 1000;
const POLL_MS = 500;

const FIX = {
  'one-note': 'One note per hit. No guard: the cause is elsewhere and the audit reopens',
  'short-window': 'The same note repeated, gap clearly shorter than a flam. Fix: a short fixed window for all MIDI',
  'loudness-rule': 'The same note repeated, gap in flam range. Fix: a loudness rule on kit parts, tested on this kit first',
  'several-notes': 'Different notes for one hit. A soft note a few ms after a loud one is one pad bleeding into another: add the pair to hatBleedsOnSnare (src/instruments/drum-kit.js). Otherwise a piece owns several notes',
};

// Pure: the logged messages in, the reading out.
export function readKit(log) {
  let ccCount = 0;
  const hits = [];
  let last = -Infinity;
  for (const m of [...log].sort((a, b) => a.t - b.t)) {
    const kind = m.data[0] & 0xf0;
    if (kind === 0xb0) ccCount++;
    if (kind !== 0x90 || !m.data[2]) continue;
    if (m.t - last >= HIT_QUIET_MS || !hits.length) hits.push({ keys: [], notes: [], velocities: [], gaps: [] });
    const hit = hits[hits.length - 1];
    if (hit.notes.length) hit.gaps.push(Math.round((m.t - last) * 10) / 10);
    hit.keys.push(`${m.port}/${m.data[0] & 0x0f}/${m.data[1]}`);
    hit.notes.push(m.data[1]);
    hit.velocities.push(m.data[2]);
    last = m.t;
  }
  const counts = { one: 0, same: 0, different: 0 };
  const repeatGaps = [];
  for (const hit of hits) {
    hit.kind = hit.keys.length === 1 ? 'one' : new Set(hit.keys).size === 1 ? 'same' : 'different';
    counts[hit.kind]++;
    if (hit.kind === 'same') repeatGaps.push(...hit.gaps);
    delete hit.keys;
  }
  const rows = [];
  if (counts.different) rows.push('several-notes');
  if (counts.same) rows.push(Math.max(...repeatGaps) <= SHORT_GAP_MS ? 'short-window' : 'loudness-rule');
  if (hits.length && !rows.length) rows.push('one-note');
  return { hits, counts, repeatGaps, ccCount, rows };
}

// Pure: the ports as Chrome reports them, state included, so a port that never opened is not read as no hits.
const portWords = (o) => (o.ports?.length ? o.ports.map((p) => `${p.name} (${p.state}, ${p.connection})`) : o.inputs).join(', ');

// Pure: is there enough to stop listening?
export function doneListening({ hits, sinceLastMs, elapsedMs }) {
  if (elapsedMs >= LISTEN_MS) return true;
  if (hits >= TARGET_HITS && sinceLastMs >= DONE_QUIET_MS) return true;
  return hits >= ENOUGH_HITS && sinceLastMs >= GAVE_UP_QUIET_MS;
}

const startListening = `(async () => {
  const log = (window.__kitLog = []);
  const inputs = (window.__kitInputs = []);
  const openErrors = (window.__kitOpenErrors = []);
  const access = await navigator.requestMIDIAccess();
  window.__kitPorts = () => [...access.inputs.values()].filter((i) => i.name !== ${JSON.stringify(LANE_PORT)}).map((i) => ({ name: i.name, state: i.state, connection: i.connection }));
  const listen = (input) => {
    if (input.name === ${JSON.stringify(LANE_PORT)} || inputs.includes(input.name)) return;
    inputs.push(input.name);
    input.onmidimessage = (e) => log.push({ port: input.name, t: e.timeStamp, data: [...e.data] });
    input.open().catch((e) => openErrors.push(input.name + ': ' + e.message));
  };
  access.inputs.forEach(listen);
  access.onstatechange = (e) => { if (e.port.type === 'input' && e.port.state === 'connected') listen(e.port); };
  const box = document.createElement('div');
  box.id = 'kitReadingBox';
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;background:#111;color:#fff;font:600 28px system-ui';
  document.body.appendChild(box);
})()`;

const show = (page, text) => page.evaluate(`document.getElementById('kitReadingBox').textContent = ${JSON.stringify(text)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(page) {
  await page.grant(['midi', 'midi-sysex']);
  const o = { inputs: [], openErrors: [], log: [] };
  try {
    await page.evaluate(startListening);
    const t0 = Date.now();
    let lastAt = t0;
    let seen = 0;
    for (;;) {
      o.log = await page.evaluate('window.__kitLog');
      o.ports = await page.evaluate('window.__kitPorts()');
      if (o.log.length !== seen) { seen = o.log.length; lastAt = Date.now(); }
      const hits = readKit(o.log).hits.length;
      await show(page, `Hit each pad once, about a second apart, then again harder or softer. Heard ${hits} of ${TARGET_HITS} hits. Listening on ${portWords({ ...o, inputs: [] })}.`);
      if (doneListening({ hits, sinceLastMs: Date.now() - lastAt, elapsedMs: Date.now() - t0 })) break;
      await sleep(POLL_MS);
    }
    o.inputs = await page.evaluate('window.__kitInputs');
    o.openErrors = await page.evaluate('window.__kitOpenErrors');
    await show(page, 'Done. You can close this window.');
  } catch (e) {
    o.stuck = e.message;
  }
  return o;
}

// Pure: an observation in, { status, text, findings } out.
export function k1Verdict(o) {
  const findings = [];
  if (o.stuck) return { status: 'BLOCKED', text: `K1 could not listen: ${o.stuck}`, findings };
  if (!o.inputs.length) return { status: 'BLOCKED', text: `K1 found no MIDI input other than ${LANE_PORT}, so there was nothing to listen to`, findings };
  const r = readKit(o.log);
  if (!r.hits.length) {
    const errors = o.openErrors.length ? ` Could not open: ${o.openErrors.join('; ')}.` : '';
    return { status: 'BLOCKED', text: `K1 heard no notes on ${portWords(o)}.${errors} Another program holding the port would look like this`, findings };
  }
  const gaps = r.repeatGaps.length ? ` (gaps ${Math.min(...r.repeatGaps)} to ${Math.max(...r.repeatGaps)} ms)` : '';
  const heard = `${r.hits.length} hit(s) on ${portWords(o)}: ${r.counts.one} one note, ${r.counts.same} same note repeated${gaps}, ${r.counts.different} different notes`;
  return { status: 'OBSERVED', text: `K1 heard ${heard}. ${r.rows.map((row) => FIX[row]).join('. ')}`, findings, reading: r };
}

export const verdict = k1Verdict;
