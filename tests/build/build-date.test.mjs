// The release build's footer says `built YYYY-MM-DD`. That date comes from the
// commit being built (not the day the build ran), so two release builds of one
// commit -- the staged file and the published file -- are the same bytes.
// SOURCE_DATE_EPOCH still wins when set. A tree that is not the top of a git
// work tree, or a git that fails, falls back to the wall clock with one stderr
// line and never fails the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, realpathSync, readFileSync, rmSync, symlinkSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(import.meta.url), '..', '..', '..');
const utcDate = () => new Date().toISOString().slice(0, 10);

// realpath matters: build.mjs only runs its CLI when import.meta.url equals
// process.argv[1], so a symlinked tmpdir would make a build a silent no-op.
function tmp(prefix) { return realpathSync(mkdtempSync(join(tmpdir(), prefix))); }

function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'SOURCE_DATE_EPOCH' || k.toUpperCase().startsWith('GIT_')) continue;
    env[k] = v;
  }
  return env;
}

const hooks = tmp('bc-date-hooks-');
function git(cwd, args, extraEnv = {}) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + hooks, ...args], {
    cwd, encoding: 'utf8', env: { ...cleanEnv(), ...extraEnv },
  });
  assert.equal(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout;
}
function commit(dir, authorDate, committerDate) {
  git(dir, ['init', '-q']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 't'], { GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: committerDate });
}

function copyTree(dir) {
  mkdirSync(dir, { recursive: true });
  cpSync(join(REPO, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(REPO, 'build'), join(dir, 'build'), { recursive: true });
  cpSync(join(REPO, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'dir');
}

// A copy of the build inputs that is itself a git repo: author date 1999,
// committer date 2001, so %at and %ct give different answers.
function makeTree(made) {
  const dir = tmp('bc-date-tree-');
  made.push(dir);
  copyTree(dir);
  commit(dir, '1999-01-01T00:00:00Z', '2001-02-03T00:00:00Z');
  return dir;
}

function release(dir, env, flags = ['--release']) {
  const r = spawnSync(process.execPath, ['build/build.mjs', ...flags], { cwd: dir, encoding: 'utf8', env });
  let footer = null;
  const file = join(dir, 'dist', 'release', 'band-coach.html');
  if (existsSync(file)) {
    const m = /<footer id="verFooter"[^>]*>[^<]*(built \d{4}-\d{2}-\d{2})/.exec(readFileSync(file, 'utf8'));
    footer = m && m[1];
  }
  return { rc: r.status, stderr: r.stderr, footer };
}

function setup(t) {
  const made = [];
  t.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
  return made;
}

test('A. a release build is dated from the commit (committer time), not the day it ran', (t) => {
  const made = setup(t);
  const dir = makeTree(made);
  const r = release(dir, cleanEnv());
  assert.equal(r.rc, 0, r.stderr);
  assert.equal(r.footer, 'built 2001-02-03');
  assert.doesNotMatch(r.stderr, /wall clock/i);
});

test('B. SOURCE_DATE_EPOCH wins over the commit (negative control)', (t) => {
  const made = setup(t);
  const dir = makeTree(made);
  const r = release(dir, { ...cleanEnv(), SOURCE_DATE_EPOCH: '1700000000' });
  assert.equal(r.rc, 0, r.stderr);
  assert.equal(r.footer, 'built 2023-11-14');
  assert.doesNotMatch(r.stderr, /wall clock/i);
});

test('C. a copy inside another repo does not take that repo\'s date: wall clock plus one stderr line', (t) => {
  const made = setup(t);
  const outer = tmp('bc-date-outer-');
  made.push(outer);
  commit(outer, '2003-04-05T00:00:00Z', '2003-04-05T00:00:00Z');
  const app = join(outer, 'app');
  copyTree(app);
  const before = utcDate();
  const r = release(app, cleanEnv());
  const after = utcDate();
  assert.equal(r.rc, 0, r.stderr);
  assert.notEqual(r.footer, 'built 2003-04-05');
  assert.ok(r.footer === 'built ' + before || r.footer === 'built ' + after, `footer ${r.footer} is not today (${before}/${after})`);
  const lines = r.stderr.split(/\r?\n/).filter((l) => /wall clock/i.test(l));
  assert.equal(lines.length, 1, 'stderr was: ' + r.stderr);
});

test('D. an inherited GIT_DIR cannot redirect the lookup to another repo', (t) => {
  const made = setup(t);
  const outer = tmp('bc-date-outer-');
  made.push(outer);
  commit(outer, '2003-04-05T00:00:00Z', '2003-04-05T00:00:00Z');
  const dir = makeTree(made);
  const r = release(dir, { ...cleanEnv(), GIT_DIR: join(outer, '.git') });
  assert.equal(r.rc, 0, r.stderr);
  assert.equal(r.footer, 'built 2001-02-03');
});

test('E. the dev build never asks git; the release build does', { skip: process.platform === 'win32' && 'the fake git is a shell script' }, (t) => {
  const made = setup(t);
  const dir = makeTree(made);
  const bin = tmp('bc-date-fakegit-');
  made.push(bin);
  const marker = join(bin, 'asked');
  writeFileSync(join(bin, 'git'), `#!/bin/sh\necho asked >> "${marker}"\nexit 1\n`);
  chmodSync(join(bin, 'git'), 0o755);
  const env = { ...cleanEnv(), PATH: bin + delimiter + process.env.PATH };
  const dev = release(dir, env, []);
  assert.equal(dev.rc, 0, dev.stderr);
  assert.equal(existsSync(marker), false, 'the dev build ran git');
  const rel = release(dir, env);
  assert.equal(rel.rc, 0, rel.stderr);
  assert.equal(existsSync(marker), true, 'the release build never asked git');
});

// ---- F. the resolver, with an injected git ----

async function resolver() { return (await import('../../build/build.mjs')).resolveBuildDate; }
const NOW = Date.UTC(2030, 5, 7, 12, 0, 0);
const today = new Date(NOW).toISOString().slice(0, 10);
const now = () => NOW;
// answers rev-parse with `top`, and anything else (the log) with `logAnswer`.
function fakeRun(top, logAnswer, calls = []) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return args.includes('rev-parse') ? { status: 0, stdout: top } : logAnswer;
  };
}

