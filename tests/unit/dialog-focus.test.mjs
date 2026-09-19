import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTabIndex, createFocusTrap } from '../../src/ui/dialog-focus.js';

// Minimal fake DOM: just enough surface for createFocusTrap to drive. `hub`
// is a shared { current } box so only one element is ever "the" active one.
function fakeButton(id, hub) {
  const listeners = {};
  return {
    id,
    get focused() { return hub.current === this; },
    focus() { hub.current = this; },
    blur() { if (hub.current === this) hub.current = null; },
    addEventListener(name, fn) { listeners[name] = fn; },
    removeEventListener(name) { delete listeners[name]; },
    matches: () => true,
  };
}

function fakeContainer(children) {
  const listeners = {};
  return {
    children,
    querySelectorAll: () => children,
    addEventListener(name, fn) { listeners[name] = fn; },
    removeEventListener(name) { delete listeners[name]; },
    focus() {},
    fire(ev) { if (listeners.keydown) listeners.keydown(ev); },
  };
}

function fakeEvent(key, extra = {}) {
  return Object.assign({ key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, extra);
}

test('nextTabIndex: Tab from the last focusable wraps to the first', () => {
  assert.equal(nextTabIndex(2, 3, false), 0);
});

test('nextTabIndex: Tab from the middle just advances by one', () => {
  assert.equal(nextTabIndex(1, 3, false), 2);
});

test('nextTabIndex: Shift+Tab from the first wraps to the last', () => {
  assert.equal(nextTabIndex(0, 3, true), 2);
});

test('nextTabIndex: Shift+Tab from the middle just goes back by one', () => {
  assert.equal(nextTabIndex(1, 3, true), 0);
});

test('nextTabIndex: a single focusable element always stays put', () => {
  assert.equal(nextTabIndex(0, 1, false), 0);
  assert.equal(nextTabIndex(0, 1, true), 0);
});

test('nextTabIndex: no focusable elements is reported as -1, not thrown', () => {
  assert.equal(nextTabIndex(-1, 0, false), -1);
});

function fakeDoc(hub) {
  return { get activeElement() { return hub.current; } };
}

test('createFocusTrap: activate() focuses the first focusable item in the container', () => {
  const hub = { current: null };
  const a = fakeButton('a', hub), b = fakeButton('b', hub);
  const container = fakeContainer([a, b]);
  const trap = createFocusTrap({ container, doc: fakeDoc(hub) });
  trap.activate();
  assert.equal(a.focused, true);
});

test('createFocusTrap: deactivate() restores focus to an explicit restoreTo, not document.activeElement', () => {
  // Mirrors this app's own buttons, which call this.blur() before opening the
  // dialog: by the time activate() runs, document.activeElement is already
  // nothing useful, so the caller must be able to say who opened it.
  const hub = { current: null };
  const a = fakeButton('a', hub);
  const container = fakeContainer([a]);
  const opener = fakeButton('opener', hub);
  hub.current = null; // opener already blurred itself, same as this app's click handlers
  const trap = createFocusTrap({ container, doc: fakeDoc(hub) });
  trap.activate(opener);
  trap.deactivate();
  assert.equal(opener.focused, true);
});

test('createFocusTrap: Escape calls onEscape and prevents default', () => {
  const hub = { current: null };
  const a = fakeButton('a', hub);
  const container = fakeContainer([a]);
  let escaped = false;
  const trap = createFocusTrap({ container, doc: fakeDoc(hub), onEscape: () => { escaped = true; } });
  trap.activate();
  const ev = fakeEvent('Escape');
  container.fire(ev);
  assert.equal(escaped, true);
  assert.equal(ev.defaultPrevented, true);
});

test('createFocusTrap: Tab inside the container cycles focus among its own items', () => {
  const hub = { current: null };
  const a = fakeButton('a', hub), b = fakeButton('b', hub);
  const container = fakeContainer([a, b]);
  const trap = createFocusTrap({ container, doc: fakeDoc(hub) });
  trap.activate();
  assert.equal(a.focused, true);
  const ev = fakeEvent('Tab');
  container.fire(ev);
  assert.equal(b.focused, true, 'Tab should move focus to the second item');
  assert.equal(ev.defaultPrevented, true);
});
