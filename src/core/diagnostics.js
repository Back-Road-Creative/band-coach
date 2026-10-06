// Error-notice gate (a clock stepping back is let through) and the diagnostics text, built from an allow-list.
export const createNoticeGate = (gapMs = 30000, last = -Infinity) => ({ allow: now => Math.abs(now - last) >= gapMs && ((last = now), true) });

// file paths and links blanked, 200 characters
const scrub = m => String(m).replace(/(?:\b[a-z][\w+.-]*:\/\/|\b[a-z]:\\|(?:^|\s)\/)\S*/gi, ' [path]').replace(/\s+/g, ' ').slice(0, 200);

export const buildDiagnostics = ({ version, userAgent, errors, capabilities }) => ['Band Coach ' + version, 'Browser: ' + userAgent, 'Features: ' + JSON.stringify(capabilities), 'Recent errors: ' + (errors.length || 'none'), ...errors.map(e => '  [' + e.where + '] ' + scrub(e.message))].join('\n');
