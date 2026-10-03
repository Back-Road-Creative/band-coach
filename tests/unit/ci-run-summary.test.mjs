// build/ci-summary.mjs turns the two CI step logs into a verdict. The plan asks
// that "a cancelled test file cannot produce readiness" and that retry-only
// passes, skips and cancellations be visible, and nothing computed that.
//
// Nothing here is hand-typed TAP. Each case runs a real `node --test` child on a
// fixture under tests/fixtures/ci-summary/ and puts npm's own banner text around
// the output, so the parser is held to what node 22 prints, not to what the
// author remembers it printing. The two npm cases (C15, C15b) run a real npm in
// a throwaway package.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIST_CAP, renderMarkdown, summarise } from '../../build/ci-summary.mjs';

const fixture = (name) => fileURLToPath(new URL('../fixtures/ci-summary/' + name, import.meta.url));
const FLAKY_ONCE = fileURLToPath(new URL('../fixtures/acceptance/flaky-once.mjs', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../build/ci-summary.mjs', import.meta.url));

// A live top-level `node --test` run, as a CI log would hold it. A test file
// runs inside node's own runner, which marks its environment so a nested run
// refuses to start; the child must be told it is a fresh top-level run
// (retry-flaky.test.mjs does the same). Output goes to a FILE, as the probe
// did, so stdout and stderr keep their order.
const scratch = mkdtempSync(join(tmpdir(), 'ci-summary-'));
let seq = 0;
function live(file, extra = []) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const out = join(scratch, `live-${seq++}.log`);
  const fd = openSync(out, 'w');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...extra, file], { env, stdio: ['ignore', fd, fd] });
    child.on('error', reject);
    child.on('close', (status) => { closeSync(fd); resolve({ text: readFileSync(out, 'utf8'), status }); });
  });
}

// npm's banner, exactly as the probe saw it: a blank line, `> name@version
// script`, `> command`, a blank line, all on stdout.
const banner = (script, command) => `\n> toy@1.0.0 ${script}\n> ${command}\n\n`;
const MAIN_CMD = 'node --test --test-concurrency=$(node tests/helpers/browser.mjs) "tests/*.test.mjs" "tests/build/*.test.mjs"';
const REL_CMD = 'node build/build.mjs --release && node --test "tests/release/*.test.mjs"';
const suiteLog = (main, release) =>
  banner('pretest', 'npm run build') + banner('build', 'node build/build.mjs') + 'built\n'
  + banner('test', MAIN_CMD) + main
  + (release === undefined ? '' : banner('posttest', 'npm run gate') + banner('gate', REL_CMD) + release);

// One CI run on disk: $RUNNER_TEMP/{gate,suite}.{log,rc} and a root with dist/.
function world({ gateLog, suiteLog: suite, gateRc = 0, suiteRc = 0, files = {}, env = {} } = {}) {
  const dir = mkdtempSync(join(scratch, 'w-'));
  const rt = join(dir, 'rt');
  const root = join(dir, 'root');
  mkdirSync(rt, { recursive: true });
  mkdirSync(root, { recursive: true });
  if (gateLog !== undefined) writeFileSync(join(rt, 'gate.log'), gateLog);
  if (suite !== undefined) writeFileSync(join(rt, 'suite.log'), suite);
  if (gateRc !== null) writeFileSync(join(rt, 'gate.rc'), `${gateRc}\n`);
  if (suiteRc !== null) writeFileSync(join(rt, 'suite.rc'), `${suiteRc}\n`);
  for (const [rel, bytes] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), bytes);
  }
  return { dir, rt, root, env: { RUNNER_TEMP: rt, GATE_OUTCOME: 'success', SUITE_OUTCOME: 'success', ...env } };
}
const judge = (opts) => { const w = world(opts); return summarise({ root: w.root, env: w.env }); };
const tail = (text, n) => text.split('\n').slice(0, n).join('\n');

