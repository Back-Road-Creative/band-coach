// G1, the guitar takes: a person plucks when the terminal says so, the lane records what the real mic
// delivers, then the app judges real plucks. Pure parts only; the run itself needs Windows Chrome, and
// `--rehearse` drives it on Chrome's fake mic before a person's time is spent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserArgs } from '../helpers/browser.mjs';
import { attended, copyTakes, parseArgs, registry, selectScenarios, stageFiles, takesFolderProblem } from '../acceptance/win/run.mjs';
import { LEAD_SEC, MIC_AUDIO, RATE, TAKES, askedWords, decodeFloats, g1Verdict, judgeTake, manifestEntry, promptRow, takeSec, toMono } from '../acceptance/win/g1-guitar-takes.win.mjs';

const take = (kind) => TAKES.find((t) => t.kind === kind);
const yes = { el: 'feedback', cls: 'ok', text: 'E (string 6): yes, in 1.2 s.' };
const wrong = { el: 'feedback', cls: 'no', text: 'That was A, the note is E. Go 5 frets lower.' };
const time = { el: 'feedback', cls: 'no', text: 'Time. It is on string 6, open. It is shown now: play it to move on.' };
const goodRow = promptRow('Play Low E', [yes]);
const obs = (over = {}) => ({ mic: 'USB mic', takes: TAKES.map((t) => ({ file: t.file, kept: true, peak: 0.2 })), rows: Array(8).fill(goodRow), exceptions: [], ...over });

test('G1 runs only by name on the real mic, so a full lane run never waits on a person', () => {
  const g1 = attended.find((r) => r.id === 'G1');
  assert.equal(g1.realMic, true);
  assert.ok(!registry.some((r) => r.id === 'G1'));
  assert.equal(selectScenarios('G1').length, 1);
  assert.ok(!selectScenarios().some((r) => r.id === 'G1'));
});

test('a real-mic launch drops only the fake device, and every other launch keeps it', () => {
  const fake = browserArgs('/p', [], { acceptance: true, headed: true, platform: 'win32' });
  const real = browserArgs('/p', [], { acceptance: true, headed: true, platform: 'win32', realMic: true });
  assert.ok(fake.includes('--use-fake-device-for-media-stream'));
  assert.deepEqual(real, fake.filter((a) => a !== '--use-fake-device-for-media-stream'));
});

test('G1 records with the constraints the app opens the mic with', () => {
  const app = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
  const [, base] = app.match(/const base = (\{ echoCancellation.*? \});/);
  assert.deepEqual(MIC_AUDIO, Function(`return ${base}`)());
});

test('the takes cover every open string, soft, loud, a repeat and a silent room, at a size fit for the repo', () => {
  assert.deepEqual([...new Set(TAKES.filter((t) => t.kind === 'normal').map((t) => t.midi))], [40, 45, 50, 55, 59, 64]);
  for (const kind of ['soft', 'loud', 'repeat', 'silence']) assert.ok(take(kind), kind);
  assert.equal(new Set(TAKES.map((t) => t.file)).size, TAKES.length);
  assert.equal(take('repeat').plucks, 2);
  assert.equal(take('silence').plucks, 0);
  const bytes = TAKES.reduce((sum, t) => sum + takeSec(t) * RATE * 2, 0);
  assert.ok(bytes < 5e6, `${bytes} bytes`);
  assert.ok(TAKES.every((t) => takeSec(t) > LEAD_SEC));
});

test('a take is redone when the pluck is missing, clipped or late, or the quiet take was not quiet', () => {
  const normal = take('normal');
  assert.equal(judgeTake(normal, { leadPeak: 0.001, bodyPeak: 0.2, roomPeak: 0.001 }), null);
  assert.match(judgeTake(normal, { leadPeak: 0.001, bodyPeak: 0.002, roomPeak: 0.001 }), /no pluck/);
  assert.match(judgeTake(normal, { leadPeak: 0.001, bodyPeak: 0.03, roomPeak: 0.01 }), /no pluck/, 'under four times the room is not a pluck');
  assert.match(judgeTake(normal, { leadPeak: 0.001, bodyPeak: 1, roomPeak: 0.001 }), /clipped/);
  assert.match(judgeTake(normal, { leadPeak: 0.1, bodyPeak: 0.2, roomPeak: 0.001 }), /before PLUCK NOW/);
  assert.equal(judgeTake(take('soft'), { leadPeak: 0.001, bodyPeak: 0.01, roomPeak: 0.001 }), null, 'a soft pluck stays a take');
  assert.equal(judgeTake(take('silence'), { leadPeak: 0.001, bodyPeak: 0.002, roomPeak: 0.001 }), null);
  assert.match(judgeTake(take('silence'), { leadPeak: 0.001, bodyPeak: 0.2, roomPeak: 0.001 }), /quiet/);
});

