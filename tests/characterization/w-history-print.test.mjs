// Weekly printable report (src/ui/history.js "Print this week's report"
// button, backed by weeklyReport() in src/core/history.js): renders the
// last 7 days into a printable section and calls window.print(). Chromium
// headless has no real print pipeline, so window.print is replaced with a
// fake before the page's own script runs (same pattern as the wake-lock
// test) and its calls are recorded for the test to inspect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML_PATH } from '../helpers/html-path.mjs';
import { launchPage } from '../helpers/browser.mjs';

const FAKE_PRINT_INIT = `
  window.__printCalls = 0;
  window.print = () => { window.__printCalls++; };
`;

async function seed(page, learnerName) {
  await page.evaluate(`(function () {
    const db = window.__coach.db();
    // The learner's LOCAL day, as app.js stamps sessions -- the UTC date is
    // already tomorrow on a US evening, which put this session off the week.
    const n = new Date();
    const today = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    db.sessions = [
      { d: today, mod: 'kbd', min: 20, acc: 0.7, a1: 0.6, a2: 0.7, from: 1, to: 2, breaks: 0 },
      { d: '2026-01-01', mod: 'gtr', min: 100, acc: 0.5, a1: 0.4, a2: 0.5, from: 1, to: 1, breaks: 0 }, // outside the week window
    ];
    window.localStorage.setItem('bandcoach.v1', JSON.stringify(db));
  })()`);
  await page.reload();
  await page.waitFor('window.__coach && window.__coach.db().mods.kbd', 5000);
  if (learnerName) {
    await page.evaluate('window.__coach.openPanel("history")');
    await page.evaluate(`(function () {
      const input = document.getElementById('historyNameInput');
      input.value = ${JSON.stringify(learnerName)};
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await page.waitFor(`window.__coach.db().panels.history && window.__coach.db().panels.history.learnerName === ${JSON.stringify(learnerName)}`, 5000);
  }
}

test('the "Print this week\'s report" button renders the week and calls window.print, leaving the week-100 session out', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_PRINT_INIT });
  t.after(() => page.close());
  await seed(page);
  await page.evaluate('window.__coach.openPanel("history")');
  await page.evaluate("document.getElementById('historyPrintBtn').click()");

  const printCalls = await page.evaluate('window.__printCalls');
  assert.equal(printCalls, 1);
  // report mode is on while the print dialog is up, so the report-only print CSS applies
  assert.equal(await page.evaluate("document.body.classList.contains('printing-report')"), true);
  await page.evaluate("window.dispatchEvent(new Event('afterprint'))");
  assert.equal(await page.evaluate("document.body.classList.contains('printing-report')"), false, 'report mode must end after printing, so the next print is the page');

  const reportText = await page.evaluate("document.getElementById('historyPrintReport').textContent");
  assert.match(reportText, /20/); // today's 20 minutes
  assert.match(reportText, /Keyboard/);
  assert.doesNotMatch(reportText, /Guitar/); // the 100-min session is outside the 7-day window
});

test('a learner name with markup is escaped, never rendered as live HTML, in the printed report', async (t) => {
  const page = await launchPage(HTML_PATH, { initScript: FAKE_PRINT_INIT });
  t.after(() => page.close());
  await seed(page, '<b>Ada</b>');
  await page.evaluate("document.getElementById('historyPrintBtn').click()");

  const boldCount = await page.evaluate("document.querySelectorAll('#historyPrintReport b').length");
  assert.equal(boldCount, 0);
  const reportText = await page.evaluate("document.getElementById('historyPrintReport').textContent");
  assert.match(reportText, /<b>Ada<\/b>/);
});
