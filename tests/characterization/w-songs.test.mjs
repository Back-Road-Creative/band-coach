// Songs panel (Wave W, unit "songs"). Drives the built page through
// window.__coach.openPanel('songs') and the DOM, per the author brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = HTML_PATH;

test('the songs panel lists the starter songs, easiest first', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");

  const titles = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).map(b => b.textContent)"
  );
  assert.ok(titles.includes('Hot Cross Buns'), 'the easiest starter tune is listed');
  assert.ok(titles.includes('Minuet in G'), 'a harder starter tune is also listed');
  assert.ok(titles.indexOf('Hot Cross Buns') < titles.indexOf('Minuet in G'), 'easiest tune is listed before a harder one');
});

test('the file input accepts the supported song and challenge extensions', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  const accept = await page.evaluate("document.getElementById('songsFileInput').getAttribute('accept')");
  assert.equal(accept, '.mid,.midi,.abc,.xml,.musicxml,.mxl,.gp,.bandpack,.json');
  const label = await page.evaluate("document.querySelector('label[for=\"songsFileInput\"]').textContent");
  assert.ok(label.includes('.mid'));
  assert.ok(label.includes('.mxl'), 'label mentions compressed MusicXML: ' + label);
  assert.ok(label.includes('.gp'), 'label mentions Guitar Pro: ' + label);
  assert.ok(label.includes('.bandpack'), 'label mentions band packs: ' + label);
});

test('choosing a one-part starter song opens a practice lesson, starting with a listen step', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const stepTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.ok(stepTitle.startsWith('Listen'), 'first step is a listen step: ' + stepTitle);

  // A listen step has no pass/fail judging, just a Next button.
  const nextBtn = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next')"
  );
  assert.ok(nextBtn !== undefined, 'a Next button is present for the listen step');

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4').textContent !== '" + stepTitle + "'");
  const secondTitle = await page.evaluate("document.querySelector('.panel-songs-practice h4').textContent");
  assert.notEqual(secondTitle, stepTitle);
});

test('recording via the keyboard/MIDI note forward counts notes and can be judged without crashing', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  // advance past the listen step to a step with a pass rule and a "Your turn" button
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')"
  );

  // Simulate the app's own onNote() forwarding a played keyboard note, the
  // way a real MIDI keyboard or the on-screen keys would (app.js's onNote()
  // forwards to this via the single added line, exposed here for testing as
  // window.__coach.songsNote).
  await page.evaluate('window.__coach.songsNote(64, true)');
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  // Judging must not throw, and the panel keeps showing a practice step
  // (either the same one repeated, or the next one).
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  assert.deepEqual(page.exceptions, []);
});

test('a correctly played song note feeds the trainer\'s readiness/level-up path, not just the song\'s own mastery record', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  const before = await page.evaluate('window.__coach.state().ready');

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')"
  );

  // Hot Cross Buns' first phrase begins on E4 (midi 64): a correctly pitched note.
  await page.evaluate('window.__coach.songsNote(64, true)');
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const after = await page.evaluate('window.__coach.state().ready');
  assert.ok(
    after > before,
    'a correctly played song note should raise the trainer\'s own readiness toward the next level, not just the song\'s mastery record: before=' + before + ' after=' + after
  );
});

test('capturing a note while recording does not steal keyboard focus from the record button', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Your turn')"
  );
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()"
  );
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')"
  );

  // A learner tabbing through the controls has landed on (and stayed on) the
  // record button; mark the real DOM node so a rebuild (a fresh node, no
  // matter how identical its text) is caught, not just a text-content match.
  await page.evaluate(
    "(function () { const b = Array.from(document.querySelectorAll('.panel-songs-practice button')).find(x => x.textContent === 'Stop and check'); b.dataset.testMarker = 'kept'; b.focus(); })()"
  );
  assert.equal(await page.evaluate('document.activeElement.dataset.testMarker'), 'kept');

  await page.evaluate('window.__coach.songsNote(64, true)');
  await page.waitFor("document.querySelector('.panel-songs-count').textContent.includes('1')");

  const stillFocused = await page.evaluate(
    "document.activeElement && document.activeElement.dataset && document.activeElement.dataset.testMarker === 'kept'"
  );
  assert.equal(stillFocused, true, 'the record button (same DOM node, so focus survives) should not be rebuilt while a note is captured');
});

test('a real .abc file picked through the file input lands in the library and appears in the list', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-songs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A minimal, valid one-line ABC tune (no existing fixture file in the repo
  // to reuse; import-abc's own unit tests build a tune string like this one
  // in-memory rather than from a file, so this is a hand-written minimal file).
  const abcPath = join(dir, 'uploaded-tune.abc');
  writeFileSync(abcPath, 'X:1\nT:Uploaded Tune\nM:4/4\nL:1/8\nK:C\nCDEFGABc|\n');

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");

  await page.setFileInput('#songsFileInput', abcPath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.includes('Uploaded Tune')");

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions while importing the real file');
  // The "imported" message and the rebuilt row list are two separate async
  // steps: under load the message lands first, so poll for the row rather
  // than reading the list once and hoping it has caught up.
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent.includes('Uploaded Tune'))"
  );
  const titles = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).map(b => b.textContent)"
  );
  assert.ok(titles.includes('Uploaded Tune'), 'the uploaded song appears in the panel\'s list: ' + titles.join(', '));
});

