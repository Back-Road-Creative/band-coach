// Scaffold only: one English string table plus t(id, params). No locale
// switch ships yet (setLocale/registerLocale exist so a future translation
// can register without touching every call site), but only 'en' is ever
// wired into the built app. Pure -- no DOM, no AudioContext -- so this is
// exercised head-on rather than through a browser page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, en, setLocale, registerLocale } from '../../src/core/i18n.js';

test('t() returns the English string for a known id', () => {
  assert.equal(t('backup.saved'), en['backup.saved']);
  assert.equal(typeof en['backup.saved'], 'string');
  assert.ok(en['backup.saved'].length > 0);
});

test('t() interpolates a {name}-style param', () => {
  registerLocale('en', { 'greeting.test': 'Hello, {name}!' });
  assert.equal(t('greeting.test', { name: 'Ada' }), 'Hello, Ada!');
});

test('t() interpolates the same param used more than once', () => {
  registerLocale('en', { 'repeat.test': '{name} met {name}.' });
  assert.equal(t('repeat.test', { name: 'Sam' }), 'Sam met Sam.');
});

test('an unknown id returns the id itself and never throws', () => {
  assert.doesNotThrow(() => t('no.such.id'));
  assert.equal(t('no.such.id'), 'no.such.id');
});

test('a missing param is left visible as {name}, never silently dropped', () => {
  registerLocale('en', { 'missing.param.test': 'Hello, {name}!' });
  assert.equal(t('missing.param.test'), 'Hello, {name}!');
  assert.equal(t('missing.param.test', {}), 'Hello, {name}!');
  assert.equal(t('missing.param.test', { other: 'x' }), 'Hello, {name}!');
});

test('t() with no params on a string with no placeholders returns it unchanged', () => {
  registerLocale('en', { 'plain.test': 'Plain text.' });
  assert.equal(t('plain.test'), 'Plain text.');
});

test('registerLocale can add a new locale and setLocale switches to it', () => {
  registerLocale('xx', { 'locale.test': 'XX text' });
  setLocale('xx');
  assert.equal(t('locale.test'), 'XX text');
  setLocale('en'); // restore default for any later test in this process
});

test('setLocale falls back to English for an id missing in the active locale', () => {
  registerLocale('xx', {});
  registerLocale('en', { 'fallback.test': 'English fallback' });
  setLocale('xx');
  assert.equal(t('fallback.test'), 'English fallback');
  setLocale('en');
});

test('only "en" ships in the shipped table -- no other locale is pre-registered', () => {
  // Fresh import isolation isn't available in the same process, so this
  // asserts on the shape of the shipped default instead: en is a plain
  // object of string values, never empty.
  assert.equal(typeof en, 'object');
  assert.ok(Object.keys(en).length > 0);
  Object.values(en).forEach((v) => assert.equal(typeof v, 'string'));
});
