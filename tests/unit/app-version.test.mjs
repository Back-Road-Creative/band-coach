// The app used to hardcode APP_VERSION = '0.1.0' in src/app.js, so every
// exported progress file claimed 0.1.0 forever no matter what package.json
// (and the build's injected <meta name="band-coach-version"> footer) said.
// resolveAppVersion() is the pure seam: it turns whatever the build did (or
// didn't) put in that meta tag's content attribute into the value the app
// reports and hands to exportProgress().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppVersion, DEV_VERSION } from '../../src/core/version.js';
import { exportProgress } from '../../src/core/progress-file.js';

test('resolveAppVersion returns the real version a build injected', () => {
  assert.equal(resolveAppVersion('1.3.0'), '1.3.0');
});

test('resolveAppVersion falls back to the dev sentinel for an empty meta content', () => {
  assert.equal(resolveAppVersion(''), DEV_VERSION);
});

test('resolveAppVersion falls back to the dev sentinel when the meta is missing entirely', () => {
  assert.equal(resolveAppVersion(undefined), DEV_VERSION);
  assert.equal(resolveAppVersion(null), DEV_VERSION);
});

test('resolveAppVersion trims incidental whitespace but never returns an empty string', () => {
  assert.equal(resolveAppVersion('   '), DEV_VERSION);
  assert.equal(resolveAppVersion('  1.3.0  '), '1.3.0');
});

test('DEV_VERSION is clearly marked as not a release', () => {
  assert.match(DEV_VERSION, /dev/);
});

test('an exported progress file carries the resolved version, not a hardcoded one', () => {
  const db = { prefs: {}, models: {}, log: [] };
  const built = exportProgress(db, { appVersion: resolveAppVersion('1.3.0'), now: () => 0 });
  assert.equal(built.appVersion, '1.3.0');

  const dev = exportProgress(db, { appVersion: resolveAppVersion(''), now: () => 0 });
  assert.equal(dev.appVersion, DEV_VERSION);
});
