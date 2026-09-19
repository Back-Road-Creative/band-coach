import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPanels } from '../../src/ui/panels.js';

test('a panel mounts once, on first open, and shows every time', () => {
  const p = createPanels(), log = [];
  p.register({ id: 'songs', name: 'Songs', mount: (el, api) => { log.push('mount:' + el + ':' + api); return { show: () => log.push('show'), hide: () => log.push('hide') }; } });
  assert.deepEqual(log, []);
  p.open('songs', 'EL', 'API'); p.close(); p.open('songs', 'EL', 'API');
  assert.deepEqual(log, ['mount:EL:API', 'show', 'hide', 'show']);
  assert.equal(p.current(), 'songs');
});

test('opening another panel hides the open one', () => {
  const p = createPanels(), log = [];
  const def = id => ({ id, name: id, mount: () => ({ show: () => log.push('show:' + id), hide: () => log.push('hide:' + id) }) });
  p.register(def('a')); p.register(def('b'));
  p.open('a'); p.open('b');
  assert.deepEqual(log, ['show:a', 'hide:a', 'show:b']);
  assert.deepEqual(p.list().map(d => d.id), ['a', 'b']);
});

test('bad registrations and unknown panels fail loudly', () => {
  const p = createPanels();
  assert.throws(() => p.register({ id: 'x' }), /mount/);
  p.register({ id: 'x', mount: () => {} });
  assert.throws(() => p.register({ id: 'x', mount: () => {} }), /already/);
  assert.throws(() => p.open('nope'), /no panel/);
  p.open('x'); p.close(); p.close();
  assert.equal(p.current(), null);
});

test('saved panel data keeps plain objects and drops anything unsafe or oversized', async () => {
  const { sanitizePanelData, PANEL_DATA_MAX } = await import('../../src/ui/panels.js');
  assert.deepEqual(sanitizePanelData(null), {});
  assert.deepEqual(sanitizePanelData([1]), {});
  const got = sanitizePanelData({ songs: { list: [1, 2] }, ear: 'text', '__proto__x': {}, 'Bad Id': {}, big: { s: 'x'.repeat(PANEL_DATA_MAX) }, theory: [1] });
  assert.deepEqual(got, { songs: { list: [1, 2] } });
});
