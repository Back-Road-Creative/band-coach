// Turns the plain session log (`DB.sessions` in src/app.js — up to 60
// entries, one per finished session: `{ d: 'YYYY-MM-DD', mod, min, acc, a1,
// a2, from, to, breaks }`) into the numbers a progress/history view or a
// teacher/parent report needs. Pure, no DOM; `now` is always passed in.
//
// One thing this module can NOT see: the session log has no per-item
// breakdown (which note or fret was weak), only per-session accuracy and
// the instrument's level range for that session. So "strongest / needs
// work" here means "instrument with the highest/lowest average accuracy",
// not "which note". A true per-item weak list needs the model's own
// `item`/`trans` maps (see credit()/it() in app.js) — the wiring pass can
// layer that in separately; this module's job is what the log alone gives.
//
// Wiring notes: call `summarize(DB.sessions, { now: Date.now() })` for the
// history view; call `toTeacherSummary(DB, { now, learnerName })` for the
// shareable report (it also reads `DB.mods[mod].level` for "levels
// reached", if `DB.mods` is present — it degrades gracefully without it).

const DAY_MS = 86400000;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function parseDay(d) {
  // 'YYYY-MM-DD' -> a UTC Date at midnight. Using Date.UTC (not local
  // fields) means month/year rollover is handled by the platform's own
  // calendar math, not anything hand-rolled here.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

/** The Monday (UTC) of the week containing `date`, as a day key. */
function weekKey(date) {
  const d = new Date(date.getTime());
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return dayKey(d);
}

function validSessions(log) {
  return (Array.isArray(log) ? log : [])
    .map((x) => ({ ...x, _date: parseDay(x && x.d) }))
    .filter((x) => x._date && typeof x.mod === 'string');
}

function streaks(dayKeys, nowKey) {
  const days = new Set(dayKeys);
  let best = 0;
  let run = 0;
  const sorted = Array.from(days).sort();
  let prev = null;
  sorted.forEach((k) => {
    if (prev !== null) {
      const gapDays = Math.round((parseDay(k) - parseDay(prev)) / DAY_MS);
      run = gapDays === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    prev = k;
  });
  // current streak: consecutive days ending exactly at "today" (nowKey).
  let current = 0;
  if (days.has(nowKey)) {
    let cursor = parseDay(nowKey);
    while (days.has(dayKey(cursor))) {
      current++;
      cursor = new Date(cursor.getTime() - DAY_MS);
    }
  }
  return { current, best };
}

/**
 * Summarizes a session log. `now` (ms epoch) anchors "today" and the
 * recent/earlier split used for the accuracy trend.
 */
export function summarize(log, { now } = {}) {
  const nowMs = typeof now === 'number' ? now : Date.now();
  const nowKey = dayKey(new Date(nowMs));
  const sessions = validSessions(log).sort((a, b) => a._date - b._date);

  const byDay = new Map();
  const byWeek = new Map();
  const byMod = new Map();
  sessions.forEach((s) => {
    const dk = dayKey(s._date);
    byDay.set(dk, (byDay.get(dk) || 0) + s.min);
    const wk = weekKey(s._date);
    byWeek.set(wk, (byWeek.get(wk) || 0) + s.min);
    const m = byMod.get(s.mod) || { mod: s.mod, minutes: 0, sessions: 0, accSum: 0, maxLevel: 0 };
    m.minutes += s.min;
    m.sessions += 1;
    m.accSum += clamp(s.acc, 0, 1);
    m.maxLevel = Math.max(m.maxLevel, s.to || 0, s.from || 0);
    byMod.set(s.mod, m);
  });

  const minutesPerDay = Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, minutes]) => ({ day, minutes: Math.round(minutes * 10) / 10 }));
  const minutesPerWeek = Array.from(byWeek.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, minutes]) => ({ week, minutes: Math.round(minutes * 10) / 10 }));

  const perInstrument = Array.from(byMod.values())
    .map((m) => ({ mod: m.mod, minutes: Math.round(m.minutes * 10) / 10, sessions: m.sessions, avgAccuracy: m.accSum / m.sessions, maxLevel: m.maxLevel }))
    .sort((a, b) => b.minutes - a.minutes);

  const withEnoughData = perInstrument.filter((m) => m.sessions >= 1);
  let strongest = null;
  let needsWork = null;
  withEnoughData.forEach((m) => {
    if (!strongest || m.avgAccuracy > strongest.avgAccuracy) strongest = m;
    if (!needsWork || m.avgAccuracy < needsWork.avgAccuracy) needsWork = m;
  });

  const { current, best } = streaks(sessions.map((s) => dayKey(s._date)), nowKey);

  const N = 7;
  const recentAcc = mean(sessions.slice(-N).map((s) => clamp(s.acc, 0, 1)));
  const earlierAcc = mean(sessions.slice(-2 * N, -N).map((s) => clamp(s.acc, 0, 1)));
  let direction = 'flat';
  const delta = recentAcc - earlierAcc;
  if (sessions.length >= 2) {
    if (delta > 0.03) direction = 'up';
    else if (delta < -0.03) direction = 'down';
  }

  const levelsReached = {};
  perInstrument.forEach((m) => { levelsReached[m.mod] = m.maxLevel; });

  return {
    totalSessions: sessions.length,
    minutesPerDay,
    minutesPerWeek,
    currentStreak: current,
    bestStreak: best,
    perInstrument,
    strongest: strongest ? { mod: strongest.mod, avgAccuracy: strongest.avgAccuracy } : null,
    needsWork: needsWork ? { mod: needsWork.mod, avgAccuracy: needsWork.avgAccuracy } : null,
    accuracyTrend: { direction, recentAccuracy: recentAcc, earlierAccuracy: earlierAcc },
    levelsReached,
  };
}

