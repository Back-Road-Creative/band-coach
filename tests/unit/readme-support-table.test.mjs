import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guards README.md's "Browser and device support" table against silent rot:
// every bullet in that section must carry an explicit tested/untested/
// unmeasured marker, so a future edit that adds a browser or device row
// without saying whether it was actually tried gets caught here instead of
// implying support nobody checked.

const here = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(join(here, '..', '..', 'README.md'), 'utf8');

function supportSection(text) {
  const start = text.indexOf('## Browser and device support');
  assert.ok(start >= 0, 'README.md must have a "Browser and device support" section');
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ');
  return next >= 0 ? rest.slice(0, next) : rest;
}

// Markdown bullets wrap onto continuation lines indented with two spaces;
// join each bullet's continuation lines back together before checking it.
function bullets(section) {
  const lines = section.split('\n');
  const out = [];
  for (const line of lines) {
    if (/^- \*\*/.test(line)) out.push(line);
    else if (out.length && /^\s+\S/.test(line)) out[out.length - 1] += ' ' + line.trim();
  }
  return out;
}

test('the browser/device support section exists and lists at least one row', () => {
  const rows = bullets(supportSection(readme));
  assert.ok(rows.length >= 3, 'expected several browser/device rows, found ' + rows.length);
});

test('every browser/device row states tested, untested, or unmeasured', () => {
  const rows = bullets(supportSection(readme));
  const unmarked = rows.filter(line => !/\b(tested|untested|unmeasured)\b/i.test(line));
  assert.deepEqual(unmarked, [], 'these support-table rows have no tested/untested/unmeasured marker');
});

test('Firefox and Safari are both named and both marked untested', () => {
  const rows = bullets(supportSection(readme));
  for (const browser of ['Firefox', 'Safari']) {
    const row = rows.find(l => l.includes(browser));
    assert.ok(row, browser + ' should be named in the support table');
    assert.match(row, /untested/i, browser + ' should be marked untested unless the repo owner says otherwise');
  }
});