let L; // the live runs, generated once, concurrently
before(async () => {
  const names = {
    pass: [fixture('pass.mjs')],
    flaky: [FLAKY_ONCE],
    skip: [fixture('skip.mjs')],
    pending: [fixture('cancel-pending.mjs')],
    timeout: [fixture('cancel-timeout.mjs'), []],
    fail: [fixture('fail.mjs')],
    todoPass: [fixture('todo-reasoned-pass.mjs')],
    todoBare: [fixture('todo-bare.mjs')],
    todoFail: [fixture('todo-failing.mjs')],
    hash: [fixture('hash-names.mjs')],
    many: [fixture('many-todos.mjs')],
  };
  const keys = Object.keys(names);
  const runs = await Promise.all(keys.map((k) => live(names[k][0], k === 'timeout' ? ['--test-timeout=300'] : [])));
  L = Object.fromEntries(keys.map((k, i) => [k, runs[i].text]));
  L.status = Object.fromEntries(keys.map((k, i) => [k, runs[i].status]));
});

test('C0 negative control: an all-pass release block with rc 0 is READY, and the CLI exits 0', () => {
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.pass) });
  assert.equal(s.verdict, 'READY');
  assert.deepEqual(s.reasons, []);
  assert.equal(s.release.length, 1, 'the posttest gate block is found by its banner');
  assert.equal(s.release[0].summary.tests, 2);
  assert.equal(s.release[0].summary.pass, 2);

  const w = world({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.pass) });
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: w.root, encoding: 'utf8', env: { PATH: process.env.PATH, ...w.env } });
  assert.equal(r.status, 0, `READY exits 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /READY/, 'the markdown goes to stdout when GITHUB_STEP_SUMMARY is unset');
  assert.doesNotMatch(r.stdout, /NOT READY/);
  const json = JSON.parse(readFileSync(join(w.root, 'dist/test-artifacts/run-summary.json'), 'utf8'));
  assert.equal(json.verdict, 'READY');
  assert.ok(!existsSync(join(w.root, 'dist/test-artifacts/suite.log')), 'a clean run does not copy its logs');
});

test('C1 a retry inside the release block is NOT READY and names what was retried', () => {
  assert.equal(L.status.flaky, 0, 'the fixture passes on its second attempt');
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.flaky) });
  assert.equal(s.verdict, 'NOT READY');
  assert.equal(s.release[0].retries.length, 1);
  assert.equal(s.release[0].retries[0].what, 'the pitch spread');
  assert.match(s.release[0].retries[0].line, /discarded attempt 1: spread 47 cents/);
  assert.ok(s.reasons.some((r) => /retry/i.test(r) && /the pitch spread/.test(r)), s.reasons.join(' | '));
});

test('C2 a retry in the main suite alone is READY, and is still reported there', () => {
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.flaky, L.pass) });
  assert.equal(s.verdict, 'READY', s.reasons.join(' | '));
  const main = s.steps.suite.blocks.find((b) => b.banner && b.banner.script === 'test');
  assert.ok(main, 'the main block is named by its banner');
  assert.equal(main.retries.length, 1);
  assert.equal(main.retries[0].what, 'the pitch spread');
});

test('C3 a skip in the release block is NOT READY and quotes the reason', () => {
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.skip) });
  assert.equal(s.verdict, 'NOT READY');
  assert.equal(s.release[0].summary.skipped, 1);
  assert.deepEqual(s.release[0].skips, [{ name: 'needs a device', reason: 'no MIDI device on this runner' }]);
  assert.ok(s.reasons.some((r) => /skip/i.test(r) && r.includes('no MIDI device on this runner')), s.reasons.join(' | '));
});

test('C4a a test that never settles is cancelled, so NOT READY', () => {
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.pending) });
  assert.equal(s.verdict, 'NOT READY');
  assert.equal(s.release[0].summary.cancelled, 1);
  assert.deepEqual(s.release[0].failures.map((f) => f.failureType), ['cancelledByParent']);
  assert.ok(s.reasons.some((r) => /cancel/i.test(r)), s.reasons.join(' | '));
});

test('C4b a file that times out is cancelled with fail 0, so NOT READY', () => {
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.timeout) });
  assert.equal(s.verdict, 'NOT READY');
  assert.equal(s.release[0].summary.cancelled, 1);
  assert.equal(s.release[0].summary.fail, 0, 'a timeout is not a `# fail`; only the cancelled count catches it');
  assert.deepEqual(s.release[0].failures.map((f) => f.failureType), ['testTimeoutFailure']);
  assert.ok(s.reasons.some((r) => /cancel/i.test(r)), s.reasons.join(' | '));
});

