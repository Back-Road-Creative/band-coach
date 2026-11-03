// The set-up picture names every piece and gives the pedal and the open hi-hat their own icons, the hi-hat
// group moves as one, a saved layout is never moved for the player, and at phone width every drum's name sits
// next to its own drum (issue #631). Names and numbers below are literals, never read from src/**.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../helpers/browser.mjs';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { kitRegions } from '../../src/instruments/how/drum-kit.js';

const SPY = `
  window.__texts = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (s, ...r) { window.__texts.push(String(s)); return orig.call(this, s, ...r); };
`;
const WORDS = { kick: 'Kick', snare: 'Snare', 'hihat-closed': 'Hi-hat', 'hihat-open': 'open', 'hihat-pedal': 'pedal', 'tom-high': 'High tom', 'tom-mid': 'Mid tom', 'tom-floor': 'Floor tom', crash: 'Crash', ride: 'Ride' };
const FULL = { kick: 'Kick', snare: 'Snare', 'hihat-closed': 'Hi-hat closed', 'hihat-open': 'Hi-hat open', 'hihat-pedal': 'Hi-hat pedal', 'tom-high': 'High tom', 'tom-mid': 'Mid tom', 'tom-floor': 'Floor tom', crash: 'Crash', ride: 'Ride' };

const openSheet = async (page, prefs) => {
  await page.setViewport({ width: 390, height: 844, mobile: true });
  if (prefs) await page.evaluate(`window.__coach.db().prefs.kit = ${JSON.stringify(prefs)}`);
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.waitFor('window.__coach.kitBox()');
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.waitFor("!!document.querySelector('#kitPreview [data-piece=\"snare\"]')");
};
const drag = (page, id, dx, dy) => page.evaluate(`(() => {
  const svg = document.getElementById('kitPreview'), el = svg.querySelector('[data-piece="${id}"]'), b = svg.getBoundingClientRect(), e = el.getBoundingClientRect();
  const sx = e.left + e.width / 2, sy = e.top + e.height / 2, fire = (type, x, y) => (type === 'pointerdown' ? el : svg).dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
  fire('pointerdown', sx, sy); fire('pointermove', sx + ${dx} * b.height, sy + ${dy} * b.height); fire('pointerup', sx + ${dx} * b.height, sy + ${dy} * b.height);
})()`);
const placements = page => page.evaluate('window.__coach.db().prefs.kit.placements || {}');

test('the set-up picture names every piece, in the piece\'s own shape, and says the full name to a screen reader', async t => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openSheet(page);
  const got = await page.evaluate(`Object.fromEntries([...document.querySelectorAll('#kitPreview [data-piece]')].map(el => {
    const lab = document.querySelector('#kitPreview text[data-label="' + el.dataset.piece + '"]'), a = el.getBoundingClientRect(), b = lab && lab.getBoundingClientRect();
    return [el.dataset.piece, { aria: el.getAttribute('aria-label'), text: lab && lab.textContent, inside: !!b && b.width > 0 && b.left >= a.left - 1 && b.right <= a.right + 1 && b.top >= a.top - 1 && b.bottom <= a.bottom + 1 }];
  }))`);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(WORDS).sort());
  for (const id of Object.keys(WORDS)) {
    assert.equal(got[id].text, WORDS[id], id + ' is named on the picture');
    assert.equal(got[id].aria, FULL[id], id + ' is named for a screen reader');
    assert.ok(got[id].inside, id + ' name sits inside its own shape');
  }
});

test('the pedal and the open hi-hat each have their own icon on the set-up picture', async t => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openSheet(page);
  const d = await page.evaluate(`Object.fromEntries([...document.querySelectorAll('#kitPreview [data-icon]')].map(el => [el.dataset.icon, el.getAttribute('d')]))`);
  for (const id of Object.keys(WORDS)) assert.ok(d[id] && d[id].length > 8, id + ' has an icon');
  assert.notEqual(d['hihat-pedal'], d['hihat-open']);
  assert.equal(new Set([d['hihat-pedal'], d['hihat-open'], d['hihat-closed']]).size, 3);
});

