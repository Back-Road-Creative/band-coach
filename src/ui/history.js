// "My progress" panel: turns the plain session log and each instrument's
// per-item memory into a plain-words report for the learner, plus a
// one-click copy of a shareable teacher/parent summary. All the real work
// (aggregating sessions, downsampling a trend into a sparkline, wording the
// teacher report, ranking items by how well they will be remembered) lives
// in src/core/history.js and src/core/srs.js — this module is the DOM glue.
import { summarize, sparkline, toTeacherSummary, ledger, ledgerShade, weeklyReport } from '../core/history.js';
import { summarizeEvents } from '../core/learning-events.js';
import { KBD_SONG_SKILL_MAP } from '../instruments/kbd-songs.js';
import { due } from '../core/srs.js';
import { itemLabel } from './history/item-label.js';
import { sanitizeHistoryStore } from './history/store.js';
import { t } from '../core/i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// "1 session" / "3 sessions": the caller picks the one/many key pair, the number rides along as {n}.
const plural = (n, one, many) => t(n === 1 ? one : many, { n });
const sessionsText = (n) => plural(n, 'history.sessionOne', 'history.sessionMany');
const daysText = (n) => plural(n, 'history.dayOne', 'history.dayMany');
const minutesText = (n) => plural(n, 'history.minuteOne', 'history.minuteMany');
const WEEKDAY_KEYS = ['history.wd.sun', 'history.wd.mon', 'history.wd.tue', 'history.wd.wed', 'history.wd.thu', 'history.wd.fri', 'history.wd.sat'];
const TREND_KEYS = { up: 'history.trend.up', down: 'history.trend.down', flat: 'history.trend.flat' };
const pct = (x) => Math.round((typeof x === 'number' && isFinite(x) ? x : 0) * 100) + '%';

/** Items this instrument has actually been practised on at least once.
 * `model.item` is already in the new srs.js shape by the time it reaches
 * here — app.js migrates old `{m,n,last,seen}` records via `migrateItem()`
 * at load time (see sanitizeModel in src/app.js), so no re-migration is
 * needed, only the `reps` field replacing the old `.n`. */
function practicedItems(model) {
  if (!model || !model.item) return [];
  return Object.keys(model.item)
    .filter((id) => model.item[id] && model.item[id].reps > 0)
    .map((id) => Object.assign({ id }, model.item[id]));
}

/** Builds a tiny inline sparkline SVG (decorative; the numbers are in the caption). */
function sparklineSvg(values) {
  const w = 120, h = 28, pad = 2;
  if (!values.length) return '';
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values
    .map((v, i) => {
      const x = pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1);
      const y = h - pad - ((v - lo) / span) * (h - 2 * pad);
      return x.toFixed(1) + ',' + y.toFixed(1);
    })
    .join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function itemRow(entry) {
  const label = itemLabel(entry.id) || entry.id;
  return `<li><span>${esc(label)}</span><span>${pct(entry.r)}</span></li>`;
}

/** Builds the practice calendar grid: one cell per day, shaded by minutes,
 * with a text label per cell (screen readers get the words, not the
 * shading) plus the goal streak and, when the 60-session cap has pushed
 * older days out of the log, an honest note instead of a false zero. */
function calendarHtml(l) {
  const maxMinutes = Math.max(1, ...l.days.map((d) => (d.notKept ? 0 : d.minutes)));
  const cells = l.days
    .map((d) => {
      const shade = d.notKept ? 0 : ledgerShade(d.minutes, l.goalMin, maxMinutes);
      const cls = 'ledger-cell' + (d.notKept ? ' ledger-cell-unknown' : d.metGoal ? ' ledger-cell-met' : '');
      const label = d.notKept
        ? t('history.cal.notKept', { day: d.day })
        : t('history.cal.day', { day: d.day, minutes: d.minutes, sessions: sessionsText(d.sessions) })
          + (d.metGoal ? t('history.cal.goalMet') : '')
          + (d.levelChange ? t('history.cal.level', { change: (d.levelChange > 0 ? '+' : '') + d.levelChange }) : '');
      return `<div class="${cls}" style="--ledger-shade:${shade}%" title="${esc(label)}"><span class="visually-hidden">${esc(label)}</span></div>`;
    })
    .join('');
  const banner = l.truncated ? `<p class="ledger-truncated-note">${esc(t('history.cal.truncated'))}</p>` : '';
  // the grid starts on whatever weekday the window opens on, so name the columns from the first cell
  const [y, m, dd] = l.days[0].day.split('-').map(Number);
  const wd = new Date(y, m - 1, dd).getDay();
  const heads = Array.from({ length: 7 }, (_, i) => `<span class="ledger-weekday">${esc(t(WEEKDAY_KEYS[(wd + i) % 7]))}</span>`).join('');
  return `${banner}<div class="ledger-weekdays" aria-hidden="true">${heads}</div><div class="ledger-grid" role="img" aria-label="${esc(t('history.cal.aria', { weeks: l.weeks }))}">${cells}</div><p class="ledger-legend">${esc(t('history.cal.legend', { goal: l.goalMin }))}</p>`;
}

