// The acceptance mode of tests/helpers/browser.mjs. The e4b6fb5 hand test was
// rejected for things the permissive harness could not show (docs/release-
// acceptance-record.md), so this pins what must never quietly turn permissive
// again: the flags, the browser choice, what is recorded, and that a click, a
// tab switch and a permission answer are the browser's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  launchPage, browserArgs, findAcceptanceBrowser, acceptanceHtmlPath, withAcceptancePage,
} from '../helpers/browser.mjs';

const fixture = (name) => fileURLToPath(new URL(`../fixtures/acceptance/${name}`, import.meta.url));
const DRIVER = fixture('driver-fixture.html');
const AUDIO_WARNING = /AudioContext was not allowed to start/;
const PERMISSIVE = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'];

function fakeInstall(files) {
  const root = mkdtempSync(join(tmpdir(), 'bc-acc-'));
  for (const f of files) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), '');
  }
  return root;
}

test('browserArgs: the default launch keeps the permissive flags, an acceptance launch drops both', () => {
  const normal = browserArgs('/tmp/p', []);
  for (const f of PERMISSIVE) assert.ok(normal.includes(f), `default launch still passes ${f}`);
  const acc = browserArgs('/tmp/p', ['--use-file-for-fake-audio-capture=/x.wav'], { acceptance: true });
  for (const f of PERMISSIVE) assert.ok(!acc.includes(f), `acceptance launch must not pass ${f}`);
  assert.ok(acc.includes('--use-fake-device-for-media-stream'), 'the simulated microphone device stays');
  assert.ok(acc.includes('--use-file-for-fake-audio-capture=/x.wav'), 'a caller-supplied audio file stays');
});

test('findAcceptanceBrowser: CHROME_BIN first, then the Playwright full build, then google-chrome', () => {
  const root = fakeInstall([
    'ms-playwright/chromium-1100/chrome-linux64/chrome',
    'ms-playwright/chromium-1243/chrome-linux64/chrome',
    'ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
    'bin/google-chrome',
    'mine/chrome',
  ]);
  const base = { playwrightRoot: join(root, 'ms-playwright'), pathDirs: [join(root, 'bin')] };
  assert.equal(findAcceptanceBrowser({ ...base, env: { CHROME_BIN: join(root, 'mine/chrome') } }), join(root, 'mine/chrome'));
  assert.equal(
    findAcceptanceBrowser({ ...base, env: {} }),
    join(root, 'ms-playwright/chromium-1243/chrome-linux64/chrome'),
    'the newest full Playwright build wins',
  );
  assert.equal(
    findAcceptanceBrowser({ playwrightRoot: join(root, 'nowhere'), pathDirs: [join(root, 'bin')], env: {} }),
    join(root, 'bin/google-chrome'),
  );
  rmSync(root, { recursive: true, force: true });
});