test('two channels become one the way the app does it: a dead channel is dropped, not averaged in', () => {
  const live = Float32Array.from([0.5, -0.5, 0.25]);
  const dead = new Float32Array(3);
  assert.deepEqual(toMono(live, dead), live);
  assert.deepEqual(toMono(dead, live), live);
  assert.deepEqual([...toMono(live, live)], [...live]);
  assert.deepEqual([...toMono(Float32Array.from([1, 1]), Float32Array.from([0.5, 0.5]))], [0.75, 0.75]);
});

test('samples read from the page survive the trip as base64', () => {
  const x = Float32Array.from([0.5, -0.25, 1]);
  assert.deepEqual(decodeFloats(Buffer.from(x.buffer).toString('base64')), x);
});

test('the manifest entry holds what the replay test reads', () => {
  const t = take('repeat');
  assert.deepEqual(manifestEntry(t, 0.3), { file: t.file, midi: t.midi, plucks: 2, kind: 'repeat', sec: takeSec(t), peak: 0.3 });
});

test('a note passes on exactly one yes; a wrong note, a second reply or no reply does not', () => {
  assert.equal(goodRow.pass, true);
  assert.equal(promptRow('p', [yes, time]).pass, true, 'running out of time is not a reply');
  assert.equal(promptRow('p', [wrong]).pass, false);
  assert.match(promptRow('p', [wrong]).heard, /That was A/);
  assert.equal(promptRow('p', [yes, yes]).pass, false);
  const none = promptRow('p', [time]);
  assert.equal(none.pass, false);
  assert.equal(none.judged, false);
});

test('the terminal relays the note and where it is, not the talk about a dot nobody can see', () => {
  assert.equal(askedWords('Play Low E', 'String 6, played open. The dot shows where. The mic checks the note.'), 'Play Low E: String 6, played open');
  assert.equal(askedWords('Play Low E', ''), 'Play Low E');
  assert.equal(askedWords('Play A', 'String 5, played open.'), 'Play A: String 5, played open');
});

test('the verdict: PASS needs real takes and every note right, and a rehearsal never passes', () => {
  assert.equal(g1Verdict(obs()).status, 'PASS');
  assert.equal(g1Verdict(obs({ blocked: 'NotAllowedError' })).status, 'BLOCKED');
  assert.equal(g1Verdict(obs({ stuck: 'no Listening' })).status, 'BLOCKED');
  assert.equal(g1Verdict(obs({ rehearse: true })).status, 'OBSERVED');
  const wrongRow = g1Verdict(obs({ rows: [goodRow, promptRow('Play A', [wrong])] }));
  assert.equal(wrongRow.status, 'FAIL');
  assert.match(wrongRow.text, /That was A/);
  assert.equal(g1Verdict(obs({ rows: [promptRow('Play A', [time])] })).status, 'FAIL', 'a mic that recorded fine and an app that judged nothing is the bug this looks for');
  assert.equal(g1Verdict(obs({ exceptions: ['boom'] })).status, 'FAIL');
  const lost = obs();
  lost.takes[2] = { file: lost.takes[2].file, kept: false, why: 'no pluck' };
  assert.equal(g1Verdict(lost).status, 'OBSERVED');
  assert.equal(g1Verdict(obs({ rows: [] })).status, 'OBSERVED');
});

test('--clips names the folder, and a folder that already holds takes is refused before anyone plays', () => {
  assert.equal(parseArgs(['--clips', '/mnt/d/takes']).clips, '/mnt/d/takes');
  const dir = mkdtempSync(join(tmpdir(), 'takes-'));
  assert.equal(takesFolderProblem(dir), null);
  assert.equal(takesFolderProblem(join(dir, 'not-yet')), null);
  writeFileSync(join(dir, 'manifest.json'), '[]');
  assert.match(takesFolderProblem(dir), /already holds takes/);
});

test('the takes are carried out of the run folder before it is removed', () => {
  const from = mkdtempSync(join(tmpdir(), 'run-'));
  const to = join(mkdtempSync(join(tmpdir(), 'out-')), 'takes');
  assert.equal(copyTakes(join(from, 'nothing-here'), to), 0);
  assert.equal(existsSync(to), false);
  writeFileSync(join(from, 'a.wav'), 'x');
  assert.equal(copyTakes(from, to), 1);
  assert.equal(readFileSync(join(to, 'a.wav'), 'utf8'), 'x');
});

test('the stage list carries what G1 imports', () => {
  const staged = stageFiles(['g1-guitar-takes.win.mjs']);
  assert.ok(staged.includes('tests/helpers/pluck-wav.mjs'));
  assert.ok(staged.includes('tests/fixtures/acceptance/live-capture-wav.mjs'));
});
