// Unit tests for store/scripts/apply-identity.mjs's version stamping.
//
// The appx manifest's Identity/@Version is read by electron-builder from
// config.extraMetadata.version (deep-merged onto the packaged app's
// package.json metadata — see app-builder-lib/out/packager.js:277 — then
// turned into the four-part Windows form by
// AppInfo.getVersionInWeirdWindowsForm(), which AppxTarget.js calls for the
// "version" macro). AppX requires exactly four numeric parts, and the Store
// reserves the fourth (revision) for itself, so it must always be 0. The
// repo-root package.json version (three parts, e.g. "1.3.0") must never be
// shipped as-is (Windows would read that as 1.3.0.0 anyway via
// getVersionInWeirdWindowsForm's own default-to-zero padding, but nothing
// upstream of that call was ever supplying the real app version at all — see
// the CI defect this fixes: every run stamped store/package.json's own
// "0.1.0", never the app's "1.2.0"/"1.3.0").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAppxVersion, applyIdentity } from '../../store/scripts/apply-identity.mjs';

test('computeAppxVersion pads a three-part version with a zero revision', () => {
  assert.equal(computeAppxVersion('1.3.0'), '1.3.0.0');
});

test('computeAppxVersion forces the revision to 0 even if the input already has four parts', () => {
  // The Store reserves the fourth part for itself; a stray fourth part in
  // the source version (however it got there) must never leak through.
  assert.equal(computeAppxVersion('1.3.0.7'), '1.3.0.0');
});

test('computeAppxVersion rejects a version with too few parts', () => {
  assert.throws(() => computeAppxVersion('1.3'), /unparseable version/);
});

test('computeAppxVersion rejects a non-numeric version part', () => {
  assert.throws(() => computeAppxVersion('1.3.a'), /unparseable version/);
});

test('computeAppxVersion rejects an empty or missing version', () => {
  assert.throws(() => computeAppxVersion(''), /version/);
  assert.throws(() => computeAppxVersion(undefined), /version/);
});

test('applyIdentity stamps config.extraMetadata.version from the injected root version', () => {
  const { config } = applyIdentity({}, { rootVersion: '1.3.0' });
  assert.equal(config.extraMetadata.version, '1.3.0.0');
});

test('applyIdentity preserves the existing extraMetadata.main entry alongside the version', () => {
  const { config } = applyIdentity({}, { rootVersion: '1.3.0' });
  assert.equal(config.extraMetadata.main, 'main.js');
});

test('applyIdentity throws rather than silently defaulting when the root version is malformed', () => {
  assert.throws(() => applyIdentity({}, { rootVersion: 'not-a-version' }), /unparseable version/);
});

test('applyIdentity reads the real repo-root package.json version when none is injected', () => {
  // Proves the wiring reaches the actual root package.json, not a stub —
  // this is the assertion that would have caught the original defect
  // (store/package.json's own "0.1.0" was the only thing ever read).
  const { config } = applyIdentity({});
  assert.match(config.extraMetadata.version, /^\d+\.\d+\.\d+\.0$/);
  assert.notEqual(config.extraMetadata.version, '0.1.0.0');
});