test('findAcceptanceBrowser: never the headless shell, and a clear error when nothing else is there', () => {
  const root = fakeInstall([
    'ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
    'bin/chromium',
  ]);
  const shell = join(root, 'ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
  const opts = { playwrightRoot: join(root, 'ms-playwright'), pathDirs: [join(root, 'bin')] };
  assert.throws(
    () => findAcceptanceBrowser({ ...opts, env: {} }),
    (err) => /CHROME_BIN/.test(err.message) && /google-chrome/.test(err.message) && /headless shell/i.test(err.message),
    'only a headless shell and a bare chromium on PATH: say what to install or set',
  );
  assert.throws(
    () => findAcceptanceBrowser({ ...opts, env: { CHROME_BIN: shell } }),
    /headless shell/i,
    'a CHROME_BIN that points at the headless shell is refused, not silently used',
  );
  rmSync(root, { recursive: true, force: true });
});

test('acceptanceHtmlPath: BAND_COACH_HTML when set, else the release build', () => {
  assert.equal(acceptanceHtmlPath({ BAND_COACH_HTML: '/elsewhere/band-coach.html' }), '/elsewhere/band-coach.html');
  assert.equal(
    acceptanceHtmlPath({}),
    fileURLToPath(new URL('../../dist/release/band-coach.html', import.meta.url)),
  );
});

test('acceptance launch: no permissive flags, the identity says what is simulated, and the page was not helped', async (t) => {
  const page = await launchPage(DRIVER, { acceptance: true, simulated: ['a stub that is not a real device'] });
  t.after(() => page.close());
  const id = page.identity;
  for (const f of PERMISSIVE) assert.ok(!id.flags.includes(f), `launched without ${f}`);
  assert.equal(id.html.path, DRIVER);
  assert.match(id.html.sha256, /^[0-9a-f]{64}$/);
  assert.equal(id.html.bytes, readFileSync(DRIVER).length);
  assert.match(id.browser.product, /Chrome/);
  assert.ok(id.simulated.some((s) => /fake microphone device/i.test(s)), 'the fake mic device is declared');
  assert.ok(id.simulated.includes('a stub that is not a real device'), 'a caller-declared stub is declared too');
  // Normal autoplay policy, asked of the page itself.
  const state = await page.evaluate("(() => { const c = new AudioContext(); const s = c.state; c.close(); return s; })()");
  assert.equal(state, 'suspended', 'a context made with no gesture stays suspended, as it does for a person');
});

test('acceptance launch: refuses a page that still carries the debug hook', async () => {
  await assert.rejects(
    () => launchPage(fixture('debug-hook.html'), { acceptance: true }),
    (err) => /window\.__coach/.test(err.message) && /release/i.test(err.message),
  );
});

test('acceptance launch: an AudioContext warning is seen in the browser log and the console warnings', async (t) => {
  const page = await launchPage(fixture('context-on-load.html'), { acceptance: true });
  t.after(() => page.close());
  const deadline = Date.now() + 10000;
  const seen = () => [...page.consoleWarnings, ...page.logEntries.map((e) => e.text)].filter((x) => AUDIO_WARNING.test(x));
  while (!seen().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.ok(seen().length >= 1, `no AudioContext warning recorded: ${JSON.stringify({ w: page.consoleWarnings, l: page.logEntries })}`);
  const entry = page.logEntries.find((e) => AUDIO_WARNING.test(e.text));
  assert.ok(entry && entry.level === 'warning', 'the Log entry carries its level');
  const ctx = page.audio.contexts();
  assert.equal(ctx.length, 1, 'WebAudio reported the one context');
  assert.equal(ctx[0].state, 'suspended');
  assert.equal(page.audio.running().length, 0, 'and none of it is running');
});

test('acceptance launch: requests are recorded with the thing that asked for them', async (t) => {
  const page = await launchPage(DRIVER, { acceptance: true });
  t.after(() => page.close());
  const doc = page.requestDetails.find((r) => r.url === 'file://' + DRIVER);
  assert.ok(doc, `the document request is recorded: ${JSON.stringify(page.requestDetails)}`);
  assert.ok(doc.initiator && typeof doc.initiator.type === 'string', 'with its initiator');
  assert.deepEqual(page.requests, page.requestDetails.map((r) => r.url), 'requests keeps its old shape: URLs only');
});

test('real input: click, tap and drag reach the page as trusted events at the point asked for', async (t) => {
  const page = await launchPage(DRIVER, { acceptance: true });
  t.after(() => page.close());
  const events = () => page.evaluate('window.__events.splice(0)');

  await page.click(100, 40);
  let ev = await events();
  assert.ok(ev.some((e) => e.type === 'click' && e.target === 'hit' && e.trusted && e.x === 100 && e.y === 40), JSON.stringify(ev));

  await page.tap(100, 40);
  ev = await events();
  assert.ok(ev.some((e) => e.type === 'click' && e.target === 'hit' && e.trusted), `a tap becomes a click: ${JSON.stringify(ev)}`);
  assert.ok(ev.some((e) => e.type === 'pointerdown' && e.pointerType === 'touch'), `and it is a touch: ${JSON.stringify(ev)}`);

  await page.drag({ x: 320, y: 40 }, { x: 560, y: 180 });
  ev = await events();
  const moves = ev.filter((e) => e.type === 'pointermove' && e.target === 'pad');
  assert.ok(ev.some((e) => e.type === 'pointerdown' && e.x === 320 && e.y === 40), 'the drag starts where asked');
  assert.ok(moves.length >= 3, `a drag is a run of moves, not a jump: ${moves.length}`);
  assert.ok(ev.some((e) => e.type === 'pointerup' && e.x === 560 && e.y === 180), 'and ends where asked');
});

test('real input: clickSelector clicks the centre of the element and refuses what a person could not click', async (t) => {
  const page = await launchPage(DRIVER, { acceptance: true });
  t.after(() => page.close());
  await page.clickSelector('#hit');
  const ev = await page.evaluate('window.__events.splice(0)');
  const c = ev.find((e) => e.type === 'click');
  assert.equal(c.target, 'hit');
  assert.equal(c.x, 100, 'the centre of a 120px box at left 40');
  assert.equal(c.y, 40, 'the centre of a 40px box at top 20');

  await assert.rejects(() => page.clickSelector('#cover'), /covered|obscured/i, 'a control with something over it is not clickable');
  await assert.rejects(() => page.clickSelector('#nope'), /no element/i);

  await page.clickSelector('#far');
  const far = (await page.evaluate('window.__events.splice(0)')).find((e) => e.type === 'click');
  assert.equal(far.target, 'far', 'a control below the fold is scrolled to first, as a person would');
});

test('permissions: deny and grant are answered by the browser, not by a flag', async (t) => {
  const page = await launchPage(DRIVER, { acceptance: true });
  t.after(() => page.close());
  await page.deny(['microphone']);
  await page.clickSelector('#mic');
  await page.waitFor("document.getElementById('out').textContent !== ''");
  assert.equal(await page.evaluate("document.getElementById('out').textContent"), 'mic:NotAllowedError');

  await page.grant(['microphone']);
  await page.evaluate("document.getElementById('out').textContent = ''");
  await page.clickSelector('#mic');
  await page.waitFor("document.getElementById('out').textContent !== ''");
  assert.equal(await page.evaluate("document.getElementById('out').textContent"), 'mic:granted:1');
});

test('background and return: the page sees real visibilitychange events, hidden then visible', async (t) => {
  const page = await launchPage(DRIVER, { acceptance: true });
  t.after(() => page.close());
  await page.background();
  assert.equal(await page.evaluate('document.visibilityState'), 'hidden');
  await page.foreground();
  assert.equal(await page.evaluate('document.visibilityState'), 'visible');
  const log = await page.visibilityLog();
  assert.deepEqual(log.map((e) => e.state), ['hidden', 'visible']);
  assert.ok(log.every((e) => e.trusted), 'the browser fired them, the test did not');
});

test('audio from outside the page: nothing runs until a real click, then WebAudio reports running', async (t) => {
  const page = await launchPage(DRIVER, { acceptance: true });
  t.after(() => page.close());
  assert.deepEqual(page.audio.contexts(), [], 'no context before anything is clicked');
  await page.clickSelector('#sound');
  await page.audio.waitForRunning();
  assert.equal(page.audio.running().length, 1);
  assert.equal(page.consoleWarnings.concat(page.logEntries.map((e) => e.text)).filter((x) => AUDIO_WARNING.test(x)).length, 0);
});

test('withAcceptancePage: a failing test leaves a screenshot, the logs, the requests and the identity behind', async () => {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'bc-art-'));
  const diagnostics = [];
  const fakeT = { filePath: '/x/acceptance-demo.test.mjs', name: 'it: fails/on purpose', diagnostic: (m) => diagnostics.push(m) };
  await assert.rejects(
    () => withAcceptancePage(fakeT, { htmlPath: DRIVER, artifactRoot }, async (page) => {
      await page.evaluate("console.warn('a warning a person would see')");
      throw new Error('the learner could not start sound');
    }),
    /the learner could not start sound/,
    'the original failure is rethrown, not replaced',
  );
  const dirs = readdirSync(join(artifactRoot, 'acceptance-demo.test.mjs'));
  assert.equal(dirs.length, 1);
  const dir = join(artifactRoot, 'acceptance-demo.test.mjs', dirs[0]);
  assert.match(dirs[0], /fails/);
  assert.deepEqual(
    readdirSync(dir).sort(),
    ['console.json', 'error.txt', 'identity.json', 'log.json', 'requests.json', 'screenshot.png'],
  );
  assert.equal(readFileSync(join(dir, 'screenshot.png')).subarray(1, 4).toString(), 'PNG');
  assert.match(readFileSync(join(dir, 'console.json'), 'utf8'), /a warning a person would see/);
  assert.match(readFileSync(join(dir, 'requests.json'), 'utf8'), /initiator/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'identity.json'), 'utf8')).html.path, DRIVER);
  assert.match(readFileSync(join(dir, 'error.txt'), 'utf8'), /could not start sound/);
  assert.ok(diagnostics.some((d) => /sha256/.test(d)), 'the identity went to t.diagnostic');
  rmSync(artifactRoot, { recursive: true, force: true });
});

test('withAcceptancePage: a passing test writes no artifacts and still closes its browser', async () => {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'bc-art-'));
  let profileDir;
  await withAcceptancePage({ filePath: '/x/ok.test.mjs', name: 'passes', diagnostic() {} }, { htmlPath: DRIVER, artifactRoot }, async (page) => {
    profileDir = page.profileDir;
  });
  assert.ok(!existsSync(join(artifactRoot, 'ok.test.mjs')), 'nothing written for a pass');
  assert.ok(!existsSync(profileDir), 'the browser profile was removed, so the browser was closed');
  rmSync(artifactRoot, { recursive: true, force: true });
});
