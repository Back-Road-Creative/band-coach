// Pure helpers for the error notice and Copy diagnostics. The text is built from an allow-list, so titles, audio, file names and device ids never reach it.
export const NOTICE_GAP_MS = 30000;
const MAX_MESSAGE = 200;

// One notice per gap; a clock stepping backwards is let through, never silenced.
export function createNoticeGate(gapMs = NOTICE_GAP_MS) {
  let last = null;
  return { allow(now) { if (last !== null && now >= last && now - last < gapMs) return false; last = now; return true; } };
}

// Layout churn, not a fault.
export function isBenignError(message) { return /^ResizeObserver loop/.test(String(message || '')); }

function scrub(message) {
  return String(message == null ? '' : message).replace(/\b[a-z][\w+.-]*:\/\/\S+|\b[A-Za-z]:\\\S+|(?:^|\s)\/(?:[\w.-]+\/)+\S*/gi, ' [path]').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
}

export function buildDiagnostics({ version, userAgent, errors, capabilities }) {
  const lines = ['Band Coach ' + version, 'Browser: ' + String(userAgent || 'unknown'), '', 'Features:'];
  Object.keys(capabilities || {}).forEach(k => lines.push('  ' + k + ': ' + (capabilities[k] ? 'available' : 'missing')));
  lines.push('', 'Recent errors:');
  const list = Array.isArray(errors) ? errors : [];
  if (!list.length) lines.push('  No errors recorded since this page opened.');
  list.forEach(e => lines.push('  [' + scrub(e && e.where) + '] ' + scrub(e && e.message)));
  lines.push('', 'This note holds no audio, song titles, file names or device names.');
  return lines.join('\n');
}
