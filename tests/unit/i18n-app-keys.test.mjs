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

const CONVERTED_FILES = ['../../src/app.js', '../../src/ui/fingerings.js'];

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
