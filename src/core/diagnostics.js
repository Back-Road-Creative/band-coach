// Pure helpers for the error notice and Copy diagnostics: text is built from an allow-list (version, browser, error messages, feature states).
// One notice per gap; a clock stepping back by more than the gap is let through, never silenced.
export const createNoticeGate = (gapMs = 30000, last = -Infinity) => ({ allow: now => Math.abs(now - last) >= gapMs && ((last = now), true) });

// Messages only, trimmed of file paths and links, 200 characters at most.
const scrub = m => String(m).replace(/(?:\b[a-z][\w+.-]*:\/\/|\b[a-z]:\\|(?:^|\s)\/)\S*/gi, ' [path]').replace(/\s+/g, ' ').slice(0, 200);

export const buildDiagnostics = ({ version, userAgent, errors, capabilities }) => ['Band Coach ' + version, 'Browser: ' + userAgent, 'Features: ' + JSON.stringify(capabilities), 'Recent errors: ' + (errors.length || 'none'), ...errors.map(e => '  [' + e.where + '] ' + scrub(e.message))].join('\n');
