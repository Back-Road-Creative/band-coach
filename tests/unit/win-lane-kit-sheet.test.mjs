// K2, the attended kit check: a person hits the pads when the terminal says so, and the lane fills
// in the hand-test sheet from the line the app shows. Pure parts only; the run itself needs Windows
// Chrome, and `--rehearse` drives it on the loopback port before a person's time is spent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attended, parseArgs, registry, selectScenarios } from '../acceptance/win/run.mjs';
import { describeHit } from '../../src/instruments/how/drum-kit.js';
import { KIT_SHEET_ROWS, k2Verdict, notRunRow, padPrompt, rowFromLines, sheetMarkdown, stepPrompt } from '../acceptance/win/k2-kit-sheet.win.mjs';

const line = (name) => `${name} heard -- start an exercise to see it judged.`;
const goodRows = () => KIT_SHEET_ROWS.map((r) => ({ ...r, ...rowFromLines(r.name, [line(r.name)], 1) }));
const goodKick = (over = {}) => ({ ...rowFromLines('Kick', Array(5).fill(line('Kick')), 5), rawHits: 5, peakVelocity: 127, ...over });
const obs = (over = {}) => ({ inputs: ['USB MIDI'], exceptions: [], savedBefore: 'Saved pad list: none', savedAfter: 'Saved pad list for USB MIDI: 36->kick', after: goodRows(), kick: goodKick(), ...over });

test('K2 runs only by name, so a full lane run never waits on a person', () => {
  assert.ok(attended.some((r) => r.id === 'K2'));
  assert.ok(!registry.some((r) => r.id === 'K2'));
  assert.equal(selectScenarios('K2').length, 1);
  assert.ok(!selectScenarios().some((r) => r.id === 'K2'));
});

test('--rehearse is a switch and defaults to off', () => {
  assert.equal(parseArgs([]).rehearse, undefined);
  assert.equal(parseArgs(['--rehearse']).rehearse, true);
});

test('the sheet rows follow the hand-test table, in its order and with its names', () => {
  const sheet = readFileSync(new URL('../../docs/hand-test.md', import.meta.url), 'utf8');
  const onSheet = [...sheet.matchAll(/^\| ([^|]+) \| \1 heard -- start an exercise to see it judged\. \|/gm)].map((m) => m[1]);
  assert.deepEqual(KIT_SHEET_ROWS.map((r) => r.name), onSheet);
  assert.equal(onSheet.length, 10);
});

test('a row passes when the one line names the piece hit', () => {
  assert.deepEqual(rowFromLines('Snare', [line('Snare')], 1), { heard: line('Snare'), pass: true, ran: true });
});

test('a learned line naming the right piece passes, and one naming a wrong piece fails', () => {
  const right = 'Snare heard (note 40, learned as Snare; General MIDI says Snare) -- start an exercise to see it judged.';
  assert.equal(rowFromLines('Snare', [right], 1).pass, true);
  const wrong = 'High tom heard (note 38, learned as High tom; General MIDI says Snare) -- start an exercise to see it judged.';
  const row = rowFromLines('Snare', [wrong], 1);
  assert.equal(row.pass, false);
  assert.equal(row.heard, wrong);
});

test('a name that only starts the same does not pass', () => {
  assert.equal(rowFromLines('Hi-hat closed', [line('Hi-hat open')], 1).pass, false);
});

test('one strike read as two pieces fails and shows both lines', () => {
  const row = rowFromLines('Kick', [line('Kick'), line('Snare')], 1);
  assert.equal(row.pass, false);
  assert.ok(row.heard.includes('Kick heard') && row.heard.includes('Snare heard'));
});

test('one strike counted twice fails, even when both lines name the piece', () => {
  assert.equal(rowFromLines('Kick', [line('Kick'), line('Kick')], 1).pass, false);
});

test('a hit that got no line fails: the kit sent a note and the app stayed quiet', () => {
  const row = rowFromLines('Kick', [line('Kick')], 2);
  assert.equal(row.pass, false);
  const silent = rowFromLines('Kick', [], 1);
  assert.equal(silent.pass, false);
  assert.equal(silent.ran, true);
  assert.match(silent.heard, /no line/);
});

test('a note outside the kit fails with the app\'s own words', () => {
  const said = 'MIDI note 39 is not one of the drums on this kit.';
  assert.deepEqual(rowFromLines('Snare', [said], 1), { heard: said, pass: false, ran: true });
});

test('nothing sent is not run, never a pass and never a blank cell', () => {
  assert.deepEqual(rowFromLines('Ride', [], 0), { heard: 'not run: nothing heard', pass: false, ran: false });
  assert.deepEqual(notRunRow('time ran out'), { heard: 'not run: time ran out', pass: false, ran: false });
});

