// Turns the two CI step logs into one verdict, so a retry-only pass, a skip or a
// cancelled test file cannot read as "ready" just because the job went green.
//
//   RUNNER_TEMP=<dir> GATE_OUTCOME=success SUITE_OUTCOME=success node build/ci-summary.mjs
//
// Reads $RUNNER_TEMP/{gate,suite}.{log,rc} (what ci.yml's `gate` and `suite`
// steps tee and record), the step outcomes from the environment, the Chrome and
// node versions and dist/release/band-coach.html. It writes
// dist/test-artifacts/run-summary.json first, so a later crash still leaves it,
// then appends the markdown to $GITHUB_STEP_SUMMARY (stdout when that is unset),
// and exits 1 when the verdict is NOT READY. A missing log or rc is "not run",
// never a pass. Only `node:` built-ins, because the summary step also runs when
// `npm ci` failed.
//
// What is judged is the RELEASE block: the TAP block whose npm banner command
// contains `tests/release/*.test.mjs` (the posttest gate, or `npm run gate` run
// by hand). It is found by that banner, never by position and never from the
// gate step's log, which has no banner. NOT READY when it is missing or cut off,
// its step's rc is not 0, it has a failed or cancelled test, a skip, a retried
// attempt (`# retryFlaky:` lines), or a todo with a reason that now passes.
// Reported, not judged: the main suite's counts and retries (its rc already
// fails the job) and the gate step's block.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The most items of one list the markdown prints. GitHub caps a step summary
// at 1 MiB; counts and run-summary.json stay exact. Presentation only.
export const LIST_CAP = 25;
const RELEASE_GLOB = 'tests/release/*.test.mjs';
const STEPS = ['gate', 'suite'];
const REQUIRED = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
const NOT_RUN = 'not run';

