// Every level name the learner can see has a Spanish entry, and the helpers
// fall back to English for anything else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMods } from '../../src/instruments/mods.js';
import { es, levelLabel, levelNumLabel } from '../../src/core/level-names.js';

// MODS.harp is added inside app.js's IIFE (not importable), so read its level names from the source.
const app = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
const harpBlock = app.slice(app.indexOf('levels', app.indexOf('MODS.harp = {')), app.indexOf('tuner: { name:'));
const harpNames = [...harpBlock.matchAll(/\{ name: '([^']+)'/g)].map(m => m[1]);

const names = new Set(harpNames);
for (const m of Object.values(buildMods())) for (const l of m.levels || []) names.add(l.name);

test('the harmonica names were found (the source scrape works)', () => {
  assert.ok(harpNames.length >= 10, 'found ' + harpNames.length);
});

test('every level name in MODS has a Spanish entry', () => {
  const missing = [...names].filter(n => !Object.prototype.hasOwnProperty.call(es, n));
  assert.deepEqual(missing, []);
});

test('levelLabel: Spanish only for es, English otherwise and for unknown names', () => {
  assert.equal(levelLabel('Syncopation', 'es'), 'Síncopa');
  assert.equal(levelLabel('Syncopation', 'en'), 'Syncopation');
  assert.equal(levelLabel('Syncopation'), 'Syncopation');
  assert.equal(levelLabel('Not a real level', 'es'), 'Not a real level');
  assert.equal(levelLabel('Everything, faster (3)', 'es'), 'Todo, más rápido (3)');
  assert.equal(levelLabel('Everything, faster (3)', 'en'), 'Everything, faster (3)');
});

test('levelNumLabel', () => {
  assert.equal(levelNumLabel(4, 'es'), 'Nivel 4');
  assert.equal(levelNumLabel(4, 'en'), 'Level 4');
  assert.equal(levelNumLabel(4), 'Level 4');
});