/** Renders a weeklyReport() result (src/core/history.js) into the printable
 * section's markup: a plain-words week summary a teacher or parent can hold
 * on paper. `api.instrument` turns a mod id into its display name the same
 * way the rest of this panel does; every piece of user or instrument text
 * goes through esc() first — a learner name is free text they typed. */
function weeklyReportHtml(w, api) {
  const instRows = w.perInstrument.length
    ? w.perInstrument
        .map((m) => `<li>${esc(t('history.wk.instrument', { name: (api.instrument(m.mod) || {}).name || m.mod, minutes: m.minutes, sessions: sessionsText(m.sessions) }))}</li>`)
        .join('')
    : `<li>${esc(t('history.wk.none'))}</li>`;
  const truncatedNote = w.truncated
    ? `<p>${esc(t('history.wk.truncated'))}</p>`
    : '';
  return `
    <h1>${esc(t('history.wk.title', { name: w.name }))}</h1>
    <p>${esc(t('history.wk.range', { start: w.weekStart, end: w.weekEnd }))}</p>
    <p>${esc(t('history.wk.summary', { minutes: minutesText(w.totalMinutes), days: w.daysPractised, goal: w.goalMin, met: daysText(w.daysGoalMet) }))}</p>
    <h2>${esc(t('history.wk.practiced'))}</h2>
    <ul>${instRows}</ul>
    ${truncatedNote}
  `;
}

