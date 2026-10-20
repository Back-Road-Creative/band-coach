// Every status line the Songs panel puts through say() must be a t() call, so Español shows Spanish
// (the cause: 50 of 51 say() calls carried English literals). Scans the three files that call say(),
// and checks the songs.say.* keys exist in en and es with the same {params} and that each call site
// passes exactly the params its string declares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { en, es } from '../../src/core/i18n.js';

const FILES = ['../../src/ui/songs.js', '../../src/ui/songs/record-door.js', '../../src/ui/songs/review.js'];

// First-argument source text -> why it may stay un-t()'d.
const ALLOWED = {
  "''": 'clears the status line; no words to translate',
  'text': 'sayVerdict forwards text its callers built with t()',
  '(report && report.feelLine) || \'\'': 'feelLine is already t(songs.import.feelSwung/feelStraight) in transcribe.js',
  'e && e.message ? e.message : String(e)': 'a band-pack reader error shown verbatim (the reader is outside this slice)',
};

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// Splits at depth-0 commas from `start` (just after an opening paren/brace) to its closing bracket.
function topLevelArgs(src, start) {
  const args = []; let depth = 0, cur = '', q = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (q) { cur += c; if (c === '\\') { cur += src[++i]; } else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') { if (depth === 0) { args.push(cur.trim()); return args; } depth--; }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return args;
}

const sayCalls = [];
for (const rel of FILES) {
  const src = read(rel);
  const re = /(^|[^.\w])say\(/g;
  let m;
  while ((m = re.exec(src))) {
    const idx = m.index + m[0].length;
    if (/function\s+$/.test(src.slice(0, m.index + m[1].length))) continue;
    sayCalls.push({ file: rel.split('/').pop(), line: src.slice(0, idx).split('\n').length, arg: topLevelArgs(src, idx)[0] });
  }
}

test('the scan finds the say() calls (a scan that finds none proves nothing)', () => {
  assert.ok(sayCalls.length >= 45, 'found ' + sayCalls.length);
});

test('every say() text goes through t() (or is allowlisted with a reason)', () => {
  const bad = sayCalls.filter((c) => !/^t\(\s*(['"][\w.]+['"]|[^?]+ \? '[\w.]+' : '[\w.]+')/.test(c.arg) && !(c.arg in ALLOWED));
  assert.deepEqual(bad.map((c) => `${c.file}:${c.line} say(${c.arg.slice(0, 60)}`), []);
});

const params = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

test('every songs.say.* key is in en and es with the same {params}', () => {
  const used = new Set();
  for (const rel of FILES) for (const m of read(rel).matchAll(/'(songs\.say\.\w+)'/g)) used.add(m[1]);
  assert.ok(used.size >= 30, 'used ' + used.size);
  for (const k of used) {
    assert.equal(typeof en[k], 'string', 'en missing ' + k);
    assert.equal(typeof es[k], 'string', 'es missing ' + k);
    assert.deepEqual(params(es[k]), params(en[k]), 'param mismatch ' + k);
  }
  for (const k of Object.keys(en)) if (k.startsWith('songs.say.')) assert.ok(used.has(k), 'unused key ' + k);
});

test('each t(songs.say.*, {...}) call site passes exactly the params its string declares', () => {
  for (const rel of FILES) {
    const src = read(rel);
    for (const m of src.matchAll(/\bt\(\s*'(songs\.say\.\w+)'\s*(,\s*\{)?/g)) {
      const passed = m[2] ? topLevelArgs(src, m.index + m[0].length).map((a) => /^\s*(\w+)/.exec(a)[1]).sort() : [];
      assert.deepEqual(passed, params(en[m[1]]), rel + ' ' + m[1]);
    }
  }
});
