import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchForInstall } from '../../src/core/install-offer.js';

function fakeWindow() {
  const ls = {};
  return {
    addEventListener(type, fn) { (ls[type] = ls[type] || []).push(fn); },
    fire(type, ev = {}) { (ls[type] || []).forEach((fn) => fn(ev)); },
  };
}
function promptEvent(outcome) {
  const ev = { prevented: false, prompted: 0, preventDefault() { this.prevented = true; }, prompt() { this.prompted++; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome }) };
  return ev;
}

test('the browser offering an install keeps its own banner back and tells the page', () => {
  const win = fakeWindow();
  const seen = [];
  watchForInstall(win, (ready) => seen.push(ready));
  const ev = promptEvent('accepted');
  win.fire('beforeinstallprompt', ev);
  assert.equal(ev.prevented, true);
  assert.deepEqual(seen, [true]);
});

test('install() shows the browser prompt once, reports the answer and withdraws the offer', async () => {
  const win = fakeWindow();
  const seen = [];
  const offer = watchForInstall(win, (ready) => seen.push(ready));
  const ev = promptEvent('dismissed');
  win.fire('beforeinstallprompt', ev);
  assert.equal(await offer.install(), 'dismissed');
  assert.equal(ev.prompted, 1);
  assert.deepEqual(seen, [true, false]);
  assert.equal(await offer.install(), null, 'a used prompt cannot be shown again');
  assert.equal(ev.prompted, 1);
});

test('installing by other means withdraws the offer', () => {
  const win = fakeWindow();
  const seen = [];
  watchForInstall(win, (ready) => seen.push(ready));
  win.fire('beforeinstallprompt', promptEvent('accepted'));
  win.fire('appinstalled');
  assert.deepEqual(seen, [true, false]);
});

test('no offer, or no window, means install() does nothing', async () => {
  const offer = watchForInstall(fakeWindow(), () => {});
  assert.equal(await offer.install(), null);
  assert.equal(watchForInstall(null, () => {}), null);
});
