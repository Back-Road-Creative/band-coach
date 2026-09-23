// Static checks on the Windows Store desktop shell (store/**). These run
// with plain `node --test` — no browser, no store/node_modules required —
// so `npm test` at the repo root stays dependency-free of the shell's own
// devDependencies (electron, electron-builder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(here));
const storeRoot = join(repoRoot, 'store');

const mainJs = readFileSync(join(storeRoot, 'main.js'), 'utf8');

test('main.js requests the single-instance lock', () => {
  assert.match(mainJs, /requestSingleInstanceLock\s*\(/);
});

test('main.js hardens the BrowserWindow webPreferences', () => {
  assert.match(mainJs, /contextIsolation:\s*true/);
  assert.match(mainJs, /nodeIntegration:\s*false/);
  assert.match(mainJs, /sandbox:\s*true/);
});

test('main.js installs a webRequest network block', () => {
  assert.match(mainJs, /webRequest\.onBeforeRequest\s*\(/);
});

test('main.js installs a permission handler naming only media/midi', () => {
  assert.match(mainJs, /setPermissionRequestHandler\s*\(/);
  assert.match(mainJs, /setPermissionCheckHandler\s*\(/);
  // main.js delegates the allow/deny decision to the pure policy module —
  // see store/lib/permission-policy.js and
  // tests/unit/store-permission-policy.test.mjs for the exhaustive
  // allow/deny behavior. Here we only confirm main.js actually imports it
  // and passes every identifying argument through, rather than deciding
  // itself.
  assert.match(mainJs, /require\(['"]\.\/lib\/permission-policy\.js['"]\)/);
  assert.match(mainJs, /isAllowed\s*\(/);

  // The allow-list is an explicit, named set — not a wildcard or an
  // inverted deny-list — and it names exactly media/midi/midiSysex.
  const policyJs = readFileSync(join(storeRoot, 'lib', 'permission-policy.js'), 'utf8');
  const allowListMatch = policyJs.match(/ALLOWED_PERMISSIONS\s*=\s*new Set\(\[([^\]]+)\]\)/);
  assert.ok(allowListMatch, 'expected an ALLOWED_PERMISSIONS Set literal in lib/permission-policy.js');
  const names = allowListMatch[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  assert.deepEqual(new Set(names), new Set(['media', 'midi', 'midiSysex']));
});

test('main.js denies navigation and window.open away from the app file', () => {
  assert.match(mainJs, /will-navigate/);
  assert.match(mainJs, /setWindowOpenHandler\s*\(/);
  assert.match(mainJs, /action:\s*['"]deny['"]/);
});

test('preload.js exists and does not call contextBridge (nothing to expose)', () => {
  const preload = readFileSync(join(storeRoot, 'preload.js'), 'utf8');
  const code = preload
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
  assert.doesNotMatch(code, /contextBridge\.exposeInMainWorld/);
});

const builderConfig = JSON.parse(readFileSync(join(storeRoot, 'electron-builder.json'), 'utf8'));

test('electron-builder.json parses and targets appx', () => {
  assert.ok(Array.isArray(builderConfig.win.target));
  assert.ok(builderConfig.win.target.includes('appx'));
});

test('electron-builder.json has no hard-coded real-looking publisher identity', () => {
  const { identityName, publisher, publisherDisplayName } = builderConfig.appx;
  // Safe placeholders only — never a real-looking Partner Center identity.
  assert.match(identityName, /placeholder/i);
  assert.match(publisher, /placeholder/i);
  assert.match(publisherDisplayName, /placeholder/i);
});

test('electron-builder.json declares only the microphone device capability', () => {
  assert.deepEqual(builderConfig.appx.capabilities, ['microphone']);
  // internetClient is opt-in for electron-builder's AppX target (see
  // AppxCapabilities.js CAPABILITY_MAP "common" group) — it must not be
  // present, since the app is offline-only.
  assert.ok(!builderConfig.appx.capabilities.includes('internetClient'));
});

// Every file main.js (and anything it requires) loads at launch must be
// matched by electron-builder.json's `files` list. That list is an explicit
// allow-list: app-builder-lib adds the default `**/*` ONLY when `files` is
// empty or contains nothing but `!` ignores (fileMatcher.js, "add default
// patterns"), so a module main.js requires that is not on the list is left
// out of app.asar and the packaged app dies at launch with Electron's
// "A JavaScript error occurred in the main process" dialog. That is exactly
// how v1.3.0-v1.6.0 shipped: lib/permission-policy.js arrived in PR #20
// without a `files` entry, and the Store's certification run (policy
// 10.1.2.10, 2026-09-23) was the first launch of the packaged app.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$');
}

function localRequiresOf(relPath, seen = new Set()) {
  if (seen.has(relPath)) return seen;
  seen.add(relPath);
  const src = readFileSync(join(storeRoot, relPath), 'utf8');
  for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const target = join(dirname(relPath), m[1]).split('\\').join('/');
    localRequiresOf(target, seen);
  }
  return seen;
}

test('electron-builder.json packages every local module main.js requires', () => {
  const includes = builderConfig.files.filter(p => !p.startsWith('!')).map(globToRegExp);
  const needed = [...localRequiresOf('main.js'), 'preload.js'];
  const missing = needed.filter(p => !includes.some(re => re.test(p)));
  assert.deepEqual(
    missing,
    [],
    'these files load at launch but are not in electron-builder.json "files", so the packaged app crashes: ' +
      missing.join(', ')
  );
});

test('scripts/apply-identity.mjs falls back to placeholders when env is unset', async () => {
  const { applyIdentity } = await import(join(storeRoot, 'scripts', 'apply-identity.mjs'));
  const { config, applied } = applyIdentity({});
  assert.equal(applied.identityName, 'placeholder');
  assert.equal(applied.publisher, 'placeholder');
  assert.equal(applied.publisherDisplayName, 'placeholder');
  assert.match(config.appx.identityName, /placeholder/i);
});

test('scripts/apply-identity.mjs overlays real env values when present', async () => {
  const { applyIdentity } = await import(join(storeRoot, 'scripts', 'apply-identity.mjs'));
  const { config, applied } = applyIdentity({
    BC_IDENTITY_NAME: 'RealPublisher.BandCoach',
    BC_PUBLISHER: 'CN=RealPublisher',
    BC_PUBLISHER_DISPLAY_NAME: 'Real Publisher LLC',
  });
  assert.equal(applied.identityName, 'env');
  assert.equal(config.appx.identityName, 'RealPublisher.BandCoach');
  assert.equal(config.appx.publisher, 'CN=RealPublisher');
  assert.equal(config.appx.publisherDisplayName, 'Real Publisher LLC');
});

test('scripts/apply-identity.mjs assertIdentityComplete is a no-op when every field came from env', async () => {
  const { applyIdentity, assertIdentityComplete } = await import(join(storeRoot, 'scripts', 'apply-identity.mjs'));
  const { applied } = applyIdentity({
    BC_IDENTITY_NAME: 'RealPublisher.BandCoach',
    BC_PUBLISHER: 'CN=RealPublisher',
    BC_PUBLISHER_DISPLAY_NAME: 'Real Publisher LLC',
  });
  assert.doesNotThrow(() => assertIdentityComplete(applied));
});

test('scripts/apply-identity.mjs assertIdentityComplete throws naming every missing env var when identity is incomplete', async () => {
  const { applyIdentity, assertIdentityComplete } = await import(join(storeRoot, 'scripts', 'apply-identity.mjs'));
  const { applied } = applyIdentity({ BC_IDENTITY_NAME: 'RealPublisher.BandCoach' });
  assert.throws(() => assertIdentityComplete(applied), err => {
    assert.match(err.message, /BC_PUBLISHER\b/);
    assert.match(err.message, /BC_PUBLISHER_DISPLAY_NAME/);
    assert.doesNotMatch(err.message, /BC_IDENTITY_NAME/);
    return true;
  });
});

test('scripts/apply-identity.mjs assertIdentityComplete throws naming all three when nothing is set', async () => {
  const { applyIdentity, assertIdentityComplete } = await import(join(storeRoot, 'scripts', 'apply-identity.mjs'));
  const { applied } = applyIdentity({});
  assert.throws(() => assertIdentityComplete(applied), err => {
    assert.match(err.message, /BC_IDENTITY_NAME/);
    assert.match(err.message, /BC_PUBLISHER\b/);
    assert.match(err.message, /BC_PUBLISHER_DISPLAY_NAME/);
    return true;
  });
});

test('store/package.json exposes a submission build that requires identity, and the plain build still works with placeholders', () => {
  const storePkg = JSON.parse(readFileSync(join(storeRoot, 'package.json'), 'utf8'));
  assert.match(storePkg.scripts['dist:appx:submission'], /--require-identity/);
  assert.doesNotMatch(storePkg.scripts['dist:appx'], /--require-identity/);
  assert.doesNotMatch(storePkg.scripts['dist:appx'], /BC_REQUIRE_IDENTITY/);
});

test('scripts/prepare-app.mjs prefers the release build then falls back to plain', async () => {
  const { resolveSourceHtml } = await import(join(storeRoot, 'scripts', 'prepare-app.mjs'));
  if (existsSync(join(repoRoot, 'dist', 'release', 'band-coach.html')) || existsSync(join(repoRoot, 'dist', 'band-coach.html'))) {
    assert.doesNotThrow(() => resolveSourceHtml());
  } else {
    assert.throws(() => resolveSourceHtml(), /Run the root build/);
  }
});

test('scripts/generate-icons.mjs produces valid, correctly sized PNGs', async () => {
  const { encodeSolidPng, REQUIRED_SIZES } = await import(join(storeRoot, 'scripts', 'generate-icons.mjs'));
  assert.ok(REQUIRED_SIZES.length >= 4);
  const png = encodeSolidPng(44, 44, [0x25, 0x63, 0xeb, 0xff]);
  const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, 44);
  assert.equal(height, 44);
});

test('store/package.json does not add electron to the root install', () => {
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const rootDeps = Object.keys(rootPkg.devDependencies || {}).concat(Object.keys(rootPkg.dependencies || {}));
  assert.ok(!rootDeps.includes('electron'));
  assert.ok(!rootDeps.includes('electron-builder'));

  const storePkg = JSON.parse(readFileSync(join(storeRoot, 'package.json'), 'utf8'));
  assert.equal(storePkg.devDependencies.electron, '44.4.3');
  assert.equal(storePkg.devDependencies['electron-builder'], '26.15.3');
});
