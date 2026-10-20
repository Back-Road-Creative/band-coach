// CI-only planning and aggregation. Local npm test keeps its existing hooks.
// No network, new dependency, cache or artifact transfer between worker jobs.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectFamilies, loadManifest } from './ci-select.mjs';
import { execFileSync } from 'node:child_process';

const development = ['test:root', 'test:build', 'test:char', 'test:unit'];
const allowed = [...development, 'test:release', 'test:all'];
export function planSelection(selection) {
  if (!Array.isArray(selection) || selection.some((s) => !allowed.includes(s))) throw new Error('unknown test family');
  const full = !selection.length || selection.includes('test:all');
  return {
    development: development.filter((s) => full || selection.includes(s)),
    release: full || selection.includes('test:release'),
  };
}

export function aggregateResults(input) {
  const { plan, sha, planResult, developmentResult, releaseResult } = input;
  const reasons = [];
  const validPlan = plan && Array.isArray(plan.development)
    && plan.development.every((s) => development.includes(s))
    && new Set(plan.development).size === plan.development.length
    && typeof plan.release === 'boolean' && (plan.development.length || plan.release);
  if (planResult !== 'success') reasons.push(`plan: ${planResult || 'missing'}`);
  if (!validPlan) reasons.push('missing or invalid plan');
  if (!/^[a-f0-9]{40}$/.test(sha || '')) reasons.push('missing candidate SHA');
  if (validPlan) {
    for (const [name, expected, status] of [
      ['development', plan.development, developmentResult],
      ['release', plan.release ? ['test:release'] : [], releaseResult],
    ]) {
      if (!expected.length) {
        if (status !== 'skipped') reasons.push(`${name}: unselected job must be skipped`);
        continue;
      }
      if (status !== 'success') reasons.push(`${name}: ${status || 'missing'}`);
      const report = input[name];
      if (!report || report.verdict !== 'READY') reasons.push(`${name}: no READY report`);
      if (report?.facts?.sha !== sha) reasons.push(`${name}: report is not for this candidate`);
      if (JSON.stringify(report?.selection) !== JSON.stringify(expected)) reasons.push(`${name}: family selection differs from plan`);
      for (const step of ['gate', 'suite']) {
        if (report?.steps?.[step]?.rc !== 0 || report?.steps?.[step]?.outcome !== 'success') reasons.push(`${name}: ${step} did not pass`);
      }
      if (name === 'release' && report?.releaseRun !== 'ran') reasons.push('release: no release test evidence');
    }
  }
  return { verdict: reasons.length ? 'NOT READY' : 'READY', reasons, plan, facts: { sha },
    jobs: { development: input.development || null, release: input.release || null } };
}

// Detailed failures remain in each job's step summary/logs. Outputs carry a
// small report, not screenshots or unbounded TAP logs (job-output size limit).
export function compactReport(report) {
  return { verdict: report.verdict, reasons: report.reasons.slice(0, 25), selection: report.selection,
    releaseRun: report.releaseRun, facts: report.facts,
    steps: Object.fromEntries(Object.entries(report.steps).map(([name, step]) => [name, {
      rc: step.rc, outcome: step.outcome,
      counts: step.blocks.map((b) => ({ script: b.banner?.script || 'gate', summary: b.summary })),
    }])) };
}
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
function main() {
  const mode = process.argv[2];
  if (mode === 'plan') {
    // Refuse manifest drift rather than silently dropping a new test family.
    const manifest = loadManifest();
    const scripts = Object.values(manifest.families).map((f) => f.script);
    if (JSON.stringify(scripts) !== JSON.stringify(allowed.slice(0, -1)) || manifest.all !== 'test:all') throw new Error('update CI plan for changed test families');
    let files = [];
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      try { files = execFileSync('git', ['diff', '--name-only', 'HEAD^1...HEAD'], { encoding: 'utf8' }).split('\n'); } catch { /* full selection */ }
    }
    const plan = planSelection(selectFamilies(files));
    appendFileSync(process.env.GITHUB_OUTPUT, `plan=${JSON.stringify(plan)}\n`);
  } else if (mode === 'report') {
    const report = JSON.parse(readFileSync('dist/test-artifacts/run-summary.json', 'utf8'));
    appendFileSync(process.env.GITHUB_OUTPUT, `report=${JSON.stringify(compactReport(report))}\n`);
  } else if (mode === 'aggregate') {
    const report = aggregateResults({ plan: parse(process.env.PLAN), sha: process.env.GITHUB_SHA,
      planResult: process.env.PLAN_RESULT, developmentResult: process.env.DEVELOPMENT_RESULT,
      releaseResult: process.env.RELEASE_RESULT, development: parse(process.env.DEVELOPMENT_REPORT),
      release: parse(process.env.RELEASE_REPORT) });
    mkdirSync('dist/test-artifacts', { recursive: true });
    writeFileSync('dist/test-artifacts/run-summary.json', JSON.stringify(report, null, 2) + '\n');
    const text = `## CI: ${report.verdict}\n\n${report.reasons.map((r) => `- ${r}`).join('\n')}\n`;
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    process.stdout.write(text);
    if (report.verdict !== 'READY') process.exitCode = 1;
  } else throw new Error('usage: ci-plan.mjs plan|report|aggregate');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
