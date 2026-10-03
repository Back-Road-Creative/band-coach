// W4, Windows lane: acceptance A02 (sound starts because a learner asked for it,
// and not before) on a real Windows Chrome under its normal autoplay policy.
// The same steps as tests/release/acceptance-audio-gesture.test.mjs steps 1 and 3:
// after the load settle no sound is running and no "AudioContext was not allowed
// to start" message has been raised; then a real mouse click on Start makes
// exactly one AudioContext run, the button says Pause, and still no warning and
// no exception. "Sound started" comes from the browser's WebAudio domain, not
// from the page.
export const id = 'W4';

const AUDIO_WARNING = /AudioContext was not allowed to start/i;
const warningsOf = (page) => [...page.consoleErrors, ...page.consoleWarnings, ...page.logEntries.map((e) => `${e.level}: ${e.text}`)].filter((m) => AUDIO_WARNING.test(m));
const label = (page) => page.evaluate("document.getElementById('playBtn').textContent.trim()");

export async function run(page) {
  // Two frames and half a second, as in A02, so a warning raised late in boot is reported as load's.
  await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 500))))');
  const load = { running: page.audio.running().length, warnings: warningsOf(page) };
  const labelBefore = await label(page);
  await page.clickSelector('#playBtn');
  await page.audio.waitForRunning();
  await page.waitFor("document.getElementById('playBtn').textContent.trim() === 'Pause'", 10000);
  return {
    load,
    labelBefore,
    after: { running: page.audio.running().length, warnings: warningsOf(page) },
    labelAfter: await label(page),
    exceptions: [...page.exceptions],
  };
}

// Pure: an observation in, { status, text, findings } out. PASS or FAIL only.
export function w4Verdict(o) {
  const findings = [];
  if (o.load.running !== 0) findings.push(`${o.load.running} AudioContext(s) running on load, before any click`);
  for (const w of o.load.warnings) findings.push(`on load: ${w}`);
  if (o.after.running !== 1) findings.push(`${o.after.running} running AudioContext(s) after the click on Start, expected exactly 1`);
  for (const w of o.after.warnings) findings.push(`after the click: ${w}`);
  if (o.labelAfter !== 'Pause') findings.push(`the button says "${o.labelAfter}" after the click, expected "Pause"`);
  for (const x of o.exceptions) findings.push(`uncaught exception: ${x}`);
  if (findings.length) return { status: 'FAIL', text: `W4 found ${findings.length} problem(s): ${findings.join('; ')}`, findings };
  return { status: 'PASS', text: 'no sound and no AudioContext warning on load; a real click on Start made exactly one AudioContext run, the button says Pause, still no warning or exception', findings };
}

export const verdict = w4Verdict;
