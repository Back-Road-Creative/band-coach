// el() (src/ui/dom.js): the one DOM helper the panels build with. Run against a
// tiny stand-in document (no browser) that records what el() asked it to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { el } from '../../src/ui/dom.js';

function fakeNode(tag) {
  return {
    tagName: tag, attrs: {}, children: [], listeners: {}, textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(c) { this.children.push(c); return c; },
  };
}

function withFakeDocument(fn) {
  globalThis.document = { createElement: fakeNode };
  try { fn(); } finally { delete globalThis.document; }
}

test('el builds the tag it is given with no attrs or children', () => {
  withFakeDocument(() => {
    const n = el('div');
    assert.equal(n.tagName, 'div');
    assert.deepEqual(n.attrs, {});
    assert.deepEqual(n.children, []);
  });
});

test('text becomes textContent, never an attribute', () => {
  withFakeDocument(() => {
    const n = el('p', { text: 'Hello <b>there</b>' });
    assert.equal(n.textContent, 'Hello <b>there</b>');
    assert.equal('text' in n.attrs, false);
  });
});

test('keys starting with "on" become event listeners for the rest of the name', () => {
  withFakeDocument(() => {
    const handler = () => {};
    const n = el('button', { onclick: handler, onkeydown: handler });
    assert.equal(n.listeners.click, handler);
    assert.equal(n.listeners.keydown, handler);
    assert.deepEqual(n.attrs, {});
  });
});

test('every other key is set as an attribute', () => {
  withFakeDocument(() => {
    const n = el('button', { type: 'button', class: 'x y', 'aria-label': 'Go', 'data-id': 3 });
    assert.deepEqual(n.attrs, { type: 'button', class: 'x y', 'aria-label': 'Go', 'data-id': 3 });
  });
});

test('a single child or an array of children is appended in order; falsy children are skipped', () => {
  withFakeDocument(() => {
    const a = fakeNode('a');
    const b = fakeNode('b');
    assert.deepEqual(el('div', {}, a).children, [a]);
    assert.deepEqual(el('div', {}, [a, null, b, false, undefined, 0, '']).children, [a, b]);
    assert.deepEqual(el('div', {}, null).children, []);
  });
});

test('null attrs are treated as none', () => {
  withFakeDocument(() => {
    const n = el('span', null, []);
    assert.deepEqual(n.attrs, {});
  });
});