// node prints `\#` for a `#` and `\\` for a backslash in a test name or reason.
const unescape = (s) => s.replace(/\\([#\\])/g, '$1');

// Split a log into TAP blocks. A block starts at a column-0 `TAP version 13` and
// runs to the next TAP start, the next npm banner or the end. A banner is a
// column-0 `> name@version script` line followed by a column-0 `> command`
// line; column 0 matters because a failing test's indented YAML may quote a
// nested run. A block is named by the nearest banner before it, or has none.
export function splitBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let banner = null;
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const head = /^> (\S+)@(\S+) (.+)$/.exec(lines[i]);
    const cmd = head && /^> (.+)$/.exec(lines[i + 1] ?? '');
    if (cmd) {
      banner = { script: head[3], command: cmd[1] };
      cur = null;
      i++;
    } else if (lines[i] === 'TAP version 13') {
      cur = { banner, lines: [] };
      blocks.push(cur);
    } else if (cur) cur.lines.push(lines[i]);
  }
  return blocks.map((b) => parseBlock(b));
}

function parseBlock({ banner, lines }) {
  const counts = {};
  const retries = [];
  const skips = [];
  const todos = { reasoned: [], bare: [], failing: [] };
  const failures = [];
  let last = null; // the failure the next `failureType:` line belongs to
  for (const line of lines) {
    const n = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (\S+)$/.exec(line);
    if (n) { counts[n[1]] = Number(n[2]); continue; }
    const r = /^\s*# retryFlaky: (.*?) -- discarded/.exec(line);
    if (r) { retries.push({ what: r[1], line: line.trim() }); continue; }
    const t = /^\s*(not )?ok \d+ - (.*)$/.exec(line);
    if (!t) {
      const f = /^\s+failureType: '(.*)'$/.exec(line);
      if (f && last) last.failureType = f[1];
      continue;
    }
    last = null;
    const d = /^(.*?) # (SKIP|TODO)(?: (.*))?$/.exec(t[2]);
    if (d) {
      const name = unescape(d[1]);
      const reason = unescape(d[3] ?? '');
      if (d[2] === 'SKIP') skips.push({ name, reason });
      else if (t[1]) todos.failing.push({ name, reason });
      else if (reason) todos.reasoned.push({ name, reason });
      else todos.bare.push(name);
    } else if (t[1]) {
      last = { name: unescape(t[2]), failureType: null };
      failures.push(last);
    }
  }
  const cutOff = REQUIRED.some((k) => counts[k] === undefined);
  return { banner, summary: cutOff ? null : counts, cutOff, retries, skips, todos, failures };
}

function readStep(name, env) {
  const dir = env.RUNNER_TEMP;
  const out = { log: NOT_RUN, rc: NOT_RUN, outcome: env[`${name.toUpperCase()}_OUTCOME`] || 'unknown', blocks: [] };
  if (!dir) return out; // never fall back to os.tmpdir(): another run's logs are not this run's
  const log = join(dir, `${name}.log`);
  if (existsSync(log)) { out.log = 'present'; out.blocks = splitBlocks(readFileSync(log, 'utf8')); }
  const rc = join(dir, `${name}.rc`);
  if (existsSync(rc) && /^-?\d+$/.test(readFileSync(rc, 'utf8').trim())) out.rc = Number(readFileSync(rc, 'utf8').trim());
  return out;
}

function chromeVersion(bin) {
  if (!bin) return 'unknown';
  try { return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown'; } catch { return 'unknown'; }
}

export function summarise({ root, env = process.env } = {}) {
  const steps = Object.fromEntries(STEPS.map((s) => [s, readStep(s, env)]));
  const release = [];
  for (const s of STEPS) for (const b of steps[s].blocks) if (b.banner && b.banner.command.includes(RELEASE_GLOB)) release.push({ ...b, step: s });

  const reasons = [];
  if (!release.length) reasons.push(`no release block: no TAP block follows an npm banner whose command contains ${RELEASE_GLOB}, so nothing proves the release lane ran`);
  for (const b of release) {
    const rc = steps[b.step].rc;
    if (rc === NOT_RUN) reasons.push(`release block: the ${b.step} step's exit code (${b.step}.rc) is missing (${NOT_RUN})`);
    else if (rc !== 0) reasons.push(`release block: the ${b.step} step exited with rc ${rc}`);
    if (b.cutOff) { reasons.push('release block cut off before its summary lines: its counts are unknown'); continue; }
    const c = b.summary;
    if (c.fail > 0) reasons.push(`release block: ${c.fail} failed (${b.failures.filter((f) => f.failureType !== 'cancelledByParent' && f.failureType !== 'testTimeoutFailure').map((f) => `${f.name} [${f.failureType}]`).join('; ') || 'see the log'})`);
    if (c.cancelled > 0) reasons.push(`release block: ${c.cancelled} cancelled (${b.failures.filter((f) => f.failureType === 'cancelledByParent' || f.failureType === 'testTimeoutFailure').map((f) => `${f.name} [${f.failureType}]`).join('; ') || 'see the log'}); a cancelled test proves nothing`);
    if (c.skipped > 0) reasons.push(`release block: ${c.skipped} skipped (${b.skips.map((k) => `${k.name}: ${k.reason || 'no reason'}`).join('; ') || 'see the log'})`);
    if (b.retries.length) reasons.push(`release block: ${b.retries.length} retried attempt(s), a retry-only pass is not a pass (${[...new Set(b.retries.map((x) => x.what))].join('; ')})`);
    for (const t of b.todos.reasoned) reasons.push(`release block: todo "${t.name}" (${t.reason}) now passes, so its marker must come off`);
  }

  const bytes = existsSync(join(root, 'dist/release/band-coach.html')) ? readFileSync(join(root, 'dist/release/band-coach.html')) : null;
  const facts = {
    chrome: chromeVersion(env.CHROME_BIN),
    node: process.version,
    sha: env.GITHUB_SHA || 'unknown',
    ref: env.GITHUB_REF || 'unknown',
    event: env.GITHUB_EVENT_NAME || 'unknown',
    runId: env.GITHUB_RUN_ID || 'unknown',
    runAttempt: env.GITHUB_RUN_ATTEMPT || 'unknown',
    epoch: env.SOURCE_DATE_EPOCH || 'unknown',
    releaseBytes: bytes ? bytes.length : 'absent',
    releaseSha256: bytes ? createHash('sha256').update(bytes).digest('hex') : 'absent',
  };
  return { verdict: reasons.length ? 'NOT READY' : 'READY', reasons, steps, release, facts };
}

const capped = (items, show) => [...items.slice(0, LIST_CAP).map(show), ...(items.length > LIST_CAP ? [`- ... ${items.length - LIST_CAP} more (all in run-summary.json)`] : [])];
const withReason = (x) => `- ${x.name}${x.reason ? ` (${x.reason})` : ''}`;

export function renderMarkdown(s) {
  const out = [`## Run summary: ${s.verdict}`, ''];
  if (s.reasons.length) out.push(...s.reasons.map((r) => `- ${r}`)); else out.push('No reasons to hold this run back.');
  out.push('', '| step | block | rc | outcome | tests | pass | fail | cancelled | skipped | todo | retries | ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  const lists = [];
  for (const name of STEPS) {
    const st = s.steps[name];
    if (!st.blocks.length) out.push(`| ${name} | ${st.log === NOT_RUN ? NOT_RUN : 'no TAP block'} | ${st.rc} | ${st.outcome} | | | | | | | | |`);
    st.blocks.forEach((b) => {
      const label = (b.banner ? b.banner.script : 'no banner') + (b.banner && b.banner.command.includes(RELEASE_GLOB) ? ' (release)' : '');
      const c = b.summary;
      const todo = b.todos;
      const split = c ? `${c.todo} (${todo.reasoned.length} reasoned, ${todo.bare.length} no reason, ${todo.failing.length} failing)` : '';
      out.push(`| ${name} | ${label} | ${st.rc} | ${st.outcome} | ${c ? [c.tests, c.pass, c.fail, c.cancelled, c.skipped].join(' | ') : 'cut off | | | |'} | ${split} | ${b.retries.length} | ${c && c.duration_ms !== undefined ? Math.round(c.duration_ms) : ''} |`);
      const items = [
        ...b.retries.map((x) => `retry: ${x.line}`),
        ...b.skips.map((x) => `skip: ${x.name}${x.reason ? ` (${x.reason})` : ''}`),
        ...b.failures.map((x) => `not ok: ${x.name} [${x.failureType ?? 'no failureType'}]`),
        ...todo.reasoned.map((x) => `todo with a reason that passes: ${x.name} (${x.reason})`),
        ...todo.failing.map((x) => `todo that still fails: ${x.name}${x.reason ? ` (${x.reason})` : ''}`),
      ];
      if (items.length || todo.bare.length) lists.push([`${name} / ${label}`, items, todo.bare]);
    });
  }
  for (const [title, items, bare] of lists) {
    out.push('', `### ${title}`, ...capped(items, (x) => `- ${x}`));
    if (bare.length) out.push('', 'Todos with no reason (listed, not judged):', ...capped(bare, (x) => `- ${x}`));
  }
  const f = s.facts;
  out.push('', '| fact | value |', '|---|---|',
    `| Chrome | ${f.chrome} |`, `| node | ${f.node} |`, `| commit (GITHUB_SHA) | ${f.sha} |`, `| ref | ${f.ref} |`, `| event | ${f.event} |`,
    `| run | ${f.runId} attempt ${f.runAttempt} |`, `| SOURCE_DATE_EPOCH | ${f.epoch} |`, `| release bytes | ${f.releaseBytes} |`, `| release sha256 | ${f.releaseSha256} |`, '');
  return out.join('\n');
}

function main() {
  const root = process.cwd();
  const s = summarise({ root, env: process.env });
  const dir = join(root, 'dist/test-artifacts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run-summary.json'), JSON.stringify(s, null, 2) + '\n'); // first: a later crash still leaves it
  const md = renderMarkdown(s);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); else process.stdout.write(md + '\n');
  if (s.verdict === 'NOT READY' || STEPS.some((n) => s.steps[n].outcome !== 'success' || s.steps[n].rc !== 0)) {
    for (const n of STEPS) if (s.steps[n].log !== NOT_RUN) copyFileSync(join(process.env.RUNNER_TEMP, `${n}.log`), join(dir, `${n}.log`));
  }
  if (s.verdict === 'NOT READY') {
    console.error(`NOT READY: ${s.reasons.join('; ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
