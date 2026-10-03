// W3, Windows lane: README check 6 ("Check for updates"). Settings is opened
// and "Check for updates" pressed with real mouse clicks, on the release file
// from a file:// page with the network on: the one real request the app ever
// makes. The result line is read once it stops saying "Checking…", and judged
// against the app's own strings (en, imported, never copied) and the version
// the lane was told to expect. Not covered: an offline run (the lane has no
// clean way to cut the network from outside the page), which the report says.
import { en } from '../../../src/core/i18n.js';
export const id = 'W3';

// A check that has not answered by now is a failure (README: "still says Checking
// after a few seconds"); a lane choice, long enough for a slow connection.
const ANSWER_MS = 30000;

export async function run(page, ctx) {
  await page.clickSelector('[data-route="settings"]');
  await page.waitFor("document.getElementById('updateCheckBtn') && document.getElementById('updateCheckBtn').getBoundingClientRect().width > 0", 10000);
  await page.clickSelector('#updateCheckBtn');
  const checking = JSON.stringify(en['update.checking']);
  let timedOut = false;
  try {
    await page.waitFor(`document.getElementById('updateCheckResult').textContent.trim() !== '' && document.getElementById('updateCheckResult').textContent.trim() !== ${checking}`, ANSWER_MS);
  } catch {
    timedOut = true;
  }
  return {
    text: (await page.evaluate("document.getElementById('updateCheckResult').textContent")).trim(),
    timedOut,
    expectVersion: ctx.expectVersion,
    requests: [...page.requests],
    exceptions: [...page.exceptions],
    offline: 'not covered',
  };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The app's template as a pattern, with its {version} as a capture group.
const pattern = (template, tail) => new RegExp('^' + esc(template.trim()).replace('\\{version\\}', '(.+?)') + tail);

// Pure: an observation in, { status, text, findings } out.
export function w3Verdict(o) {
  const text = o.text || '';
  const bad = (why) => ({ status: 'FAIL', text: `W3 ${why}`, findings: [why] });
  if (o.exceptions && o.exceptions.length) return bad(`an uncaught exception during the check: ${o.exceptions.join('; ')}`);
  const upToDate = pattern(en['update.upToDate'], '$').exec(text);
  if (upToDate) {
    const v = upToDate[1];
    if (!o.expectVersion) return { status: 'OBSERVED', text: `W3 the app says it runs the latest version (${v}); no --expect-version was given, so this was not judged`, findings: [] };
    if (v !== o.expectVersion) return bad(`the app names version ${v}, not the ${o.expectVersion} expected: "${text}"`);
    return { status: 'PASS', text: `the app says it runs the latest version (${v}), the version expected; the request was made from a file:// page with the network on (offline: not covered)`, findings: [] };
  }
  const behind = pattern(en['update.behind'], '').exec(text);
  if (behind) return bad(`the app says version ${behind[1]} is out, so the file opened is not the latest: "${text}"`);
  if (text.startsWith(en['update.error'].trim())) return bad(`the app could not reach the update server (the deployed version.json may be missing or blocked): "${text}"`);
  if (pattern(en['update.devBuild'], '$').test(text)) return bad(`the app says this is a development build, so the update check refused to run: "${text}"`);
  if (text === en['update.checking'] || o.timedOut) return bad(`the update check was still "${text || en['update.checking']}" after the deadline`);
  return bad(`the update check said something the lane does not know: "${text}"`);
}

export const verdict = w3Verdict;
