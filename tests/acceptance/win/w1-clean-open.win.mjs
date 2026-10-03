// W1, Windows lane: README check 1 ("open the file") and acceptance finding 6
// (red console errors seen on a real Windows machine). A fresh profile with
// extensions off opens the release file, and after the same settle A02 uses
// (two frames and half a second) the browser's own record is read: no console
// error or warning, no Log entry, no exception, exactly one request (the file
// itself), no debug hook, and the bytes opened are the bytes the lane was told
// to expect. Nothing is clicked. A clean run says "not reproduced", which is
// not the same as "fixed": one clean profile on one machine is one data point.
export const id = 'W1';

export async function run(page, ctx) {
  await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 500))))');
  return {
    logEntries: [...page.logEntries],
    consoleErrors: [...page.consoleErrors],
    consoleWarnings: [...page.consoleWarnings],
    exceptions: [...page.exceptions],
    requests: [...page.requests],
    requestDetails: [...page.requestDetails],
    openedUrl: await page.evaluate('location.href'),
    hook: await page.evaluate('typeof window.__coach'),
    sha256: page.identity.html.sha256,
    bytes: page.identity.html.bytes,
    expectedSha256: ctx.sha256,
    flags: [...page.identity.flags],
    browser: page.identity.browser.product,
    profileDir: page.profileDir,
  };
}

// Pure: an observation in, { status, text, findings } out. PASS or FAIL only.
export function w1Verdict(o) {
  const findings = [];
  for (const e of o.consoleErrors) findings.push(`console error: ${e}`);
  for (const w of o.consoleWarnings) findings.push(`console warning: ${w}`);
  for (const l of o.logEntries) findings.push(`browser log (${l.source}/${l.level}): ${l.text}`);
  for (const x of o.exceptions) findings.push(`uncaught exception: ${x}`);
  if (o.requests.length !== 1 || o.requests[0] !== o.openedUrl) {
    findings.push(`expected exactly one request, the file itself (${o.openedUrl}); saw ${o.requests.length}: ${o.requests.join(', ') || 'none'}`);
  }
  if (o.hook !== 'undefined') findings.push(`window.__coach is ${o.hook}: this is not the release file`);
  if (!o.expectedSha256) findings.push('no expected sha256 was given, so the file opened cannot be tied to a build');
  else if (o.sha256 !== o.expectedSha256) findings.push(`the file opened has sha256 ${o.sha256}, expected ${o.expectedSha256}`);
  if (!o.flags.includes('--disable-extensions')) findings.push('--disable-extensions is missing from the launch flags, so extensions were not ruled out');
  if (findings.length) return { status: 'FAIL', text: `W1 found ${findings.length} problem(s): ${findings.join('; ')}`, findings };
  return {
    status: 'PASS',
    text: 'not reproduced in a clean profile, extensions off: no console error or warning, no browser log entry, no exception, one request (the file), release build only; one clean profile on one machine is one data point, not proof',
    findings,
  };
}

export const verdict = w1Verdict;
