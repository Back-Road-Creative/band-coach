// Static scan: every id passed to t('...') in a converted file must exist
// in the English table, so the table can never silently drift out of sync
// with the call sites that depend on it. Scoped to the files this i18n
// slice actually touched (src/app.js), not a whole-repo sweep -- see the
// scaffold's scope note in src/core/i18n.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { en } from '../../src/core/i18n.js';

const CONVERTED_FILES = ['../../src/app.js', '../../src/ui/fingerings.js', '../../src/ui/ear.js', '../../src/ui/songs.js', '../../src/ui/songs/session-helpers.js', '../../src/ui/pathway.js', '../../src/ui/history.js', '../../src/instruments/mods.js'];

function idsUsedIn(relPath) {
  const path = fileURLToPath(new URL(relPath, import.meta.url));
  const src = readFileSync(path, 'utf8');
  const ids = [];
  const re = /\bt\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) ids.push(m[1]);
  return ids;
}

test('every t(id) used in the converted app.js slice exists in the English table', () => {
  const ids = CONVERTED_FILES.flatMap(idsUsedIn);
  assert.ok(ids.length > 0, 'the scan should find at least one t() call -- otherwise this test proves nothing');
  const missing = ids.filter((id) => !Object.prototype.hasOwnProperty.call(en, id));
  assert.deepEqual(missing, [], 'ids used via t() but absent from the English table: ' + JSON.stringify(missing));
});

test('ear.js routes its screen chrome through t() instead of English literals', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/ui/ear.js', import.meta.url)), 'utf8');
  assert.match(src, /import \{ t \} from '..\/core\/i18n\.js'/);
  for (const literal of ['Could not open the microphone.', 'Taps recorded', 'Hear it again', 'Show me the answer', 'Next question', 'Listening…', 'Nice ear.', 'Not quite.', 'Clear picks', 'Submit rhythm'])
    assert.ok(!src.includes(literal), 'ear.js still has the literal: ' + literal);
});
