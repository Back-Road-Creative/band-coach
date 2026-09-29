// The Spanish table must cover EVERY English key (a future en key with no es
// entry fails here, rather than shipping a half-translated screen), keep the
// {param} tokens identical (a renamed token would print a raw "{name}"), and
// setLocale('es') must actually switch what t() returns.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { t, en, es, setLocale, LOCALES } from '../../src/core/i18n.js';

afterEach(() => setLocale('en'));

const tokens = s => (s.match(/\{\w+\}/g) || []).sort();

test('es has an entry for every en key, and no key en lacks', () => {
  const missing = Object.keys(en).filter(k => !Object.prototype.hasOwnProperty.call(es, k));
  const extra = Object.keys(es).filter(k => !Object.prototype.hasOwnProperty.call(en, k));
  assert.deepEqual(missing, [], 'en keys with no Spanish string: ' + JSON.stringify(missing));
  assert.deepEqual(extra, [], 'Spanish keys with no English key: ' + JSON.stringify(extra));
});

test('every es string is a non-empty string with the same {param} tokens as en', () => {
  for (const k of Object.keys(en)) {
    assert.equal(typeof es[k], 'string', k);
    assert.ok(es[k].trim().length > 0, k + ' is empty');
    assert.deepEqual(tokens(es[k]), tokens(en[k]), k + ': placeholder tokens differ');
  }
});

test('setLocale("es") switches t() (with params) and setLocale("en") switches back', () => {
  setLocale('es');
  assert.equal(t('nav.practice'), es['nav.practice']);
  assert.notEqual(t('nav.practice'), en['nav.practice']);
  assert.match(t('reset.progressCleared', { name: 'Piano' }), /Piano/);
  assert.doesNotMatch(t('reset.progressCleared', { name: 'Piano' }), /\{name\}/);
  setLocale('en');
  assert.equal(t('nav.practice'), en['nav.practice']);
});

test('LOCALES lists exactly the locales that have a table, English first', () => {
  assert.deepEqual(LOCALES.map(l => l.code), ['en', 'es']);
  assert.deepEqual(LOCALES.map(l => l.name), ['English', 'Español']);
});
