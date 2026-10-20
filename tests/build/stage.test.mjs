// stage.mjs copies the release file only after the release tests pass with
// no failures, no todo rows and no skipped tests, and leaves an evidence file beside the copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const stageJs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'build', 'stage.mjs');
const DATA = '<html>release</html>';

function run(summary, exit = 0, env = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'bc-stage-'));
  const from = join(tmp, 'band-coach.html');
  writeFileSync(from, DATA);
  const dest = join(tmp, 'dest');
  spawnSync('mkdir', [dest]);
  const script = join(tmp, 'fake.mjs');
  writeFileSync(script, `console.log(${JSON.stringify(summary)}); process.exit(${exit});`);
  const code = `import { stage } from ${JSON.stringify(stageJs)}; stage({ from: ${JSON.stringify(from)} });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, ...env, BC_STAGE_DIR: dest, BC_STAGE_TEST_CMD: `${process.execPath} ${script}` } });
  return { r, dest };
}

test('a failing release test run: exit 1, nothing copied, no evidence', () => {
  const { r, dest } = run('# pass 3\n# fail 1\n# todo 0\n# skipped 0', 1);
  assert.notEqual(r.status, 0);
  assert.deepEqual(readdirSync(dest), []);
});

test('git cannot name the commit: refused, nothing copied', () => {
  const { r, dest } = run('# pass 3\n# fail 0\n# todo 0\n# skipped 0', 0, { GIT_DIR: join(tmpdir(), 'bc-stage-no-such-git-dir') });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /commit/);
  assert.deepEqual(readdirSync(dest), []);
});

test('passing but with todo rows: refused, nothing copied', () => {
  const { r, dest } = run('# pass 3\n# fail 0\n# todo 2\n# skipped 0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /todo/);
  assert.deepEqual(readdirSync(dest), []);
});

test('clean pass: file copied and evidence carries its sha256', () => {
  const { r, dest } = run('# pass 3\n# fail 0\n# todo 0\n# skipped 0');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dest, 'band-coach.html')));
  const ev = JSON.parse(readFileSync(join(dest, 'band-coach.html.evidence.json'), 'utf8'));
  assert.equal(ev.sha256, createHash('sha256').update(DATA).digest('hex'));
  assert.equal(ev.bytes, DATA.length);
  assert.match(ev.passLine, /pass 3/);
  assert.match(ev.commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof ev.dirty, 'boolean');
  assert.ok(!Number.isNaN(Date.parse(ev.ranAt)));
});
