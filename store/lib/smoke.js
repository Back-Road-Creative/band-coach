// The verdict for `--smoke-test` launches (see main.js and the "launch the
// packaged app" step in .github/workflows/store-package.yml). Pure and
// Electron-free so it is unit-tested without a Windows box
// (tests/unit/store-launch-smoke.test.mjs).
'use strict';

const SMOKE_FLAG = '--smoke-test';

// 0 only when the page finished loading, nothing failed to load, the
// renderer never went away, and the page logged no errors.
function smokeExitCode({ loaded, failedLoad, rendererGone, pageErrors }) {
  if (rendererGone) return 3;
  if (failedLoad) return 2;
  if (!loaded) return 4;
  if (pageErrors && pageErrors.length) return 5;
  return 0;
}

module.exports = { SMOKE_FLAG, smokeExitCode };