test('C5 a throwing release test is NOT READY and names the failure type', () => {
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.fail) });
  assert.equal(s.verdict, 'NOT READY');
  assert.equal(s.release[0].summary.fail, 1);
  assert.deepEqual(s.release[0].failures, [{ name: 'throws', failureType: 'testCodeFailure' }]);
  assert.ok(s.reasons.some((r) => /fail/i.test(r)), s.reasons.join(' | '));
});

test('C6 a reasoned todo that now passes is NOT READY, quoting its reason', () => {
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.todoPass) });
  assert.equal(s.verdict, 'NOT READY');
  assert.deepEqual(s.release[0].todos.reasoned, [{ name: 'known bug that now passes', reason: 'F1: fix not landed' }]);
  assert.ok(s.reasons.some((r) => r.includes('F1: fix not landed')), s.reasons.join(' | '));
});

test('C7 a bodyless todo is READY, and listed under the no-reason todos', () => {
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.todoBare) });
  assert.equal(s.verdict, 'READY', s.reasons.join(' | '));
  assert.deepEqual(s.release[0].todos.bare, ['not written yet']);
  assert.deepEqual(s.release[0].todos.reasoned, []);
  assert.equal(s.release[0].summary.todo, 1);
});

test('C8 a todo that still fails is READY, and does not count as a failure', () => {
  assert.equal(L.status.todoFail, 0, 'node exits 0 when the only non-pass is a failing todo');
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.todoFail) });
  assert.equal(s.verdict, 'READY', s.reasons.join(' | '));
  assert.equal(s.release[0].summary.fail, 0);
  assert.deepEqual(s.release[0].todos.failing, [{ name: 'known bug still red', reason: 'F9: still red' }]);
  assert.deepEqual(s.release[0].failures, []);
});

test('C9 no release block is NOT READY, whatever the gate step log holds', () => {
  // The suite log stops after the main block; the gate log holds a complete
  // gate.test.mjs block with no banner. Picking the last block, or the gate
  // step's block, would find a clean block and call this READY.
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, undefined) });
  assert.equal(s.verdict, 'NOT READY');
  assert.deepEqual(s.release, []);
  assert.ok(s.reasons.some((r) => /no release block/i.test(r)), s.reasons.join(' | '));
});

test('C10 a release block cut off before its summary lines is NOT READY and invents no counts', () => {
  const cut = L.pass.slice(0, L.pass.indexOf('# tests'));
  assert.ok(cut.length > 0 && !/^# tests/m.test(cut), 'the fixture log really is truncated');
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, cut) });
  assert.equal(s.verdict, 'NOT READY');
  assert.equal(s.release[0].cutOff, true);
  assert.equal(s.release[0].summary, null, 'no counts are invented');
  assert.ok(s.reasons.some((r) => /cut off/i.test(r)), s.reasons.join(' | '));
});

test('C11 a # inside a test name is not a directive', () => {
  assert.match(L.hash, /fix \\#12 case/, 'node escapes the # in a name, which is what the parser must tolerate');
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.hash) });
  assert.equal(s.verdict, 'READY', s.reasons.join(' | '));
  const r = s.release[0];
  assert.deepEqual([r.todos.reasoned, r.todos.bare, r.todos.failing, r.skips], [[], [], [], []]);
  assert.equal(r.summary.todo, 0);
});

test('C12 the reported bytes and sha256 are the RELEASE file, not the dev build', () => {
  const rel = Buffer.from('<html>release candidate</html>');
  const dev = Buffer.from('<html>dev build with a debug hook, longer than the release</html>');
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.pass), files: { 'dist/release/band-coach.html': rel, 'dist/band-coach.html': dev } });
  assert.equal(s.facts.releaseBytes, rel.length);
  assert.equal(s.facts.releaseSha256, createHash('sha256').update(rel).digest('hex'));
  const none = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.pass), files: { 'dist/band-coach.html': dev } });
  assert.equal(none.facts.releaseBytes, 'absent');
  assert.equal(none.facts.releaseSha256, 'absent');
});

