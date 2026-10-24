// One DOM builder and one escaper per kind: a second copy under src/ drifts
// (the three panel-local el() copies had already diverged on `html` and on
// property assignment). This guard fails when a copy comes back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function sources(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = (p) => relative(SRC, p).split('\\').join('/');

test('el() is defined once, in ui/dom.js', () => {
  const copies = sources().filter((p) => /function el\(/.test(readFileSync(p, 'utf8'))).map(rel);
  assert.deepEqual(copies, ['ui/dom.js']);
});

test('the shared el() does not grow an html key or property assignment', () => {
  const src = readFileSync(join(SRC, 'ui/dom.js'), 'utf8');
  assert.doesNotMatch(src, /innerHTML/);
  assert.doesNotMatch(src, /\bin node\b/);
});

// ui/history.js still carries its own esc(); it is owned by another change and
// moves onto escapeHtml there, which removes this entry.
const PENDING_ESCAPE_COPIES = ['ui/history.js'];

test('the HTML and XML escapers are defined once, in core/escape.js', () => {
  const reserved = /replace\(\/(?:&\/g|\[&<>"'\]\/g)/;
  const copies = sources().filter((p) => reserved.test(readFileSync(p, 'utf8'))).map(rel)
    .filter((f) => f !== 'core/escape.js' && !PENDING_ESCAPE_COPIES.includes(f));
  assert.deepEqual(copies, []);
});
