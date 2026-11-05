// G1, the guitar takes (attended, real mic). A person plucks when this terminal says so. Round 1 records
// labelled takes from the real mic, in the form Chromium's fake mic plays back, for
// tests/characterization/guitar-takes-replay.test.mjs. Round 2 has the app judge real plucks through its own
// screens, and the script decides the result from the line the app shows. `--rehearse` runs all of it on
// Chrome's fake mic, writes no manifest and is never a PASS. See docs/windows-lane.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEEDBACK_RECORDER } from '../../fixtures/acceptance/live-capture-wav.mjs';
import { writePluckWav } from '../../helpers/pluck-wav.mjs';

export const id = 'G1';
export const RATE = 24000;
// Silence first: the app's room measurement hears it on replay, as it does on a real connect.
export const LEAD_SEC = 3.5;
const RING_SEC = 3.5;
const REPEAT_SEC = 2.5;
const PROMPTS = 8;
const LISTEN_MS = 25000;
const REHEARSE_LISTEN_MS = 4000;
const AFTER_REPLY_MS = 3000;
const ATTEMPTS = 3;
// Under levels.js's quietest calibrated gate is not a pluck anyone could expect judged.
const MIN_PEAK = 0.005;
// src/app.js openMic `base`: the app's own mic settings, pinned by a unit test.
export const MIC_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };

const take = (file, midi, string, kind, plucks = 1) => ({ file: `${file}.wav`, midi, string, kind, plucks });
export const TAKES = [
  take('low-e', 40, 'Low E', 'normal'),
  take('a', 45, 'A', 'normal'),
  take('d', 50, 'D', 'normal'),
  take('g', 55, 'G', 'normal'),
  take('b', 59, 'B', 'normal'),
  take('high-e', 64, 'High E', 'normal'),
  take('a-soft', 45, 'A', 'soft'),
  take('b-soft', 59, 'B', 'soft'),
  take('low-e-loud', 40, 'Low E', 'loud'),
  take('g-twice', 55, 'G', 'repeat', 2),
  take('high-e-twice', 64, 'High E', 'repeat', 2),
  take('room', null, '', 'silence', 0),
];
const HOW = { normal: 'at your normal strength', soft: 'softly, as soft as you really play', loud: 'hard', repeat: 'at your normal strength, then once more when told' };

export const takeSec = (t) => LEAD_SEC + (t.plucks > 1 ? REPEAT_SEC * t.plucks : RING_SEC);
export const manifestEntry = (t, peak) => ({ file: t.file, midi: t.midi, plucks: t.plucks, kind: t.kind, sec: takeSec(t), peak });

// Pure: why this take must be done again, or null.
export function judgeTake(t, { leadPeak, bodyPeak, roomPeak }) {
  const floor = Math.max(MIN_PEAK, roomPeak * 4);
  if (t.plucks === 0) return bodyPeak >= floor ? 'that was meant to be quiet, and something sounded' : null;
  if (bodyPeak < floor) return `no pluck heard (peak ${bodyPeak.toFixed(4)}, room ${roomPeak.toFixed(4)})`;
  if (bodyPeak >= 0.999) return 'it clipped: play softer or turn the mic down';
  if (leadPeak >= bodyPeak * 0.25) return 'something sounded before PLUCK NOW: mute the strings and wait for it';
  return null;
}

const rms = (x) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / (x.length || 1));
// Pure: one channel from two by the app's rule (src/app.js monoSum, SILENT_RATIO), so a replay level is the one the app heard.
export function toMono(left, right) {
  const rL = rms(left), rR = rms(right);
  if (rL <= rR * 0.1) return right;
  if (rR <= rL * 0.1) return left;
  return left.map((v, i) => (v + right[i]) / 2);
}