test('the same piece has one name on the set-up sheet, the trainer drawing and the piece list', async t => {
  const page = await launchPage(HTML_PATH, { initScript: SPY });
  t.after(() => page.close());
  await page.setViewport({ width: 1440, height: 1200 });
  await page.evaluate("window.__coach.setMod('drum-kit')");
  await page.waitFor('window.__texts.includes("Kick")');
  const drawn = await page.evaluate('window.__texts');
  await page.evaluate("document.getElementById('setupBtn').click()");
  await page.waitFor("!!document.querySelector('#kitPreview [data-piece=\"snare\"]')");
  const sheet = await page.evaluate(`({ boxes: Object.fromEntries([...document.querySelectorAll('#kitShow-kick, [id^="kitShow-"]')].map(i => [i.id.slice(8), i.parentElement.textContent.trim()])), labels: Object.fromEntries([...document.querySelectorAll('#kitPreview text[data-label]')].map(x => [x.dataset.label, x.textContent])) })`);
  for (const id of ['kick', 'snare', 'tom-floor', 'crash', 'ride']) {
    assert.equal(sheet.boxes[id], FULL[id], id + ' in the set-up checklist');
    assert.equal(sheet.labels[id], FULL[id], id + ' on the set-up picture');
    assert.ok(drawn.includes(FULL[id]), id + ' on the trainer drawing');
  }
  for (const id of ['hihat-closed', 'hihat-open', 'hihat-pedal']) assert.equal(sheet.boxes[id], FULL[id], id + ' in the set-up checklist');
  assert.ok(drawn.includes('Hi-hat') && drawn.includes('open') && drawn.includes('pedal'), 'the hi-hat is named by the same words on the trainer drawing');
  assert.equal(sheet.labels['hihat-closed'], 'Hi-hat');
});

