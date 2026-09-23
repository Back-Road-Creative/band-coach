// v1.3.0-v1.6.0 shipped an .appx that died at launch on every device: the
// Store's certification run was the first time the packaged app was ever
// started (store/README.md, "What was NOT verified here"). store-package.yml
// built and manifest-checked the package but never ran it. These tests pin
// the launch check that now runs the packaged exe on the Windows runner
// before the artifact is uploaded: main.js exits with a verdict when started
// with --smoke-test, and the workflow fails when the exe does not exit 0 in
// time (a main-process crash leaves an error dialog open, so "still
// running" is a failure, not a pass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SMOKE_FLAG, smokeExitCode } = require('../../store/lib/smoke.js');
const mainJs = readFileSync(new URL('../../store/main.js', import.meta.url), 'utf8');
const workflow = readFileSync(
  new URL('../../.github/workflows/store-package.yml', import.meta.url),
  'utf8',
);

test('a page that loaded with no errors passes', () => {
  assert.equal(smokeExitCode({ loaded: true, pageErrors: [] }), 0);
});

test('a page that never loaded fails', () => {
  assert.notEqual(smokeExitCode({ loaded: false, pageErrors: [] }), 0);
});

test('a failed load fails even if a later load finished', () => {
  assert.notEqual(smokeExitCode({ loaded: true, failedLoad: 'ERR_FILE_NOT_FOUND', pageErrors: [] }), 0);
});

test('a renderer crash fails', () => {
  assert.notEqual(smokeExitCode({ loaded: true, rendererGone: 'crashed', pageErrors: [] }), 0);
});

test('an uncaught page error fails', () => {
  assert.notEqual(smokeExitCode({ loaded: true, pageErrors: ['TypeError: x is undefined'] }), 0);
});

test('main.js only runs the smoke check when given the flag', () => {
  assert.equal(SMOKE_FLAG, '--smoke-test');
  assert.match(mainJs, /require\('\.\/lib\/smoke\.js'\)/);
  assert.match(mainJs, /process\.argv\.includes\(SMOKE_FLAG\)/);
  assert.match(mainJs, /app\.exit\(smokeExitCode\(/);
});

test('store-package launches the packaged exe with the flag before uploading', () => {
  const launch = workflow.indexOf('--smoke-test');
  const upload = workflow.indexOf('actions/upload-artifact');
  const pack = workflow.indexOf('npm run dist:appx:submission');
  assert.ok(launch > pack, 'the launch check must run after packaging');
  assert.ok(launch < upload, 'the launch check must run before the artifact is uploaded');
  assert.match(workflow, /win-unpacked/, 'it must launch the packaged app, not the source main.js');
  assert.match(workflow, /WaitForExit\(\d+\)/, 'it must time out: a crash leaves a dialog open');
});