export function registerHistory(panels) {
  panels.register({
    id: 'history',
    name: 'My progress',
    tag: 'progress',
    color: '#5be08a',
    mount(el, api) {
      el.innerHTML = `
        <div class="panel-history">
          <!-- F2 (src/app.js's focusDestination()): id + tabindex so a real
               nav activation of Progress can focus this heading instead of
               dropping focus to <body>. -->
          <h2 id="historyHeading" tabindex="-1">${esc(t('history.heading'))}</h2>
          <p>${esc(t('history.intro'))}</p>
          <div class="history-summary" id="historySummary"></div>
          <div class="history-retention" id="historyRetention"></div>
          <div><button type="button" class="primary" id="historyStartBtn" hidden>${esc(t('history.startFirst'))}</button></div>
          <div class="history-calendar-group" id="historyCalendarGroup">
            <h3>${esc(t('history.calendar'))}</h3>
            <label for="historyGoalInput">${esc(t('history.goalLabel'))}</label>
            <input type="number" id="historyGoalInput" min="5" max="120" step="1">
            <p id="historyGoalStreak"></p>
            <div id="historyCalendar"></div>
          </div>
          <h3 id="historyInstrumentsHeading">${esc(t('history.byInstrument'))}</h3>
          <div id="historyInstruments"></div>
          <div id="historyItemsGroup">
            <h3>${esc(t('history.itemsHeading'))}</h3>
            <label for="historyModSelect">${esc(t('history.lookAt'))}</label>
            <select id="historyModSelect"></select>
            <div id="historyItems"></div>
          </div>
          <h3>${esc(t('history.shareHeading'))}</h3>
          <label for="historyNameInput">${esc(t('history.nameLabel'))}</label>
          <input type="text" id="historyNameInput" maxlength="60" autocomplete="off">
          <div>
            <button type="button" id="historyCopyBtn">${esc(t('history.copyBtn'))}</button>
          </div>
          <p role="status" id="historyCopyStatus"></p>
          <label for="historyCopyText" id="historyCopyTextLabel" hidden>${esc(t('history.copyTextLabel'))}</label>
          <textarea id="historyCopyText" readonly hidden rows="8"></textarea>
          <div>
            <button type="button" id="historyPrintBtn">${esc(t('history.printBtn'))}</button>
          </div>
          <div class="history-print-report" id="historyPrintReport" aria-hidden="true"></div>
        </div>`;

      const nameInput = el.querySelector('#historyNameInput');
      const goalInput = el.querySelector('#historyGoalInput');
      const modSelect = el.querySelector('#historyModSelect');
      const copyBtn = el.querySelector('#historyCopyBtn');
      const copyStatus = el.querySelector('#historyCopyStatus');
      const copyLabel = el.querySelector('#historyCopyTextLabel');
      const copyText = el.querySelector('#historyCopyText');
      const printBtn = el.querySelector('#historyPrintBtn');
      const printReport = el.querySelector('#historyPrintReport');
      const startBtn = el.querySelector('#historyStartBtn');

      function renderItemsFor(modId, db, now) {
        const box = el.querySelector('#historyItems');
        const items = practicedItems(db.mods && db.mods[modId]);
        if (!items.length) { box.innerHTML = `<p>${esc(t('history.nothingInstrument'))}</p>`; return; }
        const ranked = due(items, now);
        const weakest = ranked[0];
        const strongest = ranked[ranked.length - 1];
        const dueNow = ranked.filter((x) => x.overdue).slice(0, 5);
        box.innerHTML = `
          <p><strong>${esc(t('history.strongest'))}</strong> <ul>${strongest ? itemRow(strongest) : ''}</ul></p>
          <p><strong>${esc(t('history.weakest'))}</strong> <ul>${weakest ? itemRow(weakest) : ''}</ul></p>
          <p><strong>${esc(t('history.dueReview'))}</strong> ${dueNow.length ? `<ul>${dueNow.map(itemRow).join('')}</ul>` : `<span>${esc(t('history.nothingOverdue'))}</span>`}</p>`;
      }

      function render() {
        const db = api.db();
        const now = Date.now();
        const s = summarize(db.sessions, { now });
        const store = sanitizeHistoryStore(api.store('history').get());
        nameInput.value = store.learnerName;
        goalInput.value = store.goalMin;

        el.querySelector('#historySummary').innerHTML = s.totalSessions
          ? `<p>${t('history.summary', { sessions: sessionsText(s.totalSessions), streak: daysText(s.currentStreak), best: s.bestStreak, trend: '<strong>' + esc(t(TREND_KEYS[s.accuracyTrend.direction] || TREND_KEYS.flat)) + '</strong>' })}</p>`
          : `<p>${esc(t('history.noSessions'))}</p>`;

        // Passed-with-help / passed-on-your-own / retained / applied come from
        // DB.events (src/core/learning-events.js summarizeEvents), a separate,
        // finer-grained record from the plain session log above. withHelp +
        // independent + introduced is every counted event (retained/applied are
        // refinements of independent, not extra buckets -- see that module's own
        // comment), so it doubles as "were there any checks at all" without a
        // second read of db.events.length. On the keyboard, a starter song
        // played on your own also counts as applied for any of its notes
        // already drilled, via KBD_SONG_SKILL_MAP (src/instruments/kbd-songs.js).
        const ev = summarizeEvents(db.events || [], { skillMap: KBD_SONG_SKILL_MAP, skillMapInstrument: 'kbd' });
        const checkedCount = ev.withHelp + ev.independent + ev.introduced;
        el.querySelector('#historyRetention').innerHTML = checkedCount
          ? `<p>${esc(t('history.retention', { withHelp: ev.withHelp, independent: ev.independent, remembered: ev.retained, applied: ev.applied }))}</p>`
          : `<p>${esc(t('history.retentionNone'))}</p>`;

        // Nothing logged yet: offer the way to make the first session instead of an empty calendar and goal box.
        const empty = !s.totalSessions;
        startBtn.hidden = !empty;
        el.querySelector('#historyCalendarGroup').hidden = empty;
        const l = ledger(db.sessions, { now, goalMin: store.goalMin });
        el.querySelector('#historyCalendar').innerHTML = calendarHtml(l);
        el.querySelector('#historyGoalStreak').textContent = l.goalStreak > 0
          ? t('history.goalStreak', { days: daysText(l.goalStreak), goal: l.goalMin })
          : t('history.goalNone', { goal: l.goalMin });

        // A new profile has no per-instrument rows: no heading over an empty box.
        const instBox = el.querySelector('#historyInstruments');
        el.querySelector('#historyInstrumentsHeading').hidden = !s.perInstrument.length;
        if (!s.perInstrument.length) {
          instBox.innerHTML = '';
        } else {
          instBox.innerHTML = s.perInstrument
            .map((m) => {
              const name = (api.instrument(m.mod) || {}).name || m.mod;
              const accHistory = db.sessions.filter((x) => x.mod === m.mod).map((x) => x.acc);
              const spark = sparkline(accHistory, Math.min(20, Math.max(1, accHistory.length)));
              return `<div class="history-instrument">
                <h4>${esc(name)}</h4>
                <p>${esc(t('history.instrumentLine', { minutes: m.minutes, sessions: sessionsText(m.sessions), accuracy: pct(m.avgAccuracy) }))}</p>
                <div class="history-spark" role="img" aria-label="${esc(t('history.sparkLabel', { name, sessions: sessionsText(accHistory.length) }))}">${sparklineSvg(spark)}</div>
              </div>`;
            })
            .join('');
        }

        const modIds = Array.from(new Set([].concat(
          s.perInstrument.map((m) => m.mod),
          Object.keys(db.mods || {}).filter((m) => practicedItems(db.mods[m]).length),
        )));
        const current = modSelect.value && modIds.indexOf(modSelect.value) >= 0 ? modSelect.value : (modIds.indexOf(api.mod()) >= 0 ? api.mod() : modIds[0]);
        // nothing practiced: no "Items to know" heading, picker or empty box
        el.querySelector('#historyItemsGroup').hidden = !modIds.length;
        modSelect.innerHTML = modIds.map((m) => `<option value="${esc(m)}">${esc((api.instrument(m) || {}).name || m)}</option>`).join('');
        if (current) modSelect.value = current;
        if (current) renderItemsFor(current, db, now); else el.querySelector('#historyItems').innerHTML = `<p>${esc(t('history.nothingYet'))}</p>`;
      }

      // Same path as a person's own taps: go to Practice (the nav button closes this panel), then press Start.
      startBtn.addEventListener('click', () => {
        const nav = document.querySelector('#mainNav button[data-route="practice"]');
        if (nav) nav.click();
        const play = document.getElementById('playBtn');
        if (play) play.click();
      });

      modSelect.addEventListener('change', () => renderItemsFor(modSelect.value, api.db(), Date.now()));

      nameInput.addEventListener('change', () => {
        const store = sanitizeHistoryStore(api.store('history').get());
        const clean = sanitizeHistoryStore({ learnerName: nameInput.value, goalMin: store.goalMin });
        nameInput.value = clean.learnerName;
        api.store('history').set(clean);
      });

      goalInput.addEventListener('change', () => {
        const store = sanitizeHistoryStore(api.store('history').get());
        const clean = sanitizeHistoryStore({ learnerName: store.learnerName, goalMin: +goalInput.value });
        goalInput.value = clean.goalMin;
        api.store('history').set(clean);
        render();
      });

      copyBtn.addEventListener('click', () => {
        const store = sanitizeHistoryStore(api.store('history').get());
        const { text } = toTeacherSummary(api.db(), { now: Date.now(), learnerName: store.learnerName || undefined, instrument: api.instrument });
        const showSelected = () => {
          copyText.value = text;
          copyText.hidden = false;
          copyLabel.hidden = false;
          copyText.focus();
          copyText.select();
          copyStatus.textContent = t('history.copyFail');
        };
        let clip;
        try { clip = window.isSecureContext && navigator.clipboard ? navigator.clipboard.writeText(text) : null; } catch (e) { clip = null; }
        if (clip && typeof clip.then === 'function') {
          clip.then(() => {
            copyText.hidden = true; copyLabel.hidden = true;
            copyStatus.textContent = t('history.copied');
          }).catch(showSelected);
        } else {
          showSelected();
        }
      });

      printBtn.addEventListener('click', () => {
        const store = sanitizeHistoryStore(api.store('history').get());
        const w = weeklyReport(api.db(), { now: Date.now(), learnerName: store.learnerName || undefined, goalMin: store.goalMin });
        printReport.innerHTML = weeklyReportHtml(w, api);
        // Report mode (styles.css body.printing-report) stays on until the dialog closes;
        // print() does not block in every browser, so afterprint is what ends it.
        document.body.classList.add('printing-report');
        window.addEventListener('afterprint', () => document.body.classList.remove('printing-report'), { once: true });
        window.print();
      });

      return { show: render };
    },
  });
}
