// Partner Center runs the Windows App Certification Kit (WACK) on every
// submission, and store/README.md listed it as never run here. store-package
// now signs the .appx with a throwaway certificate whose subject is the
// manifest Publisher, installs-and-tests it with appcert.exe on the Windows
// runner, and fails the job before upload when the report says FAIL. These
// tests pin the report reader (store/scripts/wack-verdict.mjs) and the
// workflow wiring. The report shape follows appcert's XML output:
// <REPORT OVERALL_RESULT=...> holding <TEST NAME=... OPTIONAL=...> entries,
// each with a <RESULT> (CDATA-wrapped in real reports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wackVerdict } from '../../store/scripts/wack-verdict.mjs';

const workflow = readFileSync(
  new URL('../../.github/workflows/store-package.yml', import.meta.url),
  'utf8',
);

const report = (overall, tests) =>
  `<?xml version="1.0" encoding="utf-8"?>
<REPORT OVERALL_RESULT="${overall}" VERSION="10.0" TOOLSET_ARCHITECTURE="x64">
  <REQUIREMENTS>
    <REQUIREMENT NUMBER="1" TITLE="Package compliance">
${tests
  .map(
    ([name, result, optional = 'FALSE']) =>
      `      <TEST INDEX="1" NAME="${name}" DESCRIPTION="d" OPTIONAL="${optional}"><RESULT><![CDATA[${result}]]></RESULT><MESSAGES /></TEST>`,
  )
  .join('\n')}
    </REQUIREMENT>
  </REQUIREMENTS>
</REPORT>`;

test('an all-pass report passes', () => {
  const v = wackVerdict(report('PASS', [['App manifest', 'PASS'], ['Crashes and hangs', 'PASS']]));
  assert.equal(v.pass, true);
  assert.deepEqual(v.failures, []);
});

test('a FAIL report fails and names every failed required test', () => {
  const v = wackVerdict(
    report('FAIL', [['App manifest', 'PASS'], ['Crashes and hangs', 'FAIL'], ['Supported API', 'FAIL']]),
  );
  assert.equal(v.pass, false);
  assert.deepEqual(v.failures, ['Crashes and hangs', 'Supported API']);
});

test('a WARNING report (only optional tests failed) passes but lists the warnings', () => {
  const v = wackVerdict(report('WARNING', [['App manifest', 'PASS'], ['Blocked executables', 'FAIL', 'TRUE']]));
  assert.equal(v.pass, true);
  assert.deepEqual(v.warnings, ['Blocked executables']);
});

test('a report with no OVERALL_RESULT is not a pass', () => {
  assert.equal(wackVerdict('<REPORT></REPORT>').pass, false);
  assert.equal(wackVerdict('').pass, false);
});

test('store-package runs WACK on the signed appx after the launch check and before upload', () => {
  const launch = workflow.indexOf('--smoke-test');
  const wack = workflow.indexOf('run-wack.ps1');
  const upload = workflow.indexOf('actions/upload-artifact');
  assert.ok(wack > launch, 'WACK must run after the cheap launch check');
  assert.ok(wack < upload, 'WACK must run before the appx artifact is uploaded');
  assert.match(workflow, /wack-verdict\.mjs/, 'the job must fail on a FAIL report');
});

test('the WACK report is kept even when the job fails', () => {
  assert.match(workflow, /name: wack-report[\s\S]*?if: always\(\)|if: always\(\)[\s\S]*?name: wack-report/);
});
