// The ONE reviewed list of console/log/network noise an acceptance journey may
// end with. withAcceptancePage (browser.mjs) fails any journey that closes with
// a console error or warning, a browser Log warning/error, an uncaught
// exception, or a request that is not file:, data: or blob:, unless an entry
// here matches it. It starts nearly empty on purpose: adding an entry needs a
// reason a reviewer can read, and a test cannot switch the check off any other way.

// The browser's own autoplay refusal. Acceptance launches keep the real autoplay
// policy so a context created without a gesture shows up (candidate e4b6fb5,
// docs/release-acceptance-record.md finding 1). tests/release/
// acceptance-audio-gesture.test.mjs asserts its absence at the steps that matter;
// it is allowed at teardown only so that test can name it itself.
export const AUDIO_WARNING = /AudioContext was not allowed to start/i;

export const ALLOWED = [
  { pattern: AUDIO_WARNING, why: 'autoplay refusal; asserted directly by acceptance-audio-gesture' },
  // The tests' own pixel reads, not the app: getImageData is called only from
  // tests/release/acceptance-a11y-journey.test.mjs:63, acceptance-drawn-instruments
  // .test.mjs:115 and acceptance-phone-practice*.test.mjs, and src/ never reads a
  // canvas back. Chrome warns once the test reads a canvas repeatedly.
  { pattern: /^browser log warning: Canvas2D: Multiple readback operations using getImageData/, why: 'the tests read canvas pixels; the app never reads back' },
];

// Per-journey allowance (withAcceptancePage's `allowConsole`), never global: a
// blocked microphone makes the app log this on purpose, in the journeys that
// block it. In any other journey it is a real failure.
export const MIC_BLOCKED_ERROR = /^console\.error: \[mic:(connect|start)\] NotAllowedError/;

const LOCAL = /^(file|data|blob):/i;

// Everything the page recorded that no allowlist entry covers, as labelled lines.
export function consoleViolations(page, allowed = ALLOWED) {
  allowed = allowed.map((a) => (a instanceof RegExp ? { pattern: a } : a));
  const found = [
    ...page.consoleErrors.map((m) => `console.error: ${m}`),
    ...page.consoleWarnings.map((m) => `console.warn: ${m}`),
    ...page.logEntries.filter((e) => e.level === 'warning' || e.level === 'error').map((e) => `browser log ${e.level}: ${e.text}`),
    ...page.exceptions.map((m) => `uncaught exception: ${m}`),
    ...page.requestDetails.filter((r) => !LOCAL.test(r.url)).map((r) => `network request: ${r.url}`),
  ];
  return found.filter((line) => !allowed.some((a) => a.pattern.test(line)));
}