export function decodeFloats(b64) {
  const bytes = Buffer.from(b64, 'base64');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

// Pure: what the terminal relays from the screen. The rest of the hint talks about a dot this person cannot see.
export const askedWords = (prompt, hint) => [prompt, hint.split('. ')[0].replace(/\.$/, '')].map((x) => x.trim()).filter(Boolean).join(': ');

const isReply = (r) => r.el === 'feedback' && (r.cls === 'ok' || r.cls === 'no') && !r.text.startsWith('Time.');

// Pure: one note of round 2 from the lines the app showed for it. Running out of time is not a reply.
export function promptRow(prompt, lines) {
  const replies = lines.filter(isReply);
  if (!replies.length) return { prompt, judged: false, pass: false, heard: 'the app judged nothing' };
  return { prompt, judged: true, pass: replies.length === 1 && replies[0].cls === 'ok', heard: replies.map((r) => r.text).join(' | ') };
}

export function g1Verdict(o) {
  if (o.stuck) return { status: 'BLOCKED', text: `G1 stopped: ${o.stuck}`, findings: [] };
  if (o.blocked) return { status: 'BLOCKED', text: `G1 could not record: ${o.blocked}`, findings: [] };
  if (o.rehearse) return { status: 'OBSERVED', text: `G1 rehearsal on the fake mic: ${o.takes.length} takes and ${o.rows.length} notes ran, no guitar was played`, findings: [] };
  const findings = [...(o.exceptions || []).map((x) => `uncaught exception: ${x}`), ...o.rows.filter((r) => !r.pass).map((r) => `${r.prompt}: ${r.heard}`)];
  if (findings.length) return { status: 'FAIL', text: `G1 found ${findings.length} problem(s): ${findings.join('; ')}. If you really played a wrong string, run it again.`, findings };
  const lost = o.takes.filter((t) => !t.kept).map((t) => t.file);
  if (lost.length || o.rows.length < PROMPTS) return { status: 'OBSERVED', text: `G1 saw no wrong reply, but did not cover: ${lost.concat(o.rows.length < PROMPTS ? `${PROMPTS - o.rows.length} notes of round 2` : []).join(', ')}`, findings };
  return { status: 'PASS', text: `G1: ${o.takes.length} takes recorded on ${o.mic}, and ${o.rows.length} of ${PROMPTS} notes got one right reply each`, findings };
}
export const verdict = g1Verdict;

function sheetMarkdown(o) {
  const cell = (s) => String(s).replaceAll('|', '/');
  return [
    `Mic: ${o.mic ?? 'none'}. Room peak: ${o.roomPeak ?? 'not read'}.${o.rehearse ? ' REHEARSAL: no guitar was played.' : ''}`,
    '',
    '| Take | Peak | Result |',
    '|---|---|---|',
    ...o.takes.map((t) => `| ${t.file} | ${t.peak ?? ''} | ${t.kept ? 'kept' : `left out: ${cell(t.why)}`} |`),
    '',
    '| Note asked for | Result | What the app said |',
    '|---|---|---|',
    ...o.rows.map((r) => `| ${cell(r.prompt)} | ${r.pass ? 'pass' : 'FAIL'} | ${cell(r.heard)} |`),
  ].join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The stream is the recorder's own, at the app's settings. The page has had a real click by now, so its context may start.
const recorderScript = `(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: ${JSON.stringify(MIC_AUDIO)} });
  const ac = new AudioContext({ sampleRate: ${RATE} });
  await ac.resume();
  const tap = ac.createScriptProcessor(4096, 2, 1);
  let left = [], right = [], on = false;
  tap.onaudioprocess = (e) => { if (on) { left.push(e.inputBuffer.getChannelData(0).slice()); right.push(e.inputBuffer.getChannelData(1).slice()); } };
  ac.createMediaStreamSource(stream).connect(tap);
  tap.connect(ac.destination);
  const b64 = (parts) => {
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    const bytes = new Uint8Array(all.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(s);
  };
  window.__takes = {
    start() { left = []; right = []; on = true; },
    stop() { on = false; return { left: b64(left), right: b64(right) }; },
    close() { on = false; stream.getTracks().forEach((t) => t.stop()); return ac.close(); },
  };
  return { label: stream.getAudioTracks()[0].label, rate: ac.sampleRate, state: ac.state };
})()`;

const peakOf = (x) => x.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
const round4 = (v) => Math.round(v * 10000) / 10000;

async function stopRecording(page) {
  const { left, right } = await page.evaluate('window.__takes.stop()');
  return toMono(decodeFloats(left), decodeFloats(right));
}

async function oneTake(page, t, say) {
  await page.evaluate('window.__takes.start()');
  if (t.plucks === 0) {
    say('Quiet now: touch nothing and say nothing.');
    await sleep(takeSec(t) * 1000);
  } else {
    await sleep(LEAD_SEC * 1000);
    for (let p = 0; p < t.plucks; p++) {
      say(p ? 'AGAIN, same string' : 'PLUCK NOW');
      await sleep((t.plucks > 1 ? REPEAT_SEC : RING_SEC) * 1000);
    }
  }
  // The round trip to the page starts late and stops late, so record over and cut to the exact length.
  await sleep(200);
  return (await stopRecording(page)).subarray(0, Math.round(takeSec(t) * RATE));
}

async function recordTakes(page, o, { say, rehearse, clipsDir }) {
  mkdirSync(clipsDir, { recursive: true });
  await page.evaluate('window.__takes.start()');
  await sleep(2000);
  const room = await stopRecording(page);
  o.roomPeak = round4(peakOf(room));
  if (o.roomPeak === 0 && !rehearse) throw Object.assign(new Error(`${o.mic} delivers pure silence: it is muted or Windows is keeping it from Chrome`), { blocked: true });
  say(`Mic: ${o.mic}. Room peak: ${o.roomPeak}. Round 1 of 2: ${TAKES.length} takes, about 3 minutes.`);
  const entries = [];
  for (const [i, t] of TAKES.entries()) {
    let why = 'not recorded', x, attempt = 0;
    while (why && attempt++ < ATTEMPTS) {
      if (t.plucks) say(`Take ${i + 1} of ${TAKES.length}: ${t.string} string, ${HOW[t.kind]}. Mute the strings and wait for PLUCK NOW.`);
      else say(`Take ${i + 1} of ${TAKES.length}: the room.`);
      await sleep(2500);
      x = await oneTake(page, t, say);
      const split = Math.round(LEAD_SEC * RATE);
      why = rehearse ? null : judgeTake(t, { leadPeak: peakOf(x.subarray(0, split)), bodyPeak: peakOf(x.subarray(split)), roomPeak: o.roomPeak });
      if (why) say(`Again: ${why}.`);
    }
    if (why) {
      o.takes.push({ file: t.file, kept: false, why });
      if (i === 2 && o.takes.every((k) => !k.kept)) throw Object.assign(new Error(`the first 3 takes all failed, the last with: ${why}`), { blocked: true });
      continue;
    }
    const peak = round4(peakOf(x));
    writePluckWav(join(clipsDir, t.file), x, RATE);
    o.takes.push({ file: t.file, kept: true, peak });
    entries.push(manifestEntry(t, peak));
  }
  // No manifest for a rehearsal's beeps, so they can never be committed as a guitar.
  if (!rehearse) writeFileSync(join(clipsDir, 'manifest.json'), JSON.stringify(entries, null, 2) + '\n');
}

async function judgeRealPlucks(page, o, { say, rehearse }) {
  const prompt = async () => askedWords(...(await page.evaluate("['prompt', 'hint'].map((id) => document.getElementById(id).textContent)")));
  const mark = () => page.evaluate('window.__bcLines.length');
  const since = (at) => page.evaluate(`window.__bcLines.slice(${at})`);
  await page.evaluate(FEEDBACK_RECORDER);
  say('Round 2 of 2: stay quiet while the app measures the room.');
  await page.clickSelector('#setupBtn');
  await page.waitFor("!document.getElementById('setupSheet').hidden", 10000);
  await page.clickSelector('#ioBtn');
  await page.waitFor("/Listening/.test(document.getElementById('ioText').textContent)", 30000);
  await page.clickSelector('#playBtn');
  await page.waitFor("!!document.querySelector('#prompt b')", 15000);
  for (let i = 0; i < PROMPTS; i++) {
    const asked = await prompt();
    say(`Note ${i + 1} of ${PROMPTS}: ${asked}. Play it once, then wait.`);
    const at = await mark();
    const until = Date.now() + (rehearse ? REHEARSE_LISTEN_MS : LISTEN_MS);
    while (Date.now() < until && !(await since(at)).some(isReply)) await sleep(100);
    await sleep(AFTER_REPLY_MS);
    o.rows.push(promptRow(asked, await since(at)));
    const last3 = o.rows.slice(-3);
    if (last3.length === 3 && last3.every((r) => !r.judged)) break;
  }
}

export async function run(page, ctx = {}) {
  const { say = () => {}, rehearse = false, clipsDir } = ctx;
  const o = { rehearse, takes: [], rows: [] };
  try {
    await page.grant(['microphone']);
    await page.clickSelector('#picker button[data-mod="gtr"]');
    const opened = await page.evaluate(recorderScript);
    o.mic = opened.label;
    o.captureRate = opened.rate;
    await recordTakes(page, o, { say, rehearse, clipsDir });
    await page.evaluate('window.__takes.close()');
    await judgeRealPlucks(page, o, { say, rehearse });
  } catch (e) {
    if (e.blocked || e.name === 'NotAllowedError' || /NotAllowedError|NotFoundError|Permission denied/.test(e.message)) o.blocked = e.message;
    else o.stuck = e.message;
  }
  o.exceptions = [...page.exceptions];
  o.sheetMd = sheetMarkdown(o);
  say(`\n${o.sheetMd}\n`);
  return o;
}