test('F1. the commit time from git gives a commit date', async (t) => {
  const made = setup(t);
  const root = tmp('bc-date-root-'); made.push(root);
  assert.equal(Date.UTC(2001, 1, 3) / 1000, 981158400);
  const calls = [];
  const r = (await resolver())({ env: {}, root, now, run: fakeRun(root + '\n', { status: 0, stdout: '981158400\n' }, calls) });
  assert.equal(r.source, 'commit');
  assert.equal(r.date, '2001-02-03');
  assert.equal(r.reason, undefined);
  const log = calls.find((c) => c.args.includes('log'));
  assert.ok(log.args.includes('--format=%ct'), 'asks for committer time: ' + log.args);
  for (const c of calls) {
    assert.equal(c.cmd, 'git');
    assert.equal(c.opts.cwd, root);
    assert.ok(c.opts.timeout > 0, 'a timeout is set');
  }
});

test('F2. output that is not a number falls back to the wall clock', async (t) => {
  const made = setup(t);
  const root = tmp('bc-date-root-'); made.push(root);
  for (const stdout of ['abc\n', '', '12abc\n', '-5\n', '1.5\n']) {
    const r = (await resolver())({ env: {}, root, now, run: fakeRun(root, { status: 0, stdout }) });
    assert.equal(r.source, 'wall-clock', JSON.stringify(stdout));
    assert.match(r.reason, /not a number/);
    assert.equal(r.date, today);
  }
});

test('F3. git missing falls back and says so', async (t) => {
  const made = setup(t);
  const root = tmp('bc-date-root-'); made.push(root);
  const r = (await resolver())({ env: {}, root, now, run: () => ({ error: { code: 'ENOENT' }, status: null }) });
  assert.equal(r.source, 'wall-clock');
  assert.match(r.reason, /git is missing/);
  assert.equal(r.date, today);
});