test('dragging the hi-hat, its open tab or its pedal moves all three together', async t => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openSheet(page);
  const HAT = { 'hihat-closed': [0.15, 0.62], 'hihat-open': [0.15, 0.395], 'hihat-pedal': [0.15, 0.86] };
  await drag(page, 'hihat-closed', 0.1, -0.05);
  let p = await placements(page);
  assert.deepEqual(Object.keys(p).sort(), Object.keys(HAT).sort(), 'only the hi-hat group was placed');
  for (const [id, [x, y]] of Object.entries(HAT)) assert.ok(Math.abs(p[id].x - (x + 0.1)) < 0.03 && Math.abs(p[id].y - (y - 0.05)) < 0.03, id + ' moved with the disc: ' + JSON.stringify(p[id]));
  const dx = p['hihat-open'].x - p['hihat-closed'].x, dy = p['hihat-open'].y - p['hihat-closed'].y;
  assert.ok(Math.abs(dx) < 0.005 && Math.abs(dy - (0.395 - 0.62)) < 0.005, 'the tab keeps its place on the disc: ' + dx + ', ' + dy);
  await drag(page, 'hihat-pedal', -0.05, 0.02);
  p = await placements(page);
  assert.ok(Math.abs(p['hihat-closed'].x - (0.15 + 0.05)) < 0.03 && Math.abs(p['hihat-open'].x - p['hihat-closed'].x) < 0.005, 'the pedal drags the disc and tab too');
  const before = p['hihat-open'].x;
  await page.evaluate(`document.querySelector('#kitPreview [data-piece="hihat-open"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  p = await placements(page);
  assert.ok(Math.abs(p['hihat-open'].x - (before + 0.02)) < 0.005 && Math.abs(p['hihat-closed'].x - p['hihat-open'].x) < 0.005 && Math.abs(p['hihat-pedal'].x - p['hihat-open'].x) < 0.005, 'an arrow key moves the group too');
});

test('a piece outside the hi-hat group still drags alone', async t => {
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openSheet(page);
  await drag(page, 'snare', -0.1, -0.1);
  assert.deepEqual(Object.keys(await placements(page)), ['snare']);
});

test('a saved layout loads unchanged and is only changed by what the player then moves', async t => {
  const saved = { 'hihat-closed': { x: 0.3, y: 0.5, scale: 1 }, snare: { x: 0.4, y: 0.7, scale: 1.2 } };
  const page = await launchPage(HTML_PATH);
  t.after(() => page.close());
  await openSheet(page, { placements: saved });
  assert.deepEqual(await placements(page), saved, 'opening the sheet changes nothing');
  const at = id => page.evaluate(`(() => { const el = document.querySelector('#kitPreview [data-piece="${id}"]'); return [Number(el.getAttribute('cx') || (Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2)), Number(el.getAttribute('cy') || (Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2))]; })()`);
  assert.deepEqual(await at('hihat-closed'), [0.3, 0.5]);
  const tab = await at('hihat-open');
  assert.ok(Math.abs(tab[0] - 0.15) < 1e-6 && Math.abs(tab[1] - 0.395) < 1e-6, 'the tab was not moved for the player: ' + tab);
  await drag(page, 'crash', 0.02, 0.02);
  const p = await placements(page);
  assert.deepEqual(p['hihat-closed'], saved['hihat-closed']);
  assert.deepEqual(p.snare, saved.snare);
  assert.deepEqual(Object.keys(p).sort(), ['crash', 'hihat-closed', 'snare']);
});

// Each name must sit against its own drum: no box over another name or another piece's real shape, and the nearest
// piece to every name is its own (at phone width the old layout put "Snare" over the high tom).
const gap = (l, r) => r.kind === 'circle' ? Math.max(0, Math.hypot(Math.max(l.x - r.cx, 0, r.cx - l.x - l.w), Math.max(l.y - r.cy, 0, r.cy - l.y - l.h)) - r.r) : Math.hypot(Math.max(r.x - l.x - l.w, 0, l.x - r.x - r.w), Math.max(r.y - l.y - l.h, 0, l.y - r.y - r.h));
for (const [name, width, height, bar] of [['390x844 with a bar', 390, 844, true], ['390x844 idle', 390, 844, false], ['360x640 with a bar', 360, 640, true], ['320x568 with a bar', 320, 568, true]]) {
  test(`at ${name} every name sits against its own drum and touches no other name or piece (#631)`, async t => {
    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());
    await page.setViewport({ width, height, mobile: true });
    await page.evaluate("window.__coach.setMod('drum-kit')");
    await page.waitFor('window.__coach.kitLabels().length === 10');
    if (bar) { await page.evaluate("document.getElementById('playBtn').click()"); await page.waitFor('window.__coach.bar() && window.__coach.bar().staff'); await page.waitFor('window.__coach.kitBox().h < 0.9 * document.getElementById("cv").height'); }
    await page.evaluate('new Promise(r => setTimeout(r, 500))');
    const d = await page.evaluate('({ b: window.__coach.kitBox(), labels: window.__coach.kitLabels() })'), regs = kitRegions(d.b), bad = [];
    assert.equal(d.labels.length, 10);
    for (const l of d.labels) {
      const own = regs.find(r => r.id === l.id);
      for (const r of regs) { if (r.id === l.id) continue; if (gap(l, r) <= 0) bad.push(l.id + ' name touches the ' + r.id + ' piece'); else if (gap(l, r) <= gap(l, own) + 1) bad.push(l.id + ' name is as near the ' + r.id + ' piece (' + gap(l, r).toFixed(1) + ') as its own (' + gap(l, own).toFixed(1) + ')'); }
    }
    for (let i = 0; i < d.labels.length; i++) for (let j = i + 1; j < d.labels.length; j++) { const a = d.labels[i], c = d.labels[j]; if (!(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y)) bad.push(a.id + ' name on the ' + c.id + ' name'); }
    assert.deepEqual(bad, [], 'name placement at ' + name);
  });
}
