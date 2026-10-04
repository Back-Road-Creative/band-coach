// CURRENT BEHAVIOUR: the "Show" staff overlay on a fretted instrument (guitar,
// bass, ukulele) is drawn in a band ABOVE the fretboard, never across it: the
// clef must not cover the string labels, nor the staff lines cross the strings.
// Read from the canvas's own pixels: the fretboard is the brown (#2a1c12) box,
// the staff is five long light lines. Every one of them must sit above the box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const SCAN = `(function () {
  var c = document.getElementById('cv'), img = c.getContext('2d').getImageData(0, 0, c.width, c.height), W = c.width, H = c.height, d = img.data;
  var px = function (x, y) { var i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  var board = -1, boardBottom = -1, lines = [];
  for (var y = 0; y < H; y++) {
    var run = 0, best = 0, brown = 0;
    for (var x = 0; x < W; x++) { var p = px(x, y); if (p[0] > 150 && p[1] > 150 && p[2] > 160) { run++; if (run > best) best = run; } else run = 0; if (Math.abs(p[0] - 42) < 4 && Math.abs(p[1] - 28) < 4 && Math.abs(p[2] - 18) < 4) brown++; }
    if (brown > W * 0.3) { if (board < 0) board = y; boardBottom = y; }
    if (best > W * 0.25) lines.push(y);
  }
  return { board: board, boardBottom: boardBottom, lines: lines, W: W, H: H };
})()`;

for (const mod of ['gtr', 'uke', 'bass']) {
  test(`${mod}: the staff sits above the fretboard, not across it`, async (t) => {
    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());
    await page.evaluate(`window.__coach.setMod('${mod}')`);
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');
    await page.evaluate("window.__coach.setNotate('staff')");
    await page.waitFor('window.__coach.lastStaff() !== null', 5000);
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))');
    const s = await page.evaluate(SCAN);
    assert.ok(s.board >= 0, 'the fretboard is still drawn: ' + JSON.stringify(s));
    // Long light rows are the staff lines (the strings are inside the board box).
    const above = s.lines.filter((y) => y < s.board);
    const inside = s.lines.filter((y) => y >= s.board && y <= s.boardBottom);
    const bands = above.filter((y, i) => i === 0 || y - above[i - 1] > 2).length;
    assert.ok(bands >= 5, `the five staff lines are above the fretboard (found ${bands} above row ${s.board})`);
    // Strings reach the box edge, so any long light row in the box must be one of the strings (<= 6) -- not 6 + staff.
    const inBands = inside.filter((y, i) => i === 0 || y - inside[i - 1] > 2).length;
    assert.ok(inBands <= { gtr: 6, uke: 4, bass: 4 }[mod], `only the strings cross the fretboard (found ${inBands} light lines in it)`);
  });
}

// Voice lanes and keyboard keys get the same treatment: the staff owns the top
// 42% (55% for the keyboard's grand staff) of the canvas, the instrument is drawn below it, so no staff line, clef
// or time signature lands on the lane / hand labels or the keys.
const SCAN2 = `(function () {
  var c = document.getElementById('cv'), img = c.getContext('2d').getImageData(0, 0, c.width, c.height), W = c.width, H = c.height, d = img.data;
  var lines = [], keyTop = -1;
  for (var y = 0; y < H; y++) {
    var run = 0, best = 0, key = 0;
    for (var x = 0; x < W; x++) { var i = (y * W + x) * 4; if (d[i + 3] > 60 && d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 160) { run++; if (run > best) best = run; } else run = 0; if (Math.abs(d[i] - 233) < 4 && Math.abs(d[i + 1] - 237) < 4 && Math.abs(d[i + 2] - 246) < 4) key++; }
    if (best > W * 0.25 && y < H * 0.9) lines.push(y); // below 0.9H is the keyboard overview strip's outline
    if (keyTop < 0 && key > W * 0.3) keyTop = y;
  }
  return { lines: lines, keyTop: keyTop, W: W, H: H };
})()`;

for (const mod of ['voice', 'kbd']) {
  test(`${mod}: the staff sits above the instrument, not across it`, async (t) => {
    const page = await launchPage(HTML_PATH);
    t.after(() => page.close());
    await page.evaluate(`window.__coach.setMod('${mod}')`);
    await page.evaluate("document.getElementById('playBtn').click()");
    await page.waitFor('window.__coach.task()');
    await page.evaluate("window.__coach.setNotate('staff')");
    await page.waitFor('window.__coach.lastStaff() !== null', 5000);
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))');
    const s = await page.evaluate(SCAN2), band = mod === 'kbd' ? 0.55 : 0.42; // the staff band (the keyboard's grand staff is taller)
    const bands = s.lines.filter((y, i) => i === 0 || y - s.lines[i - 1] > 2).length;
    assert.ok(bands >= 5, `the five staff lines are drawn (found ${bands}): ${JSON.stringify(s)}`);
    assert.ok(Math.max(...s.lines) < s.H * band, `every staff line is in the top band: ${JSON.stringify(s)}`);
    if (mod === 'kbd') assert.ok(s.keyTop >= s.H * band, `the keys start below the staff band (keys at ${s.keyTop}, H ${s.H})`);
  });
}