test('the sheet has the hand-test columns, the expected line and a filled cell on every row', () => {
  const md = sheetMarkdown(obs());
  assert.ok(md.includes('| Pad | Expected heard line | Heard | Pass/Fail |'));
  assert.ok(md.includes(`| Kick | ${line('Kick')} | ${line('Kick')} | Pass |`));
  assert.ok(md.includes('| Saved pad list before (the list under "Hit each pad" on the set-up sheet, or "none") | Saved pad list: none |'));
  assert.ok(md.includes('| Saved pad list after a full "Hit each pad" | Saved pad list for USB MIDI: 36->kick |'));
});

test('the sheet says who filled it, and shows a failed and an unrun row as such', () => {
  const after = goodRows();
  after[1] = { ...after[1], ...rowFromLines('Snare', [line('High tom')], 1) };
  after[9] = { ...after[9], ...notRunRow('time ran out') };
  const md = sheetMarkdown(obs({ after }));
  assert.match(md, /filled by the lane \(K2\)/i);
  assert.ok(md.includes(`| Snare | ${line('Snare')} | ${line('High tom')} | Fail |`));
  assert.ok(md.includes(`| Ride | ${line('Ride')} | not run: time ran out | not run |`));
});

test('a rehearsal sheet says it was no kit, so it cannot be pasted as a kit result', () => {
  assert.match(sheetMarkdown(obs({ rehearse: true })), /rehearsal.*no kit/i);
});

test('a table character in a heard line cannot break the sheet', () => {
  const after = goodRows();
  after[0] = { ...after[0], heard: 'a | b', pass: false };
  assert.ok(sheetMarkdown(obs({ after })).includes('a \\| b'));
});

test('every row right and a full-force kick counted once is a PASS', () => {
  assert.equal(k2Verdict(obs()).status, 'PASS');
});

test('one wrong row fails and is named', () => {
  const after = goodRows();
  after[1] = { ...after[1], ...rowFromLines('Snare', [line('High tom')], 1) };
  const v = k2Verdict(obs({ after }));
  assert.equal(v.status, 'FAIL');
  assert.match(v.findings.join(' '), /Snare/);
});

test('a kick that reads as anything else fails', () => {
  const kick = { ...rowFromLines('Kick', [line('Kick'), line('Snare')], 1), rawHits: 1, peakVelocity: 127 };
  assert.equal(k2Verdict(obs({ kick })).status, 'FAIL');
});

test('a kick that never reached full force did not test the crosstalk rule, so it is not a PASS', () => {
  const v = k2Verdict(obs({ kick: goodKick({ peakVelocity: 110 }) }));
  assert.equal(v.status, 'OBSERVED');
  assert.match(v.text, /110/);
});

test('an unrun row or an unrun kick round is not a PASS', () => {
  const after = goodRows();
  after[9] = { ...after[9], ...notRunRow('time ran out') };
  assert.equal(k2Verdict(obs({ after })).status, 'OBSERVED');
  assert.equal(k2Verdict(obs({ kick: { ...notRunRow('time ran out') } })).status, 'OBSERVED');
});

test('a clean rehearsal is never a PASS, and a wrong rehearsal row still fails', () => {
  const v = k2Verdict(obs({ rehearse: true }));
  assert.equal(v.status, 'OBSERVED');
  assert.match(v.text, /rehearsal/i);
  const after = goodRows();
  after[0] = { ...after[0], ...rowFromLines('Kick', [line('Snare')], 1) };
  assert.equal(k2Verdict(obs({ rehearse: true, after })).status, 'FAIL');
});

test('no port, a silent kit and a stopped run are BLOCKED, each saying why', () => {
  assert.equal(k2Verdict(obs({ inputs: [] })).status, 'BLOCKED');
  const silent = k2Verdict(obs({ blocked: 'nothing heard on the first 3 pads' }));
  assert.equal(silent.status, 'BLOCKED');
  assert.match(silent.text, /first 3 pads/);
  const stopped = k2Verdict(obs({ stuck: 'no #kitLearn' }));
  assert.equal(stopped.status, 'BLOCKED');
  assert.match(stopped.text, /kitLearn/);
});

test('an uncaught exception fails even when every row is right', () => {
  assert.equal(k2Verdict(obs({ exceptions: ['boom'] })).status, 'FAIL');
});

test('every K2 prompt says where the pad sits, in the words the app itself uses', () => {
  for (const r of KIT_SHEET_ROWS) {
    const where = describeHit(r.id);
    assert.ok(where, r.id);
    assert.ok(padPrompt(r).endsWith(where), `${r.id}: ${padPrompt(r)}`);
    assert.ok(stepPrompt(r, 'Hit it.').endsWith(where), `${r.id}: ${stepPrompt(r, 'Hit it.')}`);
  }
  assert.match(padPrompt(KIT_SHEET_ROWS.find((r) => r.id === 'tom-floor')), /standing on its own legs/);
});