test('C13 a missing log or rc is "not run", never a pass', () => {
  const noSuite = judge({ gateLog: L.pass, suiteLog: undefined, suiteRc: null });
  assert.equal(noSuite.verdict, 'NOT READY');
  assert.equal(noSuite.steps.suite.log, 'not run');
  assert.equal(noSuite.steps.suite.rc, 'not run');
  assert.match(renderMarkdown(noSuite), /not run/);

  const noRc = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.pass), suiteRc: null });
  assert.equal(noRc.verdict, 'NOT READY');
  assert.equal(noRc.steps.suite.rc, 'not run');
  assert.ok(noRc.reasons.some((r) => /rc|exit/i.test(r) && /not run|missing/i.test(r)), noRc.reasons.join(' | '));

  // The gate step alone being unread does not change a verdict the suite proves.
  const noGate = judge({ gateLog: undefined, gateRc: null, suiteLog: suiteLog(L.pass, L.pass) });
  assert.equal(noGate.steps.gate.log, 'not run');
  assert.equal(noGate.verdict, 'READY', noGate.reasons.join(' | '));

  // RUNNER_TEMP unset or empty never falls back to os.tmpdir().
  const w = world({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.pass) });
  for (const env of [{}, { RUNNER_TEMP: '' }]) {
    const s = summarise({ root: w.root, env });
    assert.equal(s.steps.suite.log, 'not run');
    assert.equal(s.verdict, 'NOT READY');
  }
});

test('C14 a clean release block with a non-zero suite rc is NOT READY', () => {
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.pass), suiteRc: 1 });
  assert.equal(s.verdict, 'NOT READY');
  assert.ok(s.reasons.some((r) => /rc 1|exit 1|exit code 1/i.test(r)), s.reasons.join(' | '));
});

// The facts a person reads next to the verdict. Chrome comes from CHROME_BIN.
test('C16 facts: the Chrome version, node, commit and outcomes are reported, "unknown" when absent', () => {
  const dir = mkdtempSync(join(scratch, 'chrome-'));
  const fake = join(dir, 'chrome');
  writeFileSync(fake, '#!/bin/sh\necho "Google Chrome 130.0.6723.58 "\n');
  chmodSync(fake, 0o755);
  const s = judge({
    gateLog: L.pass, suiteLog: suiteLog(L.pass, L.pass),
    env: { CHROME_BIN: fake, GITHUB_SHA: 'abc123', GITHUB_REF: 'refs/pull/9/merge', GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: '2', SOURCE_DATE_EPOCH: '1760000000', GATE_OUTCOME: 'success', SUITE_OUTCOME: '' },
  });
  assert.equal(s.facts.chrome, 'Google Chrome 130.0.6723.58');
  assert.equal(s.facts.node, process.version);
  assert.deepEqual(
    [s.facts.sha, s.facts.ref, s.facts.event, s.facts.runId, s.facts.runAttempt, s.facts.epoch],
    ['abc123', 'refs/pull/9/merge', 'pull_request', '77', '2', '1760000000'],
  );
  assert.equal(s.steps.gate.outcome, 'success');
  assert.equal(s.steps.suite.outcome, 'unknown', 'an empty outcome is "unknown", not a pass');
  const bare = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.pass), env: { CHROME_BIN: join(dir, 'missing') } });
  assert.equal(bare.facts.chrome, 'unknown');
  assert.equal(bare.facts.sha, 'unknown');
});

test('C17 CLI on NOT READY: exit 1, JSON written, both logs copied, markdown appended to the step summary', () => {
  const w = world({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.flaky) });
  const summaryFile = join(w.dir, 'step-summary.md');
  writeFileSync(summaryFile, 'earlier step\n');
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: w.root, encoding: 'utf8', env: { PATH: process.env.PATH, ...w.env, GITHUB_STEP_SUMMARY: summaryFile } });
  assert.equal(r.status, 1, `NOT READY exits 1 on every event:\n${r.stdout}\n${r.stderr}`);
  const json = JSON.parse(readFileSync(join(w.root, 'dist/test-artifacts/run-summary.json'), 'utf8'));
  assert.equal(json.verdict, 'NOT READY');
  assert.equal(json.release[0].retries[0].what, 'the pitch spread');
  assert.equal(readFileSync(join(w.root, 'dist/test-artifacts/suite.log'), 'utf8'), readFileSync(join(w.rt, 'suite.log'), 'utf8'));
  assert.equal(readFileSync(join(w.root, 'dist/test-artifacts/gate.log'), 'utf8'), L.pass);
  const md = readFileSync(summaryFile, 'utf8');
  assert.ok(md.startsWith('earlier step\n'), 'appended, never overwritten');
  assert.match(md, /NOT READY/);
  assert.match(md, /the pitch spread/);
  assert.match(r.stderr, /NOT READY/, 'the step log itself says why the job failed');
});

