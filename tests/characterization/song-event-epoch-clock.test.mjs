// A song attempt used to stamp its learning-event row's `at` with the audio
// clock (api.now(), seconds since the page opened -- restarts at 0 on every
// reload) instead of epoch ms like every other row (a built-in drill's
// finishTask(), src/app.js). One event stream mixing two time scales breaks
// summarizeEvents()'s sort by `at` (src/core/learning-events.js) and
// pathwayState()'s DAY_MS spacing (src/core/pathway.js). This drives the real
// entry point (a judged song step, same technique
// tests/characterization/songs-input-route.test.mjs uses), never the debug
// hook, and separately proves sanitizeDB's on-load repair of rows already
// saved with the old audio-clock stamp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

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

async function importAndOpenSong(page, challengePath, songTitle = 'One Note Song') {
  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.setFileInput('#songsFileInput', challengePath);
  await page.waitFor(
    `Array.from(document.querySelectorAll('.panel-songs-challenge li button')).some(b => b.textContent.includes(${JSON.stringify(songTitle)}))`
  );
  await page.evaluate(
    `Array.from(document.querySelectorAll('.panel-songs-challenge li button')).find(b => b.textContent.includes(${JSON.stringify(songTitle)})).click()`
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
}

// Same technique as tests/characterization/songs-input-route.test.mjs's
// judgeFirstStepWith: click past every listen-only step, start listening,
// send the note in the SAME in-page turn listening began, then stop and check.
async function judgeFirstStepWith(page, sendNoteJs) {
  for (let i = 0; i < 8; i++) {
    const hasNext = await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')"
    );
    if (!hasNext) break;
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
  }
  await page.evaluate(`(async () => {
    const turnBtn = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn');
    if (turnBtn) turnBtn.click();
    while (!(document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far'))) {
      await new Promise(r => setTimeout(r, 4));
    }
    ${sendNoteJs}
  })()`);
  await page.waitFor("document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
}

test('a judged song step logs a row whose `at` is epoch ms, not the audio clock', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-song-epoch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const challengePath = join(dir, 'challenge.json');
  writeFileSync(challengePath, challengeJson());

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await importAndOpenSong(page, challengePath);

  const before = await page.evaluate('window.__coach.db().events.length');
  const wallBefore = Date.now();
  await judgeFirstStepWith(page, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));");
  await page.waitFor('window.__coach.db().events.length > ' + before);
  const wallAfter = Date.now();

  const events = await page.evaluate('window.__coach.db().events');
  const row = events[events.length - 1];
  assert.equal(row.source, 'song');
  // The audio clock (api.now()) restarts at 0 every page load and is always
  // well under one second here -- a row using it would fail this bound hard.
  // Real Date.now() epoch ms is comfortably inside [wallBefore, wallAfter].
  assert.ok(row.at >= wallBefore, 'row.at (' + row.at + ') is before the attempt started (' + wallBefore + ') -- not epoch ms');
  assert.ok(row.at <= wallAfter, 'row.at (' + row.at + ') is after the attempt finished (' + wallAfter + ') -- not epoch ms');
  assert.deepEqual(page.exceptions, []);
});

// sanitizeDB's on-load repair (src/core/sanitize-db.js repairEventClocks): a row saved
// with the old audio-clock `at` (finite, under 1e12 -- the year 2001, no page
// stays open that many SECONDS) is repaired using the next row in save order
// that carries a real epoch `at`.
test('an old audio-clock row is repaired on load using the next epoch row', async (t) => {
  const legacyBad = { v: 1, id: 'bad-1', at: 12.5, instrument: 'kbd', skill: 'melody:0', source: 'song', songId: 'one-note-song', partId: 'melody', assistance: 'none', dims: { pitch: 'ok' }, unassessed: [], activeMs: 100, bpmTarget: 100, bpmActual: 100 };
  const goodEpoch = { v: 1, id: 'good-1', at: 1_700_000_000_000, instrument: 'kbd', skill: 'melody:1', source: 'song', songId: 'one-note-song', partId: 'melody', assistance: 'none', dims: { pitch: 'ok' }, unassessed: [], activeMs: 100, bpmTarget: 100, bpmActual: 100 };
  const page = await launchPage(htmlPath, {
    initScript: `
      const KEY = 'bandcoach.v1';
      localStorage.setItem(KEY, JSON.stringify({ v: 1, mods: {}, sessions: [], events: [${JSON.stringify(legacyBad)}, ${JSON.stringify(goodEpoch)}], prefs: { mod: 'kbd' } }));
    `,
  });
  t.after(() => page.close());
  await page.waitFor('window.__coach && window.__coach.db()');
  const events = await page.evaluate('window.__coach.db().events');
  assert.equal(events.length, 2);
  assert.equal(events[0].id, 'bad-1', 'id is left untouched by the repair');
  assert.equal(events[0].at, 1_700_000_000_000, 'repaired to the next row\'s epoch `at`');
  assert.equal(events[1].at, 1_700_000_000_000, 'the good row is untouched');
  assert.deepEqual(page.exceptions, []);
});

// No later epoch row at all: the repair falls back to the load time
// (modelNow) -- never earlier than the truth, so a return/retention wait
// (src/core/pathway.js) is never granted early.
test('an old audio-clock row with no later epoch row falls back to the load time', async (t) => {
  const legacyBad = { v: 1, id: 'bad-only', at: 3.2, instrument: 'kbd', skill: 'melody:0', source: 'song', songId: 'one-note-song', partId: 'melody', assistance: 'none', dims: { pitch: 'ok' }, unassessed: [], activeMs: 100, bpmTarget: 100, bpmActual: 100 };
  // wallBefore is taken BEFORE launchPage, since launchPage only resolves
  // once the page has already loaded (and modelNow has already run) --
  // taking it after would race the very moment being bounded.
  const wallBefore = Date.now();
  const page = await launchPage(htmlPath, {
    initScript: `
      const KEY = 'bandcoach.v1';
      localStorage.setItem(KEY, JSON.stringify({ v: 1, mods: {}, sessions: [], events: [${JSON.stringify(legacyBad)}], prefs: { mod: 'kbd' } }));
    `,
  });
  t.after(() => page.close());
  await page.waitFor('window.__coach && window.__coach.db()');
  const wallAfter = Date.now();
  const events = await page.evaluate('window.__coach.db().events');
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'bad-only');
  assert.ok(events[0].at >= wallBefore && events[0].at <= wallAfter, 'falls back to the load time, never earlier than the truth');
  assert.deepEqual(page.exceptions, []);
});
