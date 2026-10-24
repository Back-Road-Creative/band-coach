// The practice level card (answer-time line, beats line, progress bar name)
// is routed through t() with a Spanish value for each key, placed before the
// trailing coach.* block of both tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en, es, t, setLocale } from '../../src/core/i18n.js';

const KEYS = ['level.limitSeconds', 'level.limitBeats', 'level.progressAria'];

test('level card keys exist in both tables and Spanish differs from English', () => {
  for (const k of KEYS) {
    assert.equal(typeof en[k], 'string', k + ' in en');
    assert.equal(typeof es[k], 'string', k + ' in es');
    assert.notEqual(es[k], en[k], k + ' is translated');
  }
});

test('level card lines interpolate in both languages', () => {
  setLocale('es');
  try {
    assert.equal(t('level.limitSeconds', { n: 8 }), '8 segundos para responder');
    assert.equal(t('level.limitBeats', { n: 72 }), '72 pulsos por minuto');
  } finally { setLocale('en'); }
  assert.equal(t('level.limitSeconds', { n: 8 }), '8 seconds to answer');
});

test('the level card keys sit before the trailing coach.* block of each table', () => {
  for (const table of [en, es]) {
    const keys = Object.keys(table);
    const tail = keys.indexOf('coach.levelUp');
    assert.ok(tail > 0 && keys.slice(tail).every(k => k.startsWith('coach.')), 'the trailing block is all coach.*');
    for (const k of KEYS) assert.ok(keys.indexOf(k) < tail, k + ' sits before the trailing coach.* block');
  }
});

// The Spanish sweep (tests/release/acceptance-locale.test.mjs) turns each
// English table value into a pattern where {param} matches any text. A value
// that is only "{a} to {b}" therefore matched every on-screen string that
// contains " to " (song titles, "Progress to next level"), so the week range
// keeps a literal lead-in word.
test('no English value is a bare "{a} word {b}" pattern the sweep would match against any text', () => {
  const bare = Object.entries(en).filter(([, v]) => typeof v === 'string' && /^\{\w+\} [a-z]+ \{\w+\}$/i.test(v.trim()));
  assert.deepEqual(bare, []);
  assert.match(en['history.wk.range'], /^Week of /);
  assert.match(es['history.wk.range'], /^Semana del /);
});
