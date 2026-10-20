// tests/families.json declares needsBuild / needsRelease per family. That declaration is only
// worth having if the family's package.json script really does it, so a script run directly
// (npm run test:release, test:unit ...) never meets a missing dist/ file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const manifest = read('tests/families.json');
const scripts = read('package.json').scripts;

// Expand `npm run X` so a script that delegates (test:all -> build) is judged by what it runs.
function expand(name, seen = new Set()) {
  if (seen.has(name)) return '';
  seen.add(name);
  return scripts[name].replace(/npm run ([\w:-]+)/g, (_, n) => (scripts[n] ? expand(n, seen) : _));
}
const DEV = /node build\/build\.mjs(?!\s+--)/;
const REL = /node build\/build\.mjs --release/;

for (const [name, f] of Object.entries(manifest.families)) {
  test(`${f.script} builds exactly what the ${name} family declares`, () => {
    const body = expand(f.script);
    const before = body.split('node --test')[0];
    assert.equal(DEV.test(before), f.needsBuild, `${f.script}: dev build before the tests must be ${f.needsBuild} (needsBuild)`);
    assert.equal(REL.test(before), f.needsRelease, `${f.script}: release build before the tests must be ${f.needsRelease} (needsRelease)`);
    if (f.needsBuild && f.needsRelease) {
      // A dev build deletes dist/ (including dist/release), so it must come first.
      assert.ok(before.search(DEV) < before.search(REL), `${f.script}: dev build must precede the release build`);
    }
  });
}

test('test:all builds the dev build and the release build, and npm test keeps its hooks', () => {
  const all = expand(manifest.all);
  assert.match(all, DEV);
  assert.match(all, REL);
  assert.equal(scripts.pretest, 'npm run build');
  assert.equal(scripts.posttest, 'npm run gate');
});
