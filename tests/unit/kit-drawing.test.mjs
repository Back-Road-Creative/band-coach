// The kit drawing's shared data: where the open hi-hat tab sits, one name per piece, an icon per piece, and the
// hi-hat group that moves as one. Numbers are in frame-height units (see src/instruments/how/drum-kit.js).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { kitLayout, kitGroup, pieceIcon } from '../../src/instruments/how/drum-kit.js';
import { PIECES } from '../../src/instruments/drum-kit.js';
import { en, es, t, setLocale } from '../../src/core/i18n.js';

afterEach(() => setLocale('en'));

const at = (layout, id) => layout.find(p => p.id === id);
// the distance between a rectangle (centre, w, h) and a circle's edge; 0 or less means they touch or overlap
const rectToCircle = (rc, c) => Math.hypot(Math.max(rc.x - rc.w / 2 - c.x, 0, c.x - rc.x - rc.w / 2), Math.max(rc.y - rc.h / 2 - c.y, 0, c.y - rc.y - rc.h / 2)) - c.r;

test('the open hi-hat tab touches the hi-hat and keeps clear of the crash', () => {
  const l = kitLayout({}), tab = at(l, 'hihat-open'), hat = at(l, 'hihat-closed'), crash = at(l, 'crash');
  assert.ok(rectToCircle(tab, hat) <= 0.005, 'the tab touches the hi-hat disc, gap ' + rectToCircle(tab, hat));
  assert.ok(rectToCircle(tab, crash) >= 0.03, 'the tab is clear of the crash, gap ' + rectToCircle(tab, crash));
  assert.ok(rectToCircle(tab, hat) < rectToCircle(tab, crash) - 0.02, 'the tab is plainly nearer the hi-hat than the crash');
  assert.ok(Math.abs(tab.x - hat.x) <= 0.01 && tab.y < hat.y, 'the tab sits on the hi-hat\'s far edge');
});

test('the phone tap rule holds: the tab is a full 24 px target on the smallest kit frame the phone tests draw (128 px tall)', () => {
  const tab = at(kitLayout({}), 'hihat-open');
  assert.ok(tab.w * 128 >= 24 && tab.h * 128 >= 24, 'tab ' + tab.w * 128 + ' x ' + tab.h * 128 + ' px');
});

test('no two pieces overlap except the tab on the hi-hat disc, and every piece stays inside the frame', () => {
  const l = kitLayout({}), box = p => p.r !== undefined ? { x0: p.x - p.r, x1: p.x + p.r, y0: p.y - p.r, y1: p.y + p.r } : { x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.y - p.h / 2, y1: p.y + p.h / 2 };
  for (const p of l) { const b = box(p); assert.ok(b.x0 >= 0 && b.x1 <= 1.4 && b.y0 >= 0 && b.y1 <= 1, p.id + ' is inside the frame'); }
  const d = (a, c) => a.r !== undefined && c.r !== undefined ? Math.hypot(a.x - c.x, a.y - c.y) - a.r - c.r : a.r !== undefined ? rectToCircle(c, a) : c.r !== undefined ? rectToCircle(a, c) : Math.max(Math.abs(a.x - c.x) - (a.w + c.w) / 2, Math.abs(a.y - c.y) - (a.h + c.h) / 2);
  for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
    const ids = [l[i].id, l[j].id];
    if (ids.includes('hihat-open') && ids.includes('hihat-closed')) continue;
    assert.ok(d(l[i], l[j]) > 0, ids.join(' and ') + ' overlap by ' + -d(l[i], l[j]));
  }
});

test('one name per piece: the piece list reads the same table as the set-up checklist, with no second spelling', () => {
  for (const loc of ['en', 'es']) {
    setLocale(loc);
    for (const p of PIECES) assert.equal(p.name, t('kit.piece.' + p.id), loc + ' ' + p.id);
  }
  setLocale('en');
  assert.deepEqual(PIECES.map(p => p.name), ['Kick', 'Snare', 'Hi-hat closed', 'Hi-hat pedal', 'Hi-hat open', 'Floor tom', 'Mid tom', 'High tom', 'Crash', 'Ride']);
  assert.deepEqual(Object.keys(en).filter(k => k.startsWith('kit.name.')), [], 'the second table of names is gone (en)');
  assert.deepEqual(Object.keys(es).filter(k => k.startsWith('kit.name.')), [], 'the second table of names is gone (es)');
});

test('every piece has an icon, and the pedal and the open hi-hat do not share one', () => {
  const l = kitLayout({});
  for (const p of l) assert.match(pieceIcon(p.id, p), /^M[\d\s.,MLAZmlaz-]+$/, p.id + ' has a path');
  const open = pieceIcon('hihat-open', at(l, 'hihat-open')), pedal = pieceIcon('hihat-pedal', at(l, 'hihat-pedal'));
  // shapes, not just places: the same drawing moved to the other piece's spot must still differ
  assert.notEqual(open, pedal);
  assert.notEqual(pieceIcon('hihat-open', { x: 0, y: 0, w: 0.19, h: 0.19 }), pieceIcon('hihat-pedal', { x: 0, y: 0, w: 0.19, h: 0.19 }));
  assert.equal(new Set(PIECES.filter(p => !/^(tom|kick|snare|crash|ride)/.test(p.id)).map(p => pieceIcon(p.id, { x: 0, y: 0, r: 0.1, w: 0.19, h: 0.19 }))).size, 3, 'closed, open and pedal each have their own icon');
});

test('the hi-hat, its tab and its pedal are one group; every other piece moves alone', () => {
  for (const id of ['hihat-closed', 'hihat-open', 'hihat-pedal']) assert.deepEqual([...kitGroup(id)].sort(), ['hihat-closed', 'hihat-open', 'hihat-pedal']);
  for (const id of ['kick', 'snare', 'crash', 'ride', 'tom-high']) assert.deepEqual(kitGroup(id), [id]);
});

test('a saved layout is read as saved: a moved disc does not drag the tab or pedal along', () => {
  const saved = { placements: { 'hihat-closed': { x: 0.3, y: 0.5, scale: 1 }, snare: { x: 0.4, y: 0.7, scale: 1.2 } } };
  const before = kitLayout({}), l = kitLayout(saved);
  assert.deepEqual([at(l, 'hihat-closed').x, at(l, 'hihat-closed').y], [0.3, 0.5]);
  for (const id of ['hihat-open', 'hihat-pedal', 'kick', 'crash']) assert.deepEqual([at(l, id).x, at(l, id).y], [at(before, id).x, at(before, id).y], id + ' stays where the layout puts it');
  assert.ok(Math.abs(at(l, 'snare').r - at(before, 'snare').r * 1.2) < 1e-9);
});

test('one table of on-drawing words: a piece reads the same on the set-up sheet, the panel and the trainer, in both languages', async () => {
  const { kitWord, kitLines } = await import('../../src/instruments/how/drum-kit.js');
  for (const loc of ['en', 'es']) {
    setLocale(loc);
    for (const p of PIECES) {
      assert.equal(kitWord(p.id), t(({ 'hihat-closed': 'kit.draw.hihat', 'hihat-open': 'kit.draw.open', 'hihat-pedal': 'kit.draw.pedal' })[p.id] || 'kit.piece.' + p.id), loc + ' ' + p.id);
      assert.equal(kitLines(p.id).join(' '), kitWord(p.id), loc + ' ' + p.id + ' lines read as the word');
    }
  }
  setLocale('en');
  assert.deepEqual(kitLines('tom-mid'), ['Mid', 'tom']);
  assert.deepEqual(kitLines('snare'), ['Snare']);
});
