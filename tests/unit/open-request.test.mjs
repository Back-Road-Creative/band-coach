// src/ui/songs/open-request.js: the cross-panel "open this song next time Songs
// is shown" request, and the "Play it on..." card row the Songs panel and the
// review screen both render. The store is a fake api.store(); the cards are
// built against a tiny stand-in document (no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OPEN_REQUEST_STORE_ID, requestOpenSong, renderPlayItOnCards } from '../../src/ui/songs/open-request.js';
import { INSTRUMENTS } from '../../src/instruments/index.js';
import { feasibility } from '../../src/song/feasibility.js';
import { SCHEMA, TICKS_PER_QUARTER } from '../../src/song/model.js';

function fakeApi() {
  const stores = {};
  return {
    store(id) { return { set(v) { stores[id] = v; }, get() { return stores[id]; } }; },
    _stores: stores,
  };
}

function fakeNode(tag) {
  return {
    tagName: tag, attrs: {}, children: [], listeners: {}, textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(c) { this.children.push(c); return c; },
  };
}
function all(node, pred, out = []) {
  if (pred(node)) out.push(node);
  node.children.forEach((c) => all(c, pred, out));
  return out;
}

function song() {
  return {
    schema: SCHEMA, id: 's1', title: 'S1', composer: null, licence: null, source: null,
    key: null, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: TICKS_PER_QUARTER,
    parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 480, midi: 60 }, { start: 480, dur: 480, midi: 64 }] }],
    chords: [],
  };
}

const READY = INSTRUMENTS.filter((i) => i.status === 'ready');

test('the store id is the one the Songs panel reads', () => {
  assert.equal(OPEN_REQUEST_STORE_ID, 'songs-open-request');
});

test('requestOpenSong with only a song id fills every optional field with null', () => {
  const api = fakeApi();
  requestOpenSong(api, 'song-1');
  assert.deepEqual(api._stores[OPEN_REQUEST_STORE_ID], { songId: 'song-1', partId: null, instrumentId: null, returnTo: null, mode: null });
});

test('requestOpenSong carries part, instrument, return mod and lesson mode when given', () => {
  const api = fakeApi();
  requestOpenSong(api, 'song-1', 'bass', 'gtr', 'kbd', 'check');
  assert.deepEqual(api._stores[OPEN_REQUEST_STORE_ID], { songId: 'song-1', partId: 'bass', instrumentId: 'gtr', returnTo: 'kbd', mode: 'check' });
});

test('requestOpenSong turns empty-string optionals into null, so a blank never reads as a choice', () => {
  const api = fakeApi();
  requestOpenSong(api, 'song-1', '', '', '', '');
  assert.deepEqual(api._stores[OPEN_REQUEST_STORE_ID], { songId: 'song-1', partId: null, instrumentId: null, returnTo: null, mode: null });
});

test('the Play it on row has one card per ready instrument, each badged with the real feasibility result', () => {
  globalThis.document = { createElement: fakeNode };
  try {
    const s = song();
    const section = renderPlayItOnCards(s, 'melody', null, () => {});
    assert.equal(section.tagName, 'section');
    assert.equal(section.attrs['aria-label'], 'Play it on…');
    assert.equal(all(section, (n) => n.tagName === 'h5')[0].textContent, 'Play it on…');
    const cards = all(section, (n) => n.tagName === 'li');
    assert.equal(cards.length, READY.length);
    assert.ok(READY.length > 1);
    cards.forEach((card, i) => {
      const btn = all(card, (n) => n.tagName === 'button')[0];
      const f = feasibility(s, 'melody', READY[i]);
      assert.equal(btn.attrs.title, f.detail);
      assert.equal(all(btn, (n) => n.attrs.class === 'panel-songs-instrument-name')[0].textContent, READY[i].name);
      const badge = all(btn, (n) => n.attrs.class === 'panel-songs-badge')[0];
      assert.equal(badge.textContent, f.label);
      assert.equal(badge.attrs['data-feasibility'], f.level);
    });
  } finally {
    delete globalThis.document;
  }
});

test('only the current instrument carries the current-card class', () => {
  globalThis.document = { createElement: fakeNode };
  try {
    const current = READY[1].id;
    const cards = all(renderPlayItOnCards(song(), 'melody', current, () => {}), (n) => n.tagName === 'li');
    const marked = cards.filter((c) => /panel-songs-instrument-card-current/.test(c.attrs.class));
    assert.equal(marked.length, 1);
    assert.equal(cards.indexOf(marked[0]), 1);
    const none = all(renderPlayItOnCards(song(), 'melody', null, () => {}), (n) => n.tagName === 'li');
    assert.equal(none.filter((c) => /current/.test(c.attrs.class)).length, 0);
  } finally {
    delete globalThis.document;
  }
});

test('clicking a card hands that card\'s instrument to onPick', () => {
  globalThis.document = { createElement: fakeNode };
  try {
    const picked = [];
    const section = renderPlayItOnCards(song(), 'melody', null, (inst) => picked.push(inst.id));
    const buttons = all(section, (n) => n.tagName === 'button');
    buttons[2].listeners.click();
    buttons[0].listeners.click();
    assert.deepEqual(picked, [READY[2].id, READY[0].id]);
  } finally {
    delete globalThis.document;
  }
});