// Same tiny stored-only zip writer as tests/unit/import-gp7.test.mjs, kept
// local here too so a real .gp file can be written to disk for the file
// input to pick up (the point of this test: prove the panel's own dispatch,
// not just importGp7() in isolation, reaches the Guitar Pro importer).
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function buildZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const stored = f.data;
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(stored.length), u32(f.data.length),
      u16(nameBuf.length), u16(0),
      nameBuf,
    ]);
    const localOffset = offset;
    localChunks.push(localHeader, stored);
    offset += localHeader.length + stored.length;
    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(stored.length), u32(f.data.length),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(localOffset),
      nameBuf,
    ]);
    centralChunks.push(centralHeader);
  }
  const centralStart = offset;
  const central = Buffer.concat(centralChunks);
  offset += central.length;
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(centralStart), u16(0),
  ]);
  return Buffer.concat([...localChunks, central, eocd]);
}

test('a real .gp (Guitar Pro) file picked through the file input reaches the Guitar Pro importer, not the MusicXML one', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'band-coach-songs-gp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const gpif = '<?xml version="1.0" encoding="UTF-8"?><GPIF><Score><Title>Uploaded GP Tune</Title></Score></GPIF>';
  const gpPath = join(dir, 'uploaded.gp');
  writeFileSync(gpPath, buildZip([{ name: 'Content/score.gpif', data: Buffer.from(gpif, 'utf8') }]));

  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");

  await page.setFileInput('#songsFileInput', gpPath);
  await page.waitFor("document.querySelector('.panel-songs-msg').textContent.includes('Uploaded GP Tune')");

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions while importing the real .gp file');
  await page.waitFor(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).some(b => b.textContent.includes('Uploaded GP Tune'))"
  );
});

test('a "Save as…" control exists for each song and downloads MIDI, MusicXML and ABC', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");

  const exportLabels = await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row .panel-songs-export button')).map(b => b.textContent)"
  );
  assert.ok(exportLabels.includes('MIDI'), 'a MIDI save button is present: ' + exportLabels.join(', '));
  assert.ok(exportLabels.includes('MusicXML'), 'a MusicXML save button is present: ' + exportLabels.join(', '));
  assert.ok(exportLabels.includes('ABC'), 'an ABC save button is present: ' + exportLabels.join(', '));

  // Clicking a save button creates a Blob-backed object URL and an
  // a[download] element -- capture that instead of an actual filesystem
  // download, which headless Chromium in this test harness does not do.
  await page.evaluate(`
    window.__downloads = [];
    const realCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__lastBlob = blob; return realCreateObjectURL(blob); };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__downloads.push({ download: this.download, type: window.__lastBlob && window.__lastBlob.type });
      return realClick.call(this);
    };
  `);

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row .panel-songs-export button')).find(b => b.textContent === 'MIDI').click()"
  );
  await page.waitFor('window.__downloads.length > 0');
  const midiDownload = await page.evaluate('window.__downloads[0]');
  assert.ok(midiDownload.download.endsWith('.mid'), 'MIDI download has a .mid extension: ' + midiDownload.download);
  assert.equal(midiDownload.type, 'audio/midi');

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row .panel-songs-export button')).find(b => b.textContent === 'MusicXML').click()"
  );
  await page.waitFor('window.__downloads.length > 1');
  const xmlDownload = await page.evaluate('window.__downloads[1]');
  assert.ok(xmlDownload.download.endsWith('.musicxml'), 'MusicXML download has a .musicxml extension: ' + xmlDownload.download);

  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row .panel-songs-export button')).find(b => b.textContent === 'ABC').click()"
  );
  await page.waitFor('window.__downloads.length > 2');
  const abcDownload = await page.evaluate('window.__downloads[2]');
  assert.ok(abcDownload.download.endsWith('.abc'), 'ABC download has a .abc extension: ' + abcDownload.download);

  assert.deepEqual(page.exceptions, [], 'no uncaught exceptions while exporting');
});

test('the last song and part chosen are remembered across a re-open of the panel', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  await page.evaluate("window.__coach.setMod('kbd')");
  await page.evaluate("window.__coach.openPanel('songs')");
  await page.waitFor("document.querySelectorAll('.panel-songs-row button').length > 0");
  await page.evaluate(
    "Array.from(document.querySelectorAll('.panel-songs-row button')).find(b => b.textContent === 'Hot Cross Buns').click()"
  );
  await page.waitFor("document.querySelector('.panel-songs-practice h4')");

  const saved = await page.evaluate("window.__coach.db().panels.songs");
  assert.equal(saved.songId, 'hot-cross-buns');
  assert.equal(saved.partId, 'melody');
  assert.equal(saved.instrumentId, 'kbd');
});
