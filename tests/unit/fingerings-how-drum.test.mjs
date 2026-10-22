// The drum kit in the "How to play it" panel: src/ui/fingerings/how.js picks
// the drawn-kit kind for any record carrying a `kit`, maps a heard MIDI note
// to the piece it names, and src/ui/fingerings.js draws that kit with the
// struck piece highlighted. The diagram test runs the real builder against a
// tiny stand-in document (no browser), checking what it builds.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { howKindFor, computeHow, defaultNoteFor } from '../../src/ui/fingerings/how.js';
import drumKit, { canonicalMidi } from '../../src/instruments/drum-kit.js';
import { describeHit, KIT_ASPECT } from '../../src/instruments/how/drum-kit.js';
import voice from '../../src/instruments/voice.js';

test('howKindFor picks the drawn kit for any record with a kit, ahead of the family branches', () => {
  assert.equal(howKindFor(drumKit), 'drum-kit');
  assert.equal(howKindFor({ ...voice, kit: drumKit.kit }), 'drum-kit');
  assert.equal(howKindFor(voice), 'voice');
});

test('computeHow maps a GM note to the piece it names, with the layout and a plain sentence', () => {
  const how = computeHow(drumKit, 38);
  assert.equal(how.kind, 'drum-kit');
  assert.equal(how.piece, 'snare');
  assert.equal(how.playable, true);
  assert.equal(how.layout.length, drumKit.kit.length);
  assert.equal(how.description, describeHit('snare'));
  assert.equal(computeHow(drumKit, 36).piece, 'kick');
  assert.equal(computeHow(drumKit, 44).piece, 'hihat-pedal');
});

test('a note that is not on the kit says so plainly instead of highlighting a wrong drum', () => {
  const how = computeHow(drumKit, 39);
  assert.equal(how.piece, null);
  assert.equal(how.playable, false);
  assert.match(how.description, /39/);
  assert.match(how.description, /not one of/);
});

test('defaultNoteFor opens the drum kit on the snare', () => {
  assert.equal(defaultNoteFor(drumKit), canonicalMidi('snare'));
});

// Minimal stand-in for the DOM calls the diagram builder makes.
function fakeNode(tag, ns) {
  return {
    tagName: tag, namespaceURI: ns || null, attrs: {}, children: [], textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; }
  };
}
function all(node, pred, out = []) {
  if (pred(node)) out.push(node);
  node.children.forEach(c => all(c, pred, out));
  return out;
}

test('drumKitDiagram draws every piece, labels it, fills the struck one and carries the description', async () => {
  globalThis.document = {
    createElement: tag => fakeNode(tag),
    createElementNS: (ns, tag) => fakeNode(tag, ns)
  };
  try {
    const { drumKitDiagram } = await import('../../src/ui/fingerings.js');
    const how = computeHow(drumKit, 49);
    const svg = drumKitDiagram(drumKit, how);
    assert.equal(svg.tagName, 'svg');
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(svg.getAttribute('role'), 'img');
    assert.equal(svg.getAttribute('aria-label'), how.description);
    assert.equal(svg.getAttribute('viewBox'), `0 0 ${100 * KIT_ASPECT} 100`);
    const pieces = all(svg, n => n.getAttribute('data-piece') !== undefined);
    assert.equal(pieces.length, drumKit.kit.length);
    assert.deepEqual(pieces.map(c => c.getAttribute('data-piece')).sort(), drumKit.kit.map(p => p.id).sort());
    const hit = pieces.filter(c => /fing-hit/.test(c.getAttribute('class')));
    assert.equal(hit.length, 1);
    assert.equal(hit[0].getAttribute('data-piece'), 'crash');
    assert.match(hit[0].getAttribute('style'), /#f3c52f/, 'the struck piece is filled');
    const piece = id => pieces.find(c => c.getAttribute('data-piece') === id);
    const cymbalStroke = Number(piece('ride').getAttribute('stroke-width'));
    const drumStroke = Number(piece('snare').getAttribute('stroke-width'));
    assert.ok(cymbalStroke < drumStroke, 'cymbals are drawn as thinner rings');
    // the shapes tell the pieces apart: a bell on each cymbal disc, a rim on each drum, footboards and a tab as rectangles
    assert.equal(all(svg, n => /fing-bell/.test(n.getAttribute('class') || '')).length, 3, 'a bell on crash, ride and the hi-hat');
    assert.equal(all(svg, n => /fing-rim/.test(n.getAttribute('class') || '')).length, 4, 'a rim on each of the four drums');
    for (const id of ['kick', 'hihat-pedal', 'hihat-open']) assert.equal(piece(id).tagName, 'rect', id + ' is a rectangle');
    for (const id of ['snare', 'ride', 'hihat-closed']) assert.equal(piece(id).tagName, 'circle', id + ' is a circle');
    assert.equal(all(svg, n => /fing-throne/.test(n.getAttribute('class') || '')).length, 1, 'a throne mark');
    const labels = all(svg, n => n.tagName === 'text').map(t => t.textContent);
    for (const p of drumKit.kit) assert.ok(labels.includes(p.name), 'label for ' + p.name);
    // No inline colours: every colour comes from the stage's CSS variables
    // or the panel's existing highlight colour.
    for (const c of all(svg, n => n.getAttribute('style') !== undefined)) assert.doesNotMatch(c.getAttribute('style') || '', /#(?!f3c52f|06101d)[0-9a-f]{3,6}|rgb/i);

    const miss = drumKitDiagram(drumKit, computeHow(drumKit, 39));
    assert.equal(all(miss, n => /fing-hit/.test(n.getAttribute('class') || '')).length, 0);
  } finally {
    delete globalThis.document;
  }
});
