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

const KIT_IDS = ['kick', 'snare', 'hihat-closed', 'hihat-open', 'hihat-pedal', 'tom-high', 'tom-mid', 'tom-floor', 'crash', 'ride'];

test('every drum-kit piece has a translated description, spoken name and drawn label', () => {
  const keys = [...KIT_IDS.flatMap(id => ['kit.desc.' + id, 'kit.name.' + id]), 'kit.desc.kick-compact', 'kit.side.left', 'kit.side.right',
    'kit.draw.hihat', 'kit.draw.open', 'kit.draw.pedal', 'kit.draw.mid1', 'kit.draw.mid2', 'kit.draw.high1', 'kit.draw.high2', 'kit.notOnKit'];
  for (const k of keys) {
    assert.equal(typeof en[k], 'string', k + ' missing in en');
    assert.equal(typeof es[k], 'string', k + ' missing in es');
  }
  for (const k of KIT_IDS.map(id => 'kit.desc.' + id)) assert.notEqual(es[k], en[k], k + ' is still English in es');
});

test('describeHit, piece names and the left-handed mirror follow the language', async () => {
  const { describeHit } = await import('../../src/instruments/how/drum-kit.js');
  const { PIECES } = await import('../../src/instruments/drum-kit.js');
  assert.equal(describeHit('kick'), en['kit.desc.kick'].replace('{right}', en['kit.side.right']));
  setLocale('es');
  assert.match(describeHit('kick'), /^Bombo: /);
  assert.equal(describeHit('hihat-pedal', { leftHanded: true }), t('kit.desc.hihat-pedal', { left: es['kit.side.right'], right: es['kit.side.left'] }));
  assert.notEqual(describeHit('hihat-pedal', { leftHanded: true }), describeHit('hihat-pedal'));
  assert.equal(PIECES.find(p => p.id === 'snare').name, es['kit.name.snare']);
  setLocale('en');
  assert.equal(PIECES.find(p => p.id === 'kick').name, 'Bass drum');
});