test('F4. a git that times out or fails falls back, quoting git\'s first stderr line', async (t) => {
  const made = setup(t);
  const root = tmp('bc-date-root-'); made.push(root);
  const f = await resolver();
  const timedOut = f({ env: {}, root, now, run: fakeRun(root, { error: { code: 'ETIMEDOUT' }, status: null }) });
  assert.equal(timedOut.source, 'wall-clock');
  assert.match(timedOut.reason, /git failed/);
  assert.equal(timedOut.date, today);
  const dubious = f({ env: {}, root, now, run: fakeRun(root, { status: 128, stderr: 'fatal: detected dubious ownership in repository\nmore\n' }) });
  assert.equal(dubious.source, 'wall-clock');
  assert.match(dubious.reason, /git failed/);
  assert.match(dubious.reason, /detected dubious ownership/);
  assert.doesNotMatch(dubious.reason, /\n|more/);
  assert.equal(dubious.date, today);
  const signalled = f({ env: {}, root, now, run: fakeRun(root, { status: null, signal: 'SIGKILL' }) });
  assert.match(signalled.reason, /git failed/);
  const notRepo = f({ env: {}, root, now, run: () => ({ status: 128, stderr: 'fatal: not a git repository\n' }) });
  assert.equal(notRepo.source, 'wall-clock');
  assert.match(notRepo.reason, /git failed/);
  const threw = f({ env: {}, root, now, run: () => { throw new Error('boom'); } });
  assert.equal(threw.source, 'wall-clock');
  assert.equal(threw.date, today);
});

test('F5. a root that is not the top of its work tree falls back', async (t) => {
  const made = setup(t);
  const root = tmp('bc-date-root-'); made.push(root);
  const other = tmp('bc-date-other-'); made.push(other);
  const r = (await resolver())({ env: {}, root, now, run: fakeRun(other + '\n', { status: 0, stdout: '981158400\n' }) });
  assert.equal(r.source, 'wall-clock');
  assert.match(r.reason, /not the top of a git work tree/);
  assert.equal(r.date, today);
});

test('F6. an empty SOURCE_DATE_EPOCH is treated as unset', async (t) => {
  const made = setup(t);
  const root = tmp('bc-date-root-'); made.push(root);
  const calls = [];
  const r = (await resolver())({ env: { SOURCE_DATE_EPOCH: '' }, root, now, run: fakeRun(root, { status: 0, stdout: '981158400\n' }, calls) });
  assert.equal(r.source, 'commit');
  assert.equal(r.date, '2001-02-03');
  assert.ok(calls.length > 0);
});

test('F7. a set SOURCE_DATE_EPOCH never asks git', async (t) => {
  const made = setup(t);
  const root = tmp('bc-date-root-'); made.push(root);
  const calls = [];
  const r = (await resolver())({ env: { SOURCE_DATE_EPOCH: '1700000000' }, root, now, run: fakeRun(root, { status: 0, stdout: '981158400\n' }, calls) });
  assert.equal(r.source, 'SOURCE_DATE_EPOCH');
  assert.equal(r.date, '2023-11-14');
  assert.equal(calls.length, 0);
});

test('F8. a toplevel path that does not exist falls back without throwing', async (t) => {
  const made = setup(t);
  const root = tmp('bc-date-root-'); made.push(root);
  const r = (await resolver())({ env: {}, root, now, run: fakeRun(join(root, 'no', 'such', 'dir') + '\n', { status: 0, stdout: '981158400\n' }) });
  assert.equal(r.source, 'wall-clock');
  assert.equal(r.date, today);
  assert.ok(r.reason);
});

test('F9. git is not handed any GIT_ variable, whatever its case', async (t) => {
  const made = setup(t);
  const root = tmp('bc-date-root-'); made.push(root);
  const calls = [];
  const env = { GIT_DIR: '/x', git_work_tree: '/y', GIT_CEILING_DIRECTORIES: '/z', PATH: '/bin' };
  (await resolver())({ env, root, now, run: fakeRun(root, { status: 0, stdout: '981158400\n' }, calls) });
  assert.ok(calls.length >= 2);
  for (const c of calls) {
    assert.deepEqual(Object.keys(c.opts.env).filter((k) => k.toUpperCase().startsWith('GIT_')), []);
    assert.equal(c.opts.env.PATH, '/bin');
  }
});
