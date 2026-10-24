// Settings is the one screen a Spanish speaker has to read to change the
// language back, so every visible word in it must sit on a data-i18n marker
// (src/index.html) with a key in both tables. The scan removes every element
// that carries a marker, strips the remaining tags, and expects nothing left
// to read except the two language names, which are written in their own
// language on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { en, es } from '../../src/core/i18n.js';

const html = readFileSync(fileURLToPath(new URL('../../src/index.html', import.meta.url)), 'utf8');
const start = html.indexOf('<section id="settingsView"');
const end = html.indexOf('</section>', start);
const settings = html.slice(start, end);
const ENDONYMS = ['English', 'Español'];

test('every visible word in Settings sits on a data-i18n marker', () => {
  assert.ok(start >= 0 && end > start, 'the Settings section was found');
  let rest = settings;
  rest = rest.replace(/<(\w+)\b[^>]*\bdata-i18n="[^"]+"[^>]*>[^<]*<\/\1>/g, ' ');
  rest = rest.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/g, ' ').replace(/<[^>]+>/g, ' ');
  ENDONYMS.forEach((w) => { rest = rest.replace(w, ' '); });
  const leftover = rest.replace(/\s+/g, ' ').trim();
  assert.equal(leftover, '', 'Settings text with no data-i18n marker: ' + leftover);
});

test('every Settings marker has an English and a Spanish entry', () => {
  const ids = [...settings.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 20, 'the scan found the Settings markers (' + ids.length + ')');
  const missing = ids.filter((id) => !(id in en) || !(id in es));
  assert.deepEqual(missing, []);
});
