// Docs guard: the fingerings panel persists capo/tuning/handedness per instrument in
// DB.panels.fingerings (src/ui/fingerings.js, src/ui/fingerings/setup.js). The README once said
// the choice was session-only and reset on reload; keep it from drifting back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'README.md'), 'utf8');
const head = '\n## Capo, alternate tunings and a left-handed view\n';
const start = readme.indexOf(head);
assert.ok(start >= 0, 'README section "Capo, alternate tunings and a left-handed view" not found');
const next = readme.indexOf('\n## ', start + head.length);
const section = readme.slice(start, next < 0 ? undefined : next);

test('README fingerings section does not claim the setup is session-only', () => {
  assert.doesNotMatch(section, /session-only/i, 'stale claim: "session-only"');
  assert.doesNotMatch(section, /resets? on reload/i, 'stale claim: "resets on reload"');
  assert.doesNotMatch(section, /is a follow-up/i, 'stale claim: persistence "is a follow-up"');
  assert.doesNotMatch(section, /reset to standard\/no-capo\/\s*right-handed\s+whenever a different instrument is picked/i, 'stale claim: controls reset when the instrument changes');
});

test('README fingerings section names the real store and validator', () => {
  assert.match(section, /DB\.panels/, 'section must name DB.panels');
  assert.match(section, /readFingeringSetup/, 'section must name readFingeringSetup');
});
