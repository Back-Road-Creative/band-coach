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
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

function checklist() {
  const start = readme.indexOf('## Before announcing a release');
  assert.notEqual(start, -1, 'README must still carry the five-minute human check section');
  const rest = readme.slice(start + 1);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

test('the five-minute check covers pressing "Check for updates" in the downloaded file', () => {
  const section = checklist();
  assert.match(
    section,
    /Check for updates/,
    'the checklist must include a step that presses the "Check for updates" button -- it makes the only real network request in the app, and no automated test exercises it against the real deployment',
  );
});

test('that step says what a pass looks like and what a failure looks like', () => {
  const section = checklist();
  const start = section.indexOf('Check for updates');
  const step = section.slice(Math.max(0, start - 200), start + 900);
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
  const section = checklist();
  const steps = section.split(/\n(?=\d+\. \*\*)/).filter((s) => /^\d+\. \*\*/.test(s));
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
