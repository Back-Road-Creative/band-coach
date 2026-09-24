// store/README.md said the .appx the store-package workflow uploads could
// only be tried by uploading it to Partner Center: the package is unsigned
// (the Store signs on ingest) and Windows refuses to install an unsigned
// package. store/scripts/install-local.ps1 closes that gap the way
// run-wack.ps1 does on the CI runner — sign a COPY with a throwaway
// self-signed certificate whose subject is the manifest's own Publisher,
// trust it in LocalMachine\TrustedPeople, Add-AppxPackage the copy. These
// tests pin the script's contract from Linux, where it cannot run: it reads
// the Publisher out of the package instead of a hard-coded value, never
// signs the original, mirrors run-wack's certificate shape, can uninstall,
// and the README tells the reader it exists and what it needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const script = read('../../store/scripts/install-local.ps1');
const wack = read('../../store/scripts/run-wack.ps1');
const readme = read('../../store/README.md');

test('takes the .appx path as a mandatory parameter and offers -Uninstall', () => {
  assert.match(script, /\[Parameter\(Mandatory\)\]\s*\[string\]\$Appx/);
  assert.match(script, /\[switch\]\$Uninstall/);
  assert.match(script, /Remove-AppxPackage/);
});

test('reads Publisher and Name from the package manifest, never a literal', () => {
  assert.match(script, /GetEntry\('AppxManifest\.xml'\)/);
  assert.match(script, /\$manifest\.Package\.Identity/);
  assert.match(script, /-Subject \$publisher/);
  assert.doesNotMatch(script, /CN=[0-9A-F]{8}-/i, 'a hard-coded publisher GUID would drift from the manifest');
  assert.doesNotMatch(script, /HeadlessMode\.BandCoach/, 'a hard-coded identity name would drift from the manifest');
});

test('signs and installs a copy, leaving the original untouched', () => {
  assert.match(script, /Copy-Item \$Appx \$signed/);
  assert.match(script, /signtool[^\n]*\$signed/i);
  assert.match(script, /Add-AppxPackage -Path \$signed/);
  assert.doesNotMatch(script, /Add-AppxPackage -Path \$Appx\b/);
  assert.doesNotMatch(script, /signtool[^\n]*\$Appx\b/i, 'signtool must never run on the original .appx');
});

test('the throwaway certificate matches run-wack.ps1: code-signing EKU, no CA, TrustedPeople', () => {
  for (const marker of [
    "-TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')",
    "Cert:\\LocalMachine\\TrustedPeople",
    'sign /fd SHA256 /sha1',
  ]) {
    assert.ok(wack.includes(marker), `run-wack.ps1 no longer carries ${marker}; update both scripts together`);
    assert.ok(script.includes(marker), `install-local.ps1 is missing ${marker}`);
  }
});

test('fails closed', () => {
  assert.match(script, /\$ErrorActionPreference = 'Stop'/);
  assert.match(script, /if \(\$LASTEXITCODE -ne 0\) \{ throw/);
});

test('store/README.md documents the local install and its prerequisites', () => {
  assert.match(readme, /install-local\.ps1/);
  const at = readme.indexOf('install-local.ps1');
  const section = readme.slice(at, at + 2500);
  for (const need of ['elevated', 'signtool', 'Developer Mode', '-Uninstall', 'upload']) {
    assert.ok(section.includes(need), `README install-local section should mention ${need}`);
  }
});
