// One versioned learning-event record (plan 6.4, src/core/learning-events.js)
// for every judged attempt -- a built-in drill answer, a Show-me (help)
// answer, and a judged song step all leave a row in DB.events, whitelisted
// through sanitizeDB() the same way DB.sessions rows are (see
// tests/characterization/songs-session-persist.test.mjs for that pattern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

async function driveToUnrevealed(page) {
  for (let i = 0; i < 60; i++) {
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
    const e = await page.evaluate('window.__coach.cur()');
    if (e && e.reveal === false && !e.failed) return e;
    for (let k = 0; k < 12; k++) {
      const state = await page.evaluate(
        `(function () { const t = window.__coach.task(), c = window.__coach.cur();
          return { done: !!(t && t.done), midi: c && c.info ? c.info.midi : null,
                   paused: !document.getElementById('breakCard').hidden }; })()`
      );
      if (state.paused) { await page.evaluate("document.getElementById('backBtn').click()"); continue; }
      if (state.done || state.midi === null) break;
      await page.evaluate(`window.__coach.note(${state.midi}, true)`);
    }
    await page.waitFor('window.__coach.task() && !window.__coach.task().done', 5000);
  }
  throw new Error('no unrevealed task appeared within 60 tasks');
}

test('one drill answer logs one DB.events row with source "drill"', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const before = await page.evaluate('window.__coach.db().events.length');
  const e = await driveToUnrevealed(page);
  const midi = e.info.midi;
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  await page.waitFor('window.__coach.db().events.length > ' + before);
  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.source, 'drill');
  assert.equal(row.instrument, 'gtr');
  assert.equal(row.assistance, 'none');
  assert.deepEqual(page.exceptions, []);
});

test('a Show-me answer logs a DB.events row with assistance "shown"', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('gtr')");
  await page.evaluate("document.getElementById('playBtn').click()");
  await page.waitFor('window.__coach.task()');

  const before = await page.evaluate('window.__coach.db().events.length');
  await driveToUnrevealed(page);
  await page.evaluate('window.__coach.showMe()');
  const midi = await page.evaluate('window.__coach.cur().info.midi');
  await page.evaluate(`window.__coach.note(${midi}, true)`);
  await page.waitFor('window.__coach.task() && window.__coach.task().done', 5000);

  await page.waitFor('window.__coach.db().events.length > ' + before);
  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.assistance, 'shown');
  assert.deepEqual(page.exceptions, []);
});

test('a malformed events row saved in localStorage is dropped on load, not thrown', async (t) => {
  const page = await launchPage(htmlPath, {
    initScript: `
      const KEY = 'bandcoach.v1';
      localStorage.setItem(KEY, JSON.stringify({ v: 1, mods: {}, sessions: [], events: [
        { v: 1, id: 'bad', at: 1, instrument: 'kbd' /* missing skill/source/etc */ },
        'not-even-an-object'
      ], prefs: { mod: 'kbd' } }));
    `,
  });
  t.after(() => page.close());
  await page.waitFor('window.__coach && window.__coach.db()');
  const events = await page.evaluate('window.__coach.db().events');
  assert.deepEqual(events, [], 'malformed rows are dropped, never kept and never thrown');
  assert.deepEqual(page.exceptions, []);
});

function challengeJson() {
  return JSON.stringify({
    schema: 'challenge/1',
    title: 'One Note',
    from: null,
    note: null,
    songs: [{
      schema: 'song/1', id: 'one-note-song', title: 'One Note Song', composer: null, licence: null, source: null,
      key: { tonic: 0, mode: 'major' }, metre: { num: 4, den: 4 }, bpm: 100, ticksPerQuarter: 480,
      parts: [{ id: 'melody', name: 'Melody', notes: [{ start: 0, dur: 1920, midi: 64 }] }],
      chords: []
    }]
  });
}

test('one judged song step logs a DB.events row with source "song" and songId, and it survives a reload', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-events-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes('One Note Song'))"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes('One Note Song')).click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const before = await page.evaluate('window.__coach.db().events.length');

  // Drive through the listen step (Next), then the first judged step
  // (rhythm) only -- one judged step is enough to prove the event shape.
  await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
  await page.waitFor("Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
  );
  await page.waitFor(
    "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')"
  );
  await page.evaluate("window.__coach.songsNote(64, true)");
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");

  await page.waitFor('window.__coach.db().events.length > ' + before);
  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.source, 'song');
  assert.equal(row.songId, 'one-note-song');
  assert.equal(row.partId, 'melody');
  assert.equal(row.instrument, 'kbd');

  await page.reload();
  await page.waitFor('window.__coach.db().events.length > 0');
  const afterReload = await page.evaluate('window.__coach.db().events');
  assert.ok(afterReload.some((ev) => ev.source === 'song' && ev.songId === 'one-note-song'), 'the song event survives sanitizeDB on reload');
  assert.deepEqual(page.exceptions, []);
});
