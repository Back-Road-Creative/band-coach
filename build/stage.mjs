// Copies the built release file to the drive the five-minute human check is
// run from, so the person testing by hand double-clicks D:\band-coach.html
// instead of walking a \\wsl.localhost path.
//
//   npm run stage                  -> builds dist/band-coach.html (the dev page
//                                     README step 6 tests) and
//                                     dist/release/band-coach.html,
//                                     copies the release one to $BC_STAGE_DIR (default
//                                     /mnt/d, the Windows D: drive under WSL)
//   BC_STAGE_DIR=/some/dir npm run stage
//
// The copy happens only after the release files (node --test, load-capped) have run
// against that exact file with fail = 0, todo = 0 and skipped = 0; a refusal prints why and
// leaves the destination untouched. A passing stage also writes
// <file>.evidence.json beside the copy (sha256, bytes, commit, dirty, passLine,
// ranAt) for the acceptance record's Automated row to quote.
// BC_STAGE_TEST_CMD replaces the test command (tests use a fake one).
//
// It never creates the target directory: a missing drive is a mount problem
// to fix, not a folder to invent. Prints the destination, size and sha256 so
// the line can go straight into docs/release-acceptance-record.md.
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FROM = join(here, '..', 'dist', 'release', 'band-coach.html');
export const DEFAULT_DIR = '/mnt/d';
export const DEFAULT_TEST_CMD = 'node --test --test-concurrency=$(node tests/helpers/browser.mjs) "tests/release/*.test.mjs"';
const root = join(here, '..');

// Reads the node test summary (tap `# pass 3` or spec `ℹ pass 3`); null when absent.
export function parseSummary(out) {
  const n = {};
  for (const k of ['pass', 'fail', 'todo', 'skipped']) { const m = out.match(new RegExp(`^\\s*[#ℹ] ${k} (\\d+)\\s*$`, 'm')); n[k] = m ? Number(m[1]) : null; }
  return n;
}
// Throws rather than returning '': evidence with an empty commit binds the
// copy to nothing (git refuses an untrusted checkout with no stdout).
const git = (args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`stage: refusing to copy, git ${args.join(' ')} failed so the commit cannot be recorded: ${(r.stderr || '').trim()}`);
  return r.stdout.trim();
};

export function stage({ from = DEFAULT_FROM, dir = process.env.BC_STAGE_DIR || DEFAULT_DIR, testCmd = process.env.BC_STAGE_TEST_CMD || DEFAULT_TEST_CMD } = {}) {
  if (!existsSync(from)) throw new Error(`stage: no release file at ${from} (run npm run build -- --release first)`);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`stage: target dir ${dir} is not mounted`);
  const to = join(dir, basename(from));
  const run = spawnSync(testCmd, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, BC_RELEASE_FILE: from } });
  const out = `${run.stdout || ''}${run.stderr || ''}`;
  process.stdout.write(out);
  const sum = parseSummary(out);
  if (run.status !== 0 || sum.pass === null || sum.fail === null || sum.fail > 0) throw new Error(`stage: refusing to copy, the release tests did not pass (exit ${run.status}, ${sum.fail ?? '?'} failed)`);
  if (sum.todo === null || sum.todo > 0) throw new Error(`stage: refusing to copy, ${sum.todo ?? 'an unreadable number of'} release test(s) are todo; a todo row is not a pass`);
  if (sum.skipped === null || sum.skipped > 0) throw new Error(`stage: refusing to copy, ${sum.skipped ?? 'an unreadable number of'} release test(s) were skipped; a skipped row is not a pass`);
  const passLine = `# pass ${sum.pass} # fail ${sum.fail} # todo ${sum.todo} # skipped ${sum.skipped}`;
  const commit = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain']) !== '';
  // Read then write, never copyFileSync: the Windows drive mounts (/mnt/d is
  // 9p drvfs) refuse the copy_file_range path with EPERM, while a plain write
  // works. cp(1) falls back the same way; node's copyFileSync does not.
  const data = readFileSync(from);
  writeFileSync(to, data);
  const bytes = statSync(to).size;
  const sha256 = createHash('sha256').update(data).digest('hex');
  const evidence = { sha256, bytes, commit, dirty, passLine, ranAt: new Date().toISOString() };
  writeFileSync(`${to}.evidence.json`, JSON.stringify(evidence, null, 2) + '\n');
  return { to, bytes, sha256, evidence };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let r;
  try { r = stage(); } catch (e) { console.error(e.message); process.exit(1); }
  console.log(`staged ${r.to} (${r.bytes} bytes, sha256 ${r.sha256})`);
}