/**
 * Downsamples/aggregates `values` into exactly `width` buckets (averaging
 * within each bucket), returning plain numbers — a caller draws the actual
 * chart glyphs; this module hands back data, not presentation.
 */
export function sparkline(values, width) {
  const w = Math.max(1, Math.floor(width) || 1);
  const xs = Array.isArray(values) ? values.filter((x) => typeof x === 'number' && isFinite(x)) : [];
  if (!xs.length) return new Array(w).fill(0);
  const out = [];
  for (let i = 0; i < w; i++) {
    const lo = Math.floor((i * xs.length) / w);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) * xs.length) / w));
    out.push(mean(xs.slice(lo, hi)));
  }
  return out;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HONEST_LIMITS = 'This report is judged by microphone: accuracy tracks the note that sounded, not which string or fret produced it, so string and fret choices are not verified.';

/**
 * A self-contained, shareable progress report (no account, no server — a
 * file the learner chooses to hand a parent or teacher). Returns both a
 * plain-text and a minimal HTML rendering of the same content.
 */
export function toTeacherSummary(db, { now, learnerName } = {}) {
  const d = db && typeof db === 'object' ? db : {};
  const s = summarize(d.sessions, { now });
  const name = learnerName && String(learnerName).trim() ? String(learnerName).trim() : 'This learner';
  const mods = d.mods && typeof d.mods === 'object' ? d.mods : {};

  const lines = [];
  lines.push(`${name}'s Band Coach progress report`);
  lines.push(`Sessions logged: ${s.totalSessions}`);
  lines.push(`Current streak: ${s.currentStreak} day${s.currentStreak === 1 ? '' : 's'} (best: ${s.bestStreak})`);
  lines.push(`Accuracy trend: ${s.accuracyTrend.direction}`);
  lines.push('');
  lines.push('Time by instrument:');
  if (s.perInstrument.length) {
    s.perInstrument.forEach((m) => {
      const levelFromModel = mods[m.mod] && typeof mods[m.mod].level === 'number' ? mods[m.mod].level : m.maxLevel;
      lines.push(`  - ${m.mod}: ${m.minutes} min across ${m.sessions} session${m.sessions === 1 ? '' : 's'}, ${Math.round(m.avgAccuracy * 100)}% average accuracy, level ${levelFromModel}`);
    });
  } else {
    lines.push('  (no sessions logged yet)');
  }
  lines.push('');
  if (s.strongest) lines.push(`Strongest: ${s.strongest.mod} (${Math.round(s.strongest.avgAccuracy * 100)}% average accuracy).`);
  if (s.needsWork && (!s.strongest || s.needsWork.mod !== s.strongest.mod)) {
    lines.push(`Needs work: ${s.needsWork.mod} (${Math.round(s.needsWork.avgAccuracy * 100)}% average accuracy).`);
  }
  lines.push('');
  lines.push(HONEST_LIMITS);
  const text = lines.join('\n');

  const rows = s.perInstrument.length
    ? s.perInstrument
        .map((m) => {
          const levelFromModel = mods[m.mod] && typeof mods[m.mod].level === 'number' ? mods[m.mod].level : m.maxLevel;
          return `<tr><td>${escapeHtml(m.mod)}</td><td>${m.minutes}</td><td>${m.sessions}</td><td>${Math.round(m.avgAccuracy * 100)}%</td><td>${levelFromModel}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="5">No sessions logged yet.</td></tr>';
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><title>Band Coach progress report</title></head><body>',
    `<h1>${escapeHtml(name)}'s Band Coach progress report</h1>`,
    `<p>Sessions logged: ${s.totalSessions}<br>Current streak: ${s.currentStreak} day(s) (best: ${s.bestStreak})<br>Accuracy trend: ${escapeHtml(s.accuracyTrend.direction)}</p>`,
    '<table border="1" cellpadding="4"><thead><tr><th>Instrument</th><th>Minutes</th><th>Sessions</th><th>Avg accuracy</th><th>Level</th></tr></thead><tbody>',
    rows,
    '</tbody></table>',
    s.strongest ? `<p>Strongest: ${escapeHtml(s.strongest.mod)} (${Math.round(s.strongest.avgAccuracy * 100)}% average accuracy).</p>` : '',
    s.needsWork && (!s.strongest || s.needsWork.mod !== s.strongest.mod)
      ? `<p>Needs work: ${escapeHtml(s.needsWork.mod)} (${Math.round(s.needsWork.avgAccuracy * 100)}% average accuracy).</p>`
      : '',
    `<p><em>${escapeHtml(HONEST_LIMITS)}</em></p>`,
    '</body></html>',
  ].join('');

  return { text, html };
}
