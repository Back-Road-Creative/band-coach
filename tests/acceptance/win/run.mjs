// The Windows lane: README checks run in a real, headed Windows Chrome (off-screen unless --visible)
// by the same driver the release tests use, started from WSL because that is where the
// repository is. It is NOT part of `npm test`, the gate or CI (docs/windows-lane.md).
//
// One file, two sides, told apart by the platform it runs on:
//  - WSL side (linux): checks its arguments, makes a fresh run-* directory under
//    --win-root, copies this file, the driver, the scenarios and the build to be
//    tested into it, runs Windows node.exe on the copy (node.exe cannot be
//    trusted to import from a \\wsl.localhost path, and the Q9 probe's working
//    route was a script in %TEMP%), copies the report back and removes the run
//    directory. Everything is passed by argument, nothing by environment.
//  - Windows side (win32): points TEMP and TMP into the run directory so the
//    browser profile lands there too, checks the machine (preflight), runs each
//    scenario on its own launch, prints one line per result, writes the report.
//
// Exit 0: every registered scenario PASSED in a full run. Exit 1: something
// FAILED, was only OBSERVED or was BLOCKED, or the run was partial (--only), or
// no scenario ran. Exit 2: the lane could not run at all (bad arguments, no
// Chrome, wrong file, or the Windows side left no report). PASS is the only result that counts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchPage } from '../../helpers/browser.mjs';
import { checkWinRoot, cleanupRun, laneEnv, winPathOf } from './win-paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// A lane design choice, not a product threshold: no scenario may run past this.
const SCENARIO_MS = 120000;
// The probe's off-screen spot (probe/drive.mjs): headed, but out of the way.
const OFFSCREEN = '-32000,-32000';
const NODE_EXE = '/mnt/c/Program Files/nodejs/node.exe';

// The scenarios, in run order. Each file exports { id, run(page, ctx), verdict }.
export const registry = [
  { id: 'W1', file: 'w1-clean-open.win.mjs' },
  { id: 'W2', file: 'w2-progress-reload.win.mjs' },
  { id: 'W3', file: 'w3-update-check.win.mjs' },
  { id: 'W4', file: 'w4-audio-gesture.win.mjs' },
  { id: 'W5', file: 'w5-midi-outcome.win.mjs' },
];

const VALUE_FLAGS = { '--win-root': 'winRoot', '--html': 'html', '--sha256': 'sha256', '--expect-version': 'expectVersion', '--only': 'only', '--chrome': 'chrome', '--node': 'node', '--report': 'report', '--run-dir': 'runDir' };

