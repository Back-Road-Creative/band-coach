// Empty states and alignment, on the release file a person downloads. A learner who opens Progress
// before any session sees a way to start one (and no empty calendar); a first visit to Songs leads with
// the song list and "Add a song", the teacher tools tucked under "For teachers"; Settings starts at the
// same left edge as Practice; and on a phone no screen leaves a dead strip of ~80px between its parts.
// Everything is read from the screen (rects, text); the learner acts only by clicking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAcceptancePage } from '../helpers/browser.mjs';

const seed = `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' } }));`;
const go = (page, route) => page.clickSelector(`#mainNav button[data-route="${route}"]`);
const rect = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; })()`);
const visible = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0 && e.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }); })()`);
const PHONE = { width: 390, height: 844, mobile: true, deviceScaleFactor: 3 };

test('Progress with no sessions: a Start control that begins a session, and no empty calendar', async (t) => {
  await withAcceptancePage(t, { initScript: seed }, async (page) => {
    await go(page, 'progress');
    assert.equal(await visible(page, '#historyCalendar'), false, 'no calendar before there is any data');
    assert.equal(await visible(page, '#historyGoalInput'), false, 'no goal box before there is any data');
    await page.waitFor("[...document.querySelectorAll('#panelHost button')].some(b => b.textContent.trim() === 'Start your first session')");
    await page.clickSelector('#historyStartBtn');
    await page.waitFor("!document.getElementById('endBtn').hidden");
    assert.equal(await visible(page, '#mainArea'), true, 'the Practice screen is showing');
    assert.equal(await visible(page, '#panelHost'), false, 'Progress is closed');
  });
});

test('Progress with sessions: the calendar is there and the Start control is not', async (t) => {
  const n = new Date(), day = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  const withData = `localStorage.setItem('bandcoach.v1', JSON.stringify({ prefs: { mod: 'kbd' }, sessions: [{ d: ${JSON.stringify(day)}, mod: 'kbd', min: 5, acc: 0.8, a1: 0.8, a2: 0.8, from: 1, to: 1, breaks: 0 }] }));`;
  await withAcceptancePage(t, { initScript: withData }, async (page) => {
    await go(page, 'progress');
    await page.waitFor("document.getElementById('historySummary').textContent.trim() !== ''");
    assert.match(await page.evaluate("document.getElementById('historySummary').textContent"), /1 session/);
    assert.equal(await visible(page, '#historyCalendar'), true);
    assert.equal(await visible(page, '#historyStartBtn'), false);
  });
});

test('Songs first visit: Add a song, then the list, then the teacher tools under "For teachers"', async (t) => {
  await withAcceptancePage(t, { initScript: seed }, async (page) => {
    await go(page, 'songs');
    await page.waitFor("document.querySelectorAll('.panel-songs-list li').length > 0");
    const add = await rect(page, '.add-song-row button');
    const row = await rect(page, '.panel-songs-list li');
    const teachers = await rect(page, '.panel-songs-teachers > summary');
    assert.ok(teachers, 'a "For teachers" disclosure exists');
    assert.equal(await page.evaluate("document.querySelector('.panel-songs-teachers > summary').textContent.trim()"), 'For teachers');
    assert.ok(add.top < row.top, `Add a song (${add.top}) is above the list (${row.top})`);
    assert.ok(row.top < teachers.top, `the list (${row.top}) is above For teachers (${teachers.top})`);
    assert.equal(await visible(page, '#challengeTitleInput'), false, 'the export box is tucked away until asked for');
    await page.clickSelector('.panel-songs-teachers > summary');
    assert.equal(await visible(page, '#challengeTitleInput'), true, 'opening For teachers shows the Assignments tools');
    assert.equal(await page.evaluate("!!document.querySelector('.panel-songs-teachers .panel-songs-assignments')"), true);
  });
});

test('Settings starts at the same left edge as Practice (1366x768)', async (t) => {
  await withAcceptancePage(t, { initScript: seed }, async (page) => {
    await page.setViewport({ width: 1366, height: 768 });
    await go(page, 'practice');
    const practice = await rect(page, '#mainArea');
    await go(page, 'settings');
    const settings = await rect(page, '#settingsView');
    assert.equal(Math.round(settings.left), Math.round(practice.left), `settings x ${settings.left} vs practice x ${practice.left}`);
  });
});

test('Phone (390x844): Songs and Progress start within 24px of the status row', async (t) => {
  await withAcceptancePage(t, { initScript: seed }, async (page) => {
    await page.setViewport(PHONE);
    for (const route of ['songs', 'progress']) {
      await go(page, route);
      await page.waitFor("document.getElementById('panelHost').children.length > 0");
      const io = await rect(page, '.io');
      const host = await rect(page, '#panelHost');
      assert.ok(host.top - io.bottom <= 24, `${route}: gap under the status row ${host.top - io.bottom}px`);
    }
  });
});

// Was 81.6px at 390x844 mid-session: the feedback card's reserved slot (hidden, kept in the layout so the first feedback
// never moves the canvas). Now the feedback card shares the level card's grid cell and shows OVER it, so no slot is
// reserved and no strip is left; the cell is as tall as the taller of the two, so the canvas still does not move
// (acceptance-phone-practice T4) and the feedback stays on the first screen (T2).
test('Phone (390x844) mid-session: no dead strip over 24px between the level card and the stage', async (t) => {
  await withAcceptancePage(t, { initScript: seed }, async (page) => {
    await page.setViewport(PHONE);
    await go(page, 'practice');
    await page.clickSelector('#playBtn');
    await page.waitFor("!document.getElementById('endBtn').hidden");
    const level = await rect(page, '#levelCard');
    const stage = await rect(page, '.stage');
    assert.ok(stage.top - level.bottom <= 24, `level card to stage gap ${stage.top - level.bottom}px`);
  });
});
