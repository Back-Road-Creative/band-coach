// The five-minute human check in README.md is the last gate before a release
// is announced, and it is the ONLY gate for anything the headless suite cannot
// reach: a real MIDI port, a real microphone, a real decaying string.
//
// "Check for updates" belongs in that set. The button makes one real network
// request to the deployed version.json, from a file:// page, and compares the
// answer to the version baked into that file. Nothing in the automated suite
// exercises that combination: the unit tests inject a fake fetch, and the
// browser tests run against a dev build whose version is deliberately blank,
// which the button itself treats as "not a release, don't ask". So the first
// time the real request is ever made against the real deployment is when a
// person presses the button in the downloaded file -- and if it is broken,
// every future downloaded copy silently stops being able to tell it is stale,
// which is the entire reason the button exists.
//
// It shipped in #44 and the checklist was not updated with it. This test is
// why that cannot happen quietly a second time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

function checklist() {
  const start = readme.indexOf('## Before announcing a release');
  assert.notEqual(start, -1, 'README must still carry the five-minute human check section');
  const rest = readme.slice(start + 1);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

// A step runs from its number to the next step's number; the last one stops
// at the Total paragraph, so a step may hold blank lines of its own.
const STEP_HEAD = /^\d+\. \*\*/;
function stepsOf(section) {
  return section
    .split(/\n(?=\d+\. \*\*)/)
    .filter((s) => STEP_HEAD.test(s))
    .map((s) => s.split(/\n\n(?=Total\b)/)[0]);
}

test('the five-minute check covers pressing "Check for updates" in the downloaded file', () => {
  const section = checklist();
  assert.match(
    section,
    /Check for updates/,
    'the checklist must include a step that presses the "Check for updates" button -- it is one of the app\'s two features that go online (the other is the model-pack download), and no automated test exercises it against the real deployment',
  );
});

test('that step says what a pass looks like and what a failure looks like', () => {
  const step = stepsOf(checklist()).find((s) => /^\d+\. \*\*[^*]*Check for updates/.test(s));
  assert.ok(step, 'the checklist must have a numbered step whose title names "Check for updates"');
  assert.match(
    step,
    /\*\*Pass\*\*/,
    'the update step must name what a pass looks like, like every other step -- "nothing looked wrong" is not a result',
  );
  assert.match(
    step,
    /\*\*Fail\*\*/,
    'the update step must name what failure looks like, so a silent network error is not read as a pass',
  );
});

test('every step in the checklist names a failure, not just the update one', () => {
  const steps = stepsOf(checklist());
  assert.ok(steps.length >= 5, `expected the checklist to still have its numbered steps, found ${steps.length}`);
  for (const step of steps) {
    const name = step.slice(0, step.indexOf('.', step.indexOf('**') + 2));
    assert.match(
      step,
      /\*\*Fail\*\*/,
      `checklist step "${name.trim()}" does not say what failure looks like; the section's own preamble promises every step does`,
    );
  }
});

// The step estimates and the Total line make one claim twice: the Total tells
// whoever is about to run the check how long to set aside, and the steps are
// where that time goes. When a step is added or re-timed and the Total is not,
// the check quietly takes longer than it says: the Total read "under 5 minutes"
// over steps that added up to 5.5 when this test was written. So the Total's
// first number must be the sum of the step estimates, to within 3 seconds
// (sums are kept in whole seconds, and a Total may round to a tenth of a
// minute). When some steps are covered by a passing Windows-lane run, the
// Total's second number must be what is left to do by hand, the steps named
// after it and in the lane paragraph must be exactly the lane-covered ones, and
// the lane's own doc must exist. With no lane-covered step, the section must
// not talk about the lane at all.
const STEP_TIME = /^\d+\. \*\*[^*]*\((\d+(?:\.\d+)?) ?(s|min)\)\.\*\*/;
const LANE_TAG = /Windows-lane\s+run/;
const SLACK_S = 3;

function secondsOf(step) {
  const m = STEP_TIME.exec(step);
  assert.ok(m, `checklist step "${step.slice(0, 60)}" must give its time as "(30s)" or "(2 min)" before its closing "**"`);
  return Math.round(m[2] === 's' ? Number(m[1]) : Number(m[1]) * 60);
}

const numbersIn = (text) => [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
const minutes = (s) => Math.round((s / 60) * 100) / 100;

function totalLine(section) {
  let last = -1;
  for (const m of section.matchAll(/\n\d+\. \*\*/g)) last = m.index;
  const after = section.slice(Math.max(0, last));
  const at = after.search(/^Total\b/m);
  assert.notEqual(at, -1, 'the checklist must still end with a Total line after its last step');
  return after.slice(at).split('\n\n')[0];
}

test('the Total line adds up the step estimates', () => {
  const section = checklist();
  const steps = stepsOf(section);
  const all = steps.reduce((sum, s) => sum + secondsOf(s), 0);
  const numbers = numbersIn(totalLine(section));
  assert.ok(
    numbers.length > 0 && Math.abs(Math.round(numbers[0] * 60) - all) <= SLACK_S,
    `the Total says ${numbers[0]} minutes, but the step estimates add up to ${minutes(all)}`,
  );
  const lane = steps.filter((s) => LANE_TAG.test(s)).map((s) => Number(s.slice(0, s.indexOf('.'))));
  if (lane.length === 0) {
    assert.ok(
      !/Windows lane/.test(section) && numbers.length === 1,
      'the checklist talks about the Windows lane, or its Total names more than one number, but no step is marked as covered by a Windows-lane run',
    );
    return;
  }
  const byHand = steps.filter((s) => !LANE_TAG.test(s)).reduce((sum, s) => sum + secondsOf(s), 0);
  assert.ok(
    numbers.length > 1 && Math.abs(Math.round(numbers[1] * 60) - byHand) <= SLACK_S,
    `the Total says ${numbers[1]} minutes by hand, but the steps a Windows-lane run does not cover add up to ${minutes(byHand)}`,
  );
  assert.deepEqual(numbers.slice(2), lane, 'the Total must name exactly the steps a passing Windows-lane run covers');
  const intro = /Steps ([\d, and]+) are also run by the Windows lane/.exec(section);
  assert.ok(intro, 'the checklist must say up front which steps the Windows lane runs');
  assert.deepEqual(numbersIn(intro[1]), lane, 'the lane paragraph must name exactly the steps marked as covered by a Windows-lane run');
  assert.ok(
    existsSync(new URL('../../docs/windows-lane.md', import.meta.url)),
    'the checklist lets a Windows-lane run stand in for steps, so docs/windows-lane.md must exist to say how to run it',
  );
});
