// Plain-words guard: jargon a non-technical learner should never read in the
// interface. Scans the English table, the static HTML and the literal strings
// in app.js that put those words on screen. Add a term here when a plainer
// word exists; the es table is checked for English leakage in i18n-locales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { en } from '../../src/core/i18n.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const html = read('../../src/index.html');
const app = read('../../src/app.js');

// term -> plain replacement, for the failure message
const BANNED = [
  [/\bbpm\b/i, 'beats a minute'],
  [/\b\d* ?s per answer\b/i, 'seconds to answer'],
  [/\bretained\b/i, 'remembered / still known'],
  [/\bneed scores?\b/i, 'what you most need to work on'],
  [/\bpractis(e|es|ed|ing)\b/i, 'practice (US spelling, verb included)'],
];

test('the English table has none of the banned terms', () => {
  const hits = [];
  for (const [id, text] of Object.entries(en)) for (const [re, plain] of BANNED) if (re.test(text)) hits.push(`${id}: ${re} -> ${plain}`);
  assert.deepEqual(hits, []);
});

test('the static HTML has none of the banned terms', () => {
  const hits = [];
  for (const [re, plain] of BANNED) if (re.test(html)) hits.push(`${re} -> ${plain}`);
  assert.deepEqual(hits, []);
});

test('app.js on-screen literals: level limit and groove label are spelled out', () => {
  assert.ok(!/' bpm'/.test(app), "the level readout must not end in ' bpm'");
  assert.ok(!/' s per answer'/.test(app), "the level readout must not say ' s per answer'");
  assert.ok(!/\+ ' bpm\)/.test(app), 'the groove checkbox label must not say bpm');
});

test('the tagline is one line: a single sentence of at most 90 characters', () => {
  const tag = en['app.subtitle'];
  assert.ok(tag.length <= 90, `${tag.length} characters`);
  assert.equal(tag.replace(/\.$/, '').split(/[.!?] /).length, 1, 'one sentence');
});
