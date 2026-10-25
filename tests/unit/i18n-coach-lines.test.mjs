// The coach/hint lines app.js builds around level moves and session start must be t() calls, so
// Español shows Spanish (the cause: they were English literals). Checks every coach.* key exists in
// en and es with the same {params}, and that the English literals are gone from src/app.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { en, es } from '../../src/core/i18n.js';

const app = readFileSync(fileURLToPath(new URL('../../src/app.js', import.meta.url)), 'utf8');
const params = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const KEYS = ['coach.levelUp', 'coach.levelUpNew', 'coach.fastPace', 'coach.warmPrefix', 'coach.capturedMelody', 'coach.tiredCap', 'coach.longDay', 'coach.warmUpTail', 'coach.welcomePath', 'coach.dayCap', 'coach.winGo', 'coach.endedOnWin'];

// coach.idle / coach.idleBack predate this block (top of the table, already translated).
const PRE_EXISTING = ['coach.idle', 'coach.idleBack'];

test('every coach.* key exists in en and es with the same params', () => {
  for (const k of KEYS) {
    assert.equal(typeof en[k], 'string', k + ' in en');
    assert.equal(typeof es[k], 'string', k + ' in es');
    assert.notEqual(es[k], en[k], k + ' is translated');
    assert.equal(params(es[k]), params(en[k]), k + ' params');
  }
  assert.deepEqual(Object.keys(en).filter(k => k.startsWith('coach.') && !PRE_EXISTING.includes(k)).sort(), [...KEYS].sort(), 'no unlisted coach.* key');
  assert.equal(Object.keys(en).at(-1).startsWith('coach.'), true, 'coach block is last in en');
  assert.equal(Object.keys(es).at(-1).startsWith('coach.'), true, 'coach block is last in es');
});

test('the English coach literals are gone from src/app.js (they live in the i18n table)', () => {
  for (const lit of ['Level up. Next: ', "' New: '", 'speeding up the pace', "'Warm-up, does not count. '", 'Your captured melody: ', 'each ended weaker than they started', 'You already have ', 'First a short warm-up through what you know', 'Welcome back. Next on your keyboard path', 'That is 45 minutes of practice today'])
    assert.ok(!app.includes(lit), 'still a literal in app.js: ' + lit);
});