test('C18 a long list is capped in the markdown only: counts and JSON stay exact, and the cap never decides the verdict', () => {
  assert.ok(LIST_CAP > 0 && LIST_CAP < 80, `LIST_CAP is ${LIST_CAP}; the fixture declares 80 todos`);
  const s = judge({ gateLog: L.pass, suiteLog: suiteLog(L.pass, L.many) });
  assert.equal(s.verdict, 'READY', s.reasons.join(' | '));
  assert.equal(s.release[0].summary.todo, 80);
  assert.equal(s.release[0].todos.bare.length, 80, 'the JSON holds every item');
  const md = renderMarkdown(s);
  const shown = md.split('\n').filter((l) => l.includes('declared but not written')).length;
  assert.equal(shown, LIST_CAP);
  assert.match(md, new RegExp(`${80 - LIST_CAP} more`));
});

// Real npm, in a throwaway package: the banner text is whatever this npm
// prints, so a change in its format fails here instead of silently on CI.
const toyPackage = () => {
  const dir = mkdtempSync(join(scratch, 'npm-'));
  mkdirSync(join(dir, 'tests/release'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'toy', version: '1.0.0', private: true, type: 'module',
    scripts: {
      pretest: 'npm run build',
      build: 'node -e "console.log(\'building\')"',
      test: 'node --test "tests/*.test.mjs"',
      posttest: 'npm run gate',
      gate: 'node -e "console.log(\'release build\')" && node --test "tests/release/*.test.mjs"',
    },
  }));
  writeFileSync(join(dir, 'tests/main.test.mjs'), "import { test } from 'node:test';\ntest('main works', () => {});\n");
  writeFileSync(join(dir, 'tests/release/a.test.mjs'),
    "import { test } from 'node:test';\ntest('a pass', () => {});\ntest('known bug', { todo: 'F1: not fixed' }, () => {});\ntest.todo('not written');\n");
  return dir;
};
function npmRun(dir, args) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^npm_/i.test(k) && k !== 'NODE_TEST_CONTEXT') env[k] = v;
  env.NO_UPDATE_NOTIFIER = '1';
  env.npm_config_update_notifier = 'false';
  const out = join(dir, `npm-${args.join('-').replace(/\W+/g, '_')}.log`);
  const fd = openSync(out, 'w');
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd: dir, env, stdio: ['ignore', fd, fd] });
    child.on('error', (e) => reject(new Error(`npm could not run in the throwaway package: ${e.message}`)));
    child.on('close', (status) => { closeSync(fd); resolve({ text: readFileSync(out, 'utf8'), status }); });
  });
}
function lastCounts(text) {
  const n = {};
  for (const m of text.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/gm)) n[m[1]] = Number(m[2]);
  return n;
}

test('C15 real npm lifecycle: the release block is found by npm\'s own banner, after the posttest banner', async () => {
  const { text, status } = await npmRun(toyPackage(), ['test', '--ignore-scripts=false']);
  assert.equal(status, 0, text);
  const s = judge({ suiteLog: text, gateLog: undefined, gateRc: null });
  assert.equal(s.release.length, 1, text);
  assert.equal(s.release[0].banner.script, 'gate');
  assert.deepEqual(s.release[0].summary, { ...lastCounts(text), duration_ms: s.release[0].summary.duration_ms });
  assert.equal(s.release[0].summary.tests, 3, 'the release block, not the one-test main block');
  assert.equal(s.release[0].todos.reasoned.length, 1);
  assert.equal(s.release[0].todos.bare.length, 1);
  assert.equal(s.verdict, 'NOT READY', 'the reasoned todo passes');
});

test('C15b local shape: `npm run gate` directly has no posttest banner before the gate banner, and is still found', async () => {
  const { text, status } = await npmRun(toyPackage(), ['run', 'gate', '--ignore-scripts=false']);
  assert.equal(status, 0, text);
  assert.doesNotMatch(text, /posttest/);
  const s = judge({ suiteLog: text, gateLog: undefined, gateRc: null });
  assert.equal(s.release.length, 1, text);
  assert.equal(s.release[0].summary.tests, 3);
  assert.deepEqual(s.release[0].summary, { ...lastCounts(text), duration_ms: s.release[0].summary.duration_ms });
});
