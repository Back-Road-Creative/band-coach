// describePlan(blocks, nameOf, opts) builds the "Today: ..." coach line. It
// stays pure (no i18n import): the caller passes opts.t, a translator with the
// same (id, params) shape as src/core/i18n.js's t(). With no translator it
// speaks plain English, and those English phrases must match the en table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePlan, PLAN_PHRASES } from '../../src/core/curriculum.js';
import { en, es, setLocale, t } from '../../src/core/i18n.js';

const blocks = [
  { kind: 'review', ids: ['a', 'b'] },
  { kind: 'weak', id: 'n67' },
  { kind: 'apply' },
  { kind: 'check', ids: ['a'] },
  { kind: 'song', title: 'Ode', done: true },
];

test('the built-in English phrases equal the en table entries', () => {
  const ids = Object.keys(PLAN_PHRASES);
  assert.ok(ids.length >= 8);
  for (const id of ids) assert.equal(en[id], PLAN_PHRASES[id], id);
});

test('every plan phrase has a Spanish entry', () => {
  for (const id of Object.keys(PLAN_PHRASES)) assert.equal(typeof es[id], 'string', id);
});

test('without a translator the line reads as before', () => {
  assert.equal(describePlan(blocks, (id) => (id === 'n67' ? 'G4' : id)), 'Today: 2 to review, then G4, then use it in a phrase, then a check, then play Ode (done today).');
});

test('with t() under es the whole line is Spanish', () => {
  setLocale('es');
  try {
    const line = describePlan(blocks, (id) => (id === 'n67' ? 'G4' : id), { t });
    assert.match(line, /^Hoy: /);
    assert.match(line, /2 por repasar/);
    assert.doesNotMatch(line, /to review|then|phrase|check|done today/);
    assert.match(describePlan([], null, { t, seen: false }), /primera sesión/);
    assert.match(describePlan([], null, { t }), /práctica libre/);
  } finally { setLocale('en'); }
});