export function parseArgs(argv) {
  const out = { node: NODE_EXE, visible: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--visible') out.visible = true;
    else if (VALUE_FLAGS[a]) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      out[VALUE_FLAGS[a]] = argv[++i];
    } else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

// Why the lane cannot start on this machine, or null. Pure: the caller reads
// the machine and hands over the facts.
export function preflight({ nodeVersion, hasWebSocket, chrome, chromeExists, html, htmlExists, sha256, actualSha }) {
  const major = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  if (!(major >= 22)) return `node ${nodeVersion} is too old: the lane needs node 22 or newer`;
  if (!hasWebSocket) return 'this node has no global WebSocket, which the browser driver needs (node 22 or newer has one)';
  // The driver quietly skips a CHROME_BIN that does not exist and looks in
  // Program Files instead, which would run a Chrome the caller did not choose.
  if (chrome && !chromeExists) return `chrome not found: ${chrome}`;
  if (!htmlExists) return `html not found: ${html}`;
  if (!sha256) return 'no --sha256 given, so the file opened cannot be tied to a build';
  if (actualSha !== sha256) return `sha256 mismatch: expected ${sha256}, the file at ${html} is ${actualSha}`;
  return null;
}

// The exit code for a run. `found`: the scenarios asked for exist. `only`: a
// subset was asked for, which is never a full run.
export function planLane({ found, results, registry: reg, only }) {
  if (!found) return 2;
  if (!results.length || !reg.length) return 1;
  if (only) return 1;
  const byId = new Map(results.map((r) => [r.id, r]));
  return reg.every((r) => byId.get(r.id)?.status === 'PASS') && results.every((r) => r.status === 'PASS') ? 0 : 1;
}

// The exit code of the WSL side. The Windows side always writes a report, so a run
// with none never reached its scenarios (a WSL interop failure such as
// "UtilAcceptVsock: accept4 failed 110" exits node.exe with 1 having run nothing):
// that is exit 2 whatever node.exe's own status was, never a scenario result.
export function laneExit({ status, hasReport }) {
  return hasReport && typeof status === 'number' ? status : 2;
}

// What is copied into the run directory, relative to the repository: the driver, every
// file in tests/acceptance/win, and the app's own text table W3 matches its verdict on.
export function stageFiles(winFiles) {
  return ['tests/helpers/browser.mjs', 'src/core/i18n.js', ...winFiles.filter((f) => f.endsWith('.mjs')).map((f) => `tests/acceptance/win/${f}`)];
}

// A byte copy by read and write: copyFileSync fails with EPERM on the /mnt/<letter>/ drives.
const copyBytes = (from, to) => writeFileSync(to, readFileSync(from));
const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function withDeadline(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(what)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// One scenario, one launch of a headed Chrome (off-screen unless --visible) with a fresh profile.
async function runScenario(entry, ctx) {
  const t0 = Date.now();
  const mod = await import(pathToFileURL(join(here, entry.file)).href);
  let page;
  try {
    page = await launchPage(ctx.html, { acceptance: true, headed: true, windowPosition: ctx.visible ? undefined : OFFSCREEN });
  } catch (e) {
    return { id: entry.id, status: 'BLOCKED', launchError: true, text: `could not start Chrome and open the file: ${e.message}`, attempts: e.attempts, ms: Date.now() - t0 };
  }
  try {
    const observed = await withDeadline(mod.run(page, ctx), SCENARIO_MS, `${entry.id} did not finish within ${SCENARIO_MS / 1000} s`);
    const v = mod.verdict(observed);
    return { id: entry.id, status: v.status, text: v.text, findings: v.findings, observed, identity: page.identity, ms: Date.now() - t0 };
  } catch (e) {
    return { id: entry.id, status: 'BLOCKED', text: `${entry.id} stopped before it could judge: ${e.message}`, identity: page.identity, ms: Date.now() - t0 };
  } finally {
    await page.close();
  }
}

// The Windows side. Returns the exit code.
export async function runWindows(args, log = console.log) {
  const t0 = Date.now();
  if (args.runDir) {
    Object.assign(process.env, laneEnv(args.runDir));
    mkdirSync(process.env.TEMP, { recursive: true });
  }
  if (args.chrome) process.env.CHROME_BIN = args.chrome;
  const html = args.html || join(here, '..', '..', '..', 'dist', 'release', 'band-coach.html');
  const htmlExists = existsSync(html);
  const report = { lane: 'windows', node: process.version, html, expectedSha256: args.sha256, expectVersion: args.expectVersion, only: args.only, headed: true, windowPosition: args.visible ? 'default' : OFFSCREEN, results: [], notes: ['README check 2 (a MIDI keyboard) is not automated: found -> working needs key presses on a real keyboard'] };
  const finish = (code) => {
    report.exit = code;
    report.wallMs = Date.now() - t0;
    writeFileSync(args.report || join(process.cwd(), 'windows-lane-report.json'), JSON.stringify(report, null, 2) + '\n');
    return code;
  };
  const bad = preflight({
    nodeVersion: process.versions.node,
    hasWebSocket: typeof WebSocket === 'function',
    chrome: args.chrome,
    chromeExists: Boolean(args.chrome) && existsSync(args.chrome),
    html,
    htmlExists,
    sha256: args.sha256,
    actualSha: htmlExists ? sha256Of(html) : undefined,
  });
  if (bad) {
    report.preflight = bad;
    log(`lane cannot run: ${bad}`);
    return finish(2);
  }
  const selected = args.only ? registry.filter((r) => r.id === args.only) : registry;
  if (!selected.length) {
    report.preflight = `no scenario ${args.only}; registered: ${registry.map((r) => r.id).join(', ')}`;
    log(`lane cannot run: ${report.preflight}`);
    return finish(planLane({ found: false, results: [], registry, only: args.only }));
  }
  const ctx = { html, sha256: args.sha256, expectVersion: args.expectVersion, visible: args.visible };
  for (const entry of selected) {
    const r = await runScenario(entry, ctx);
    report.results.push(r);
    log(`${r.id} ${r.status}: ${r.text}`);
  }
  const code = report.results.some((r) => r.launchError) ? 2 : planLane({ found: true, results: report.results, registry, only: args.only });
  log(`lane exit ${code} (${report.results.filter((r) => r.status === 'PASS').length} of ${registry.length} registered scenarios passed${args.only ? `; partial run, --only ${args.only}` : ''})`);
  return finish(code);
}

// The WSL side. Returns the exit code.
export function runWsl(args, err = console.error) {
  const repoRoot = join(here, '..', '..', '..');
  const badRoot = checkWinRoot(args.winRoot);
  if (badRoot) return err(badRoot), 2;
  if (!existsSync(args.node)) return err(`Windows node.exe not found at ${args.node}; pass --node <path>`), 2;
  const html = args.html || join(repoRoot, 'dist', 'release', 'band-coach.html');
  const linuxHtml = html.startsWith('/');
  if (linuxHtml && !existsSync(html)) return err(`html not found: ${html} (build it with: node build/build.mjs --release)`), 2;
  if (!linuxHtml && !/^[A-Za-z]:[\\/]/.test(html)) return err(`--html must be a Linux path or a Windows path (C:\\...), got ${html}`), 2;
  if (!linuxHtml && !args.sha256) return err('--sha256 is required when --html is a Windows path'), 2;
  mkdirSync(args.winRoot, { recursive: true });
  // The only thing the lane ever writes or removes is this directory.
  const runDir = mkdtempSync(join(args.winRoot, 'run-'));
  let code = 2;
  try {
    const runWin = winPathOf(runDir);
    for (const rel of stageFiles(readdirSync(here))) {
      mkdirSync(dirname(join(runDir, rel)), { recursive: true });
      copyBytes(join(repoRoot, rel), join(runDir, rel));
    }
    let htmlWin = html;
    if (linuxHtml) {
      copyBytes(html, join(runDir, 'band-coach.html'));
      htmlWin = `${runWin}\\band-coach.html`;
    }
    const argv = [`${runWin}\\tests\\acceptance\\win\\run.mjs`, '--run-dir', runWin, '--html', htmlWin, '--sha256', args.sha256 || sha256Of(html), '--report', `${runWin}\\report.json`];
    for (const [flag, key] of [['--expect-version', 'expectVersion'], ['--only', 'only'], ['--chrome', 'chrome']]) if (args[key]) argv.push(flag, args[key]);
    if (args.visible) argv.push('--visible');
    const child = spawnSync(args.node, argv, { stdio: 'inherit', cwd: runDir, timeout: 15 * 60 * 1000 });
    const hasReport = existsSync(join(runDir, 'report.json'));
    code = laneExit({ status: child.status, hasReport });
    const reportTo = args.report || join(repoRoot, 'dist', 'windows-lane-report.json');
    mkdirSync(dirname(reportTo), { recursive: true });
    if (hasReport) copyBytes(join(runDir, 'report.json'), reportTo);
    else writeFileSync(reportTo, JSON.stringify({ lane: 'windows', exit: code, note: 'the Windows side wrote no report', childStatus: child.status, childSignal: child.signal, childError: child.error && child.error.message }, null, 2) + '\n');
    console.log(`report: ${reportTo}`);
  } finally {
    try {
      cleanupRun(runDir, args.winRoot);
    } catch (e) {
      err(`could not remove the run directory ${runDir}: ${e.message}`);
    }
  }
  return code;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let code;
  try {
    const args = parseArgs(process.argv.slice(2));
    code = process.platform === 'win32' ? await runWindows(args) : runWsl(args);
  } catch (e) {
    console.error(`lane cannot run: ${e.message}`);
    code = 2;
  }
  process.exit(code);
}
