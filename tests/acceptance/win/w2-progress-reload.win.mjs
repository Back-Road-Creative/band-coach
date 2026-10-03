// W2, Windows lane: README check 5 (progress survives a reload). On a fresh
// profile the Keyboard exercises are played with real input: a mouse click on
// Start, then the computer-key row for each note the screen asks for ("Play C"
// is the A key, and so on), until nine are right, then a click on End session so
// the session is logged. What the learner sees (the line under the energy bar
// that says "last keyboard session NN%", and the progress bar) and what is
// stored (localStorage 'bandcoach.v1') are read before playing, after, and after
// a reload. The before/after is this scenario's own control: a run where nothing
// changed would fail it. The reload is the browser's Page.reload over the
// DevTools connection, not the F5 key (CDP key events do not trigger a reload).
export const id = 'W2';

// Computer-key row for each natural note (src/core/pckeys.js, upper row: C4 up to B4).
const KEY_FOR = { C: 'a', D: 's', E: 'd', F: 'f', G: 'g', A: 'h', B: 'j' };
const ANSWERS = 9; // a session is logged only from 8 judged answers
// The stored value is reported as its length and a checksum (it is a few kilobytes of JSON), null when absent.
const read = (page) =>
  page.evaluate(`({ stored: (function () { const v = localStorage.getItem('bandcoach.v1'); if (v === null) return null; let h = 5381; for (let i = 0; i < v.length; i++) h = ((h * 33) ^ v.charCodeAt(i)) >>> 0; return v.length + ' chars, checksum ' + h; })(), shown: document.getElementById('sessLine').textContent.trim(), ready: document.getElementById('readyBar').getAttribute('aria-valuenow') })`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(page) {
  const before = await read(page);
  await page.clickSelector('#playBtn');
  let done = 0;
  const seen = [];
  for (let i = 0; i < 60 && done < ANSWERS; i++) {
    const prompt = (await page.evaluate("document.getElementById('prompt').textContent")).trim();
    const note = /^Play ([A-G])$/.exec(prompt);
    if (!note) {
      seen.push(prompt);
      if (seen.length > 20) return { blocked: `the exercise asked for something this scenario has no key for: "${prompt}"` };
      await sleep(500);
      continue;
    }
    await page.press(KEY_FOR[note[1]]);
    done++;
    await sleep(900);
  }
  if (done < ANSWERS) return { blocked: `only ${done} of ${ANSWERS} answers could be played; the prompts seen were: ${seen.join(' | ') || 'none'}` };
  await page.clickSelector('#endBtn');
  try {
    await page.waitFor("localStorage.getItem('bandcoach.v1') !== null && document.getElementById('sessLine').textContent.indexOf('last ') >= 0", 10000);
    await sleep(1500); // the app saves a moment after the session ends
  } catch {}
  const played = await read(page);
  await page.reload();
  const afterReload = await read(page);
  return { before, played, afterReload, answers: done, reloadHow: 'Page.reload over the DevTools connection (not the F5 key)', exceptions: [...page.exceptions] };
}

// Pure: an observation in, { status, text, findings } out.
export function w2Verdict(o) {
  if (o.blocked) return { status: 'BLOCKED', text: `W2 could not play: ${o.blocked}`, findings: [] };
  const findings = [];
  for (const x of o.exceptions) findings.push(`uncaught exception: ${x}`);
  if (o.played.stored === o.before.stored) findings.push('playing did not change localStorage bandcoach.v1, so nothing was saved');
  if (o.played.shown === o.before.shown) findings.push(`playing did not change the line shown ("${o.before.shown}"), so there is no recent result to survive a reload`);
  if (o.afterReload.stored !== o.played.stored) findings.push(o.afterReload.stored === null ? 'after the reload nothing is stored: progress is gone' : 'after the reload what is stored is not what was stored before it');
  if (o.afterReload.shown !== o.played.shown) findings.push(`after the reload the line shown is "${o.afterReload.shown}", not "${o.played.shown}": progress is back to where it started (${o.before.shown})`);
  if (o.afterReload.ready !== o.played.ready) findings.push(`after the reload the progress bar reads ${o.afterReload.ready}, not ${o.played.ready}`);
  if (findings.length) return { status: 'FAIL', text: `W2 found ${findings.length} problem(s): ${findings.join('; ')}`, findings };
  return { status: 'PASS', text: `after ${o.answers} real answers and End session, what is stored and what is shown ("${o.played.shown}") were the same after a reload; reload by Page.reload, not the F5 key`, findings };
}

export const verdict = w2Verdict;
