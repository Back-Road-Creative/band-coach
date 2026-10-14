// The release workflows refuse a tag whose acceptance record is stale or has
// an agent-executable row still open. The logic lives in
// build/check-acceptance-record.mjs so it is tested here against synthetic
// records; release-consistency.yml only calls it.
//
// Record convention (docs/release-acceptance-record.md): the newest
// "## Candidate:" section is the last one in the file. It must name the tag's
// commit (short or full sha). A row is open when its value holds **open**,
// **Pending.** or **Not run**. An open row that only a person on a device can
// close says `**device-only: <why>**`; every other open row fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRecord } from '../../build/check-acceptance-record.mjs';

const SHA = '1874d63f13d5c4777aaee7e872cf126460644b7c';
const rec = (rows, sha = '1874d63') => `# Release acceptance record

## Candidate: \`0000000\` an older one

| Field | Value |
|---|---|
| Commit | \`0000000\` |
| Manual runs | **open** |

## Candidate: \`${sha}\` the newest

| Field | Value |
|---|---|
| Commit | \`${sha}\` (main) |
${rows}

## D2 / E9 evidence ledger

| Dimension | Automated | Human on device |
|---|---|---|
| 320 px | x | **open** |
`;
const good = '| Automated checks | CI green |\n| Manual runs | **device-only: needs a real MIDI keyboard** |';

test('a correct record passes, short or full sha, older and ledger open cells ignored', () => {
  assert.deepEqual(checkRecord(rec(good), SHA), { ok: true, problems: [] });
  assert.equal(checkRecord(rec(good, SHA), SHA).ok, true);
});

test('a stale candidate sha fails and names both shas', () => {
  const r = checkRecord(rec(good, 'e504c75'), SHA);
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /does not name 1874d63/);
});

test('an open agent-executable row fails, whichever open marker it uses', () => {
  for (const m of ['**open**', '**Pending.** later', '**Not run for this candidate.**']) {
    const r = checkRecord(rec(`| Windows lane | ${m} |`), SHA);
    assert.equal(r.ok, false, m);
    assert.match(r.problems.join('\n'), /Windows lane/);
  }
});

test('a device-only row with no reason fails', () => {
  for (const m of ['**device-only**', '**device-only:**', '**device-only: **']) {
    const r = checkRecord(rec(`| Manual runs | ${m} |`), SHA);
    assert.equal(r.ok, false, m);
    assert.match(r.problems.join('\n'), /Manual runs.*reason/);
  }
});

test('a record with no candidate section fails', () => {
  assert.equal(checkRecord('# nothing\n', SHA).ok, false);
});

test('the CLI exits non-zero on a stale record and zero on a good one, and says why', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bc-rec-'));
  const script = fileURLToPath(new URL('../../build/check-acceptance-record.mjs', import.meta.url));
  const run = (text) => {
    const f = join(dir, 'r.md');
    writeFileSync(f, text);
    return spawnSync('node', [script, f, SHA], { encoding: 'utf8' });
  };
  assert.equal(run(rec(good)).status, 0);
  const bad = run(rec(good, 'e504c75'));
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /does not name 1874d63/);
});

// A commit cannot hold its own sha, so the record names the candidate and the
// tag goes on a later commit that only records it. The CLI accepts the named
// candidate when it is the tag commit, or an ancestor whose changes up to the
// tag touch docs/ only; a code change after the candidate makes it stale.
test('the CLI accepts a candidate recorded by a docs-only commit and refuses one with code after it', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-rec-git-'));
  const script = fileURLToPath(new URL('../../build/check-acceptance-record.mjs', import.meta.url));
  const git = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const commit = (path, body, msg) => {
    mkdirSync(join(repo, dirname(path)), { recursive: true });
    writeFileSync(join(repo, path), body);
    git('add', '-A');
    git('commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  const cand = commit('src/app.js', 'v1\n', 'code');
  const recorded = commit('docs/release-acceptance-record.md', rec(good, cand.slice(0, 7)), 'docs: record candidate');
  const check = (tag) => spawnSync('node', [script, join(repo, 'docs/release-acceptance-record.md'), tag], { cwd: repo, encoding: 'utf8' });
  const ok = check(recorded);
  assert.equal(ok.status, 0, ok.stderr);
  const later = commit('src/app.js', 'v2\n', 'more code');
  const stale = check(later);
  assert.notEqual(stale.status, 0, 'code changed after the candidate: the record is stale');
  assert.match(stale.stderr, /src\/app\.js/, 'names the file that changed after the candidate');
});
