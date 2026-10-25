// How many whole days old this copy is, from the build date a release build
// stamps into <meta name="band-coach-built"> (YYYY-MM-DD, UTC). No network:
// the date travels inside the file. A dev build (empty date) or a malformed
// one gives null, and a clock set before the build day reads as 0, never negative.
export function copyAgeDays(built, nowMs) {
  const m = typeof built === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(built);
  if (!m || !Number.isFinite(nowMs)) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const at = Date.UTC(y, mo - 1, d);
  const back = new Date(at);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.max(0, Math.floor((nowMs - at) / 86400000));
}
