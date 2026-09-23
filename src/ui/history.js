// "My progress" panel: turns the plain session log and each instrument's
// per-item memory into a plain-words report for the learner, plus a
// one-click copy of a shareable teacher/parent summary. All the real work
// (aggregating sessions, downsampling a trend into a sparkline, wording the
// teacher report, ranking items by how well they will be remembered) lives
// in src/core/history.js and src/core/srs.js — this module is the DOM glue.
import { summarize, sparkline, toTeacherSummary, ledger, weeklyReport } from '../core/history.js';
import { due } from '../core/srs.js';
import { itemLabel } from './history/item-label.js';
import { sanitizeHistoryStore } from './history/store.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      const shade = d.notKept ? 0 : Math.round((d.minutes / maxMinutes) * 100);
      const cls = 'ledger-cell' + (d.notKept ? ' ledger-cell-unknown' : d.metGoal ? ' ledger-cell-met' : '');
      const label = d.notKept
        ? `${d.day}: earlier sessions not kept`
        : `${d.day}: ${d.minutes} min, ${d.sessions} session${d.sessions === 1 ? '' : 's'}${d.metGoal ? ', goal met' : ''}${d.levelChange ? ', level ' + (d.levelChange > 0 ? '+' : '') + d.levelChange : ''}`;
      return `<div class="${cls}" style="--ledger-shade:${shade}%" title="${esc(label)}"><span class="visually-hidden">${esc(label)}</span></div>`;
    })
    .join('');
  const banner = l.truncated ? '<p class="ledger-truncated-note">Earlier sessions in this window were not kept — the practice log only holds the most recent sessions, so the greyed days are unknown, not zero.</p>' : '';
  return `${banner}<div class="ledger-grid" role="img" aria-label="Practice calendar, last ${l.weeks} weeks">${cells}</div>`;
}

/** Renders a weeklyReport() result (src/core/history.js) into the printable
 * section's markup: a plain-words week summary a teacher or parent can hold
 * on paper. `api.instrument` turns a mod id into its display name the same
 * way the rest of this panel does; every piece of user or instrument text
 * goes through esc() first — a learner name is free text they typed. */
function weeklyReportHtml(w, api) {
  const instRows = w.perInstrument.length
    ? w.perInstrument
        .map((m) => `<li>${esc((api.instrument(m.mod) || {}).name || m.mod)}: ${m.minutes} min across ${m.sessions} session${m.sessions === 1 ? '' : 's'}</li>`)
        .join('')
    : '<li>Nothing practised this week.</li>';
  const truncatedNote = w.truncated
    ? '<p>Some earlier days this week are not shown because the practice log only keeps the most recent sessions — those days are unknown, not zero.</p>'
    : '';
  return `
    <h1>${esc(w.name)}'s week in Band Coach</h1>
    <p>${esc(w.weekStart)} to ${esc(w.weekEnd)}</p>
    <p>${w.totalMinutes} minute${w.totalMinutes === 1 ? '' : 's'} total, practised on ${w.daysPractised} of 7 days, hit the ${w.goalMin}-minute goal on ${w.daysGoalMet} day${w.daysGoalMet === 1 ? '' : 's'}.</p>
    <h2>What was practised</h2>
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
          <h2>My progress</h2>
          <p>What your practice has looked like, in plain numbers — no account, nothing sent anywhere.</p>
          <div class="history-summary" id="historySummary"></div>
          <h3>Practice calendar</h3>
          <label for="historyGoalInput">Daily minutes goal</label>
          <input type="number" id="historyGoalInput" min="5" max="120" step="1">
          <p id="historyGoalStreak"></p>
          <div id="historyCalendar"></div>
          <h3>By instrument</h3>
          <div id="historyInstruments"></div>
          <h3>Items to know</h3>
          <label for="historyModSelect">Look at items for</label>
          <select id="historyModSelect"></select>
          <div id="historyItems"></div>
          <h3>Share a report</h3>
          <label for="historyNameInput">Your name (optional, shown on the report)</label>
          <input type="text" id="historyNameInput" maxlength="60" autocomplete="off">
          <div>
            <button type="button" id="historyCopyBtn">Copy a summary for my teacher</button>
          </div>
          <p role="status" id="historyCopyStatus"></p>
          <label for="historyCopyText" id="historyCopyTextLabel" hidden>Report text (selected — press Ctrl+C or Cmd+C)</label>
          <textarea id="historyCopyText" readonly hidden rows="8"></textarea>
          <div>
            <button type="button" id="historyPrintBtn">Print this week's report</button>
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

      function renderItemsFor(modId, db, now) {
        const box = el.querySelector('#historyItems');
        const items = practicedItems(db.mods && db.mods[modId]);
        if (!items.length) { box.innerHTML = '<p>Nothing practised yet on this instrument.</p>'; return; }
        const ranked = due(items, now);
        const weakest = ranked[0];
        const strongest = ranked[ranked.length - 1];
        const dueNow = ranked.filter((x) => x.overdue).slice(0, 5);
        box.innerHTML = `
          <p><strong>Strongest:</strong> <ul>${strongest ? itemRow(strongest) : ''}</ul></p>
          <p><strong>Weakest:</strong> <ul>${weakest ? itemRow(weakest) : ''}</ul></p>
          <p><strong>Due for review:</strong> ${dueNow.length ? `<ul>${dueNow.map(itemRow).join('')}</ul>` : '<span>Nothing overdue right now.</span>'}</p>`;
      }

      function render() {
        const db = api.db();
        const now = Date.now();
        const s = summarize(db.sessions, { now });
        const store = sanitizeHistoryStore(api.store('history').get());
        nameInput.value = store.learnerName;
        goalInput.value = store.goalMin;

        el.querySelector('#historySummary').innerHTML = s.totalSessions
          ? `<p>${s.totalSessions} session${s.totalSessions === 1 ? '' : 's'} logged. Current streak: ${s.currentStreak} day${s.currentStreak === 1 ? '' : 's'} (best ${s.bestStreak}). Accuracy is trending <strong>${esc(s.accuracyTrend.direction)}</strong>.</p>`
          : '<p>No sessions logged yet. Practice a little and come back.</p>';

        const l = ledger(db.sessions, { now, goalMin: store.goalMin });
        el.querySelector('#historyCalendar').innerHTML = calendarHtml(l);
        el.querySelector('#historyGoalStreak').textContent = l.goalStreak > 0
          ? `Goal streak: ${l.goalStreak} day${l.goalStreak === 1 ? '' : 's'} of hitting ${l.goalMin} minutes.`
          : `No current goal streak yet — hit ${l.goalMin} minutes today to start one.`;

        const instBox = el.querySelector('#historyInstruments');
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
                <p>${m.minutes} min across ${m.sessions} session${m.sessions === 1 ? '' : 's'}, ${pct(m.avgAccuracy)} average accuracy.</p>
                <div class="history-spark" role="img" aria-label="Accuracy trend for ${esc(name)}, most recent ${accHistory.length} session${accHistory.length === 1 ? '' : 's'}">${sparklineSvg(spark)}</div>
              </div>`;
            })
            .join('');
        }

        const modIds = Array.from(new Set([].concat(
          s.perInstrument.map((m) => m.mod),
          Object.keys(db.mods || {}).filter((m) => practicedItems(db.mods[m]).length),
        )));
        const current = modSelect.value && modIds.indexOf(modSelect.value) >= 0 ? modSelect.value : (modIds.indexOf(api.mod()) >= 0 ? api.mod() : modIds[0]);
        modSelect.innerHTML = modIds.map((m) => `<option value="${esc(m)}">${esc((api.instrument(m) || {}).name || m)}</option>`).join('');
        if (current) modSelect.value = current;
        if (current) renderItemsFor(current, db, now); else el.querySelector('#historyItems').innerHTML = '<p>Nothing practised yet.</p>';
      }

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
        const { text } = toTeacherSummary(api.db(), { now: Date.now(), learnerName: store.learnerName || undefined });
        const showSelected = () => {
          copyText.value = text;
          copyText.hidden = false;
          copyLabel.hidden = false;
          copyText.focus();
          copyText.select();
          copyStatus.textContent = 'Could not copy automatically — the text is selected below; press Ctrl+C (or Cmd+C) to copy it.';
        };
        let clip;
        try { clip = window.isSecureContext && navigator.clipboard ? navigator.clipboard.writeText(text) : null; } catch (e) { clip = null; }
        if (clip && typeof clip.then === 'function') {
          clip.then(() => {
            copyText.hidden = true; copyLabel.hidden = true;
            copyStatus.textContent = 'Copied. Paste it into an email or message.';
          }).catch(showSelected);
        } else {
          showSelected();
        }
      });

      printBtn.addEventListener('click', () => {
        const store = sanitizeHistoryStore(api.store('history').get());
        const w = weeklyReport(api.db(), { now: Date.now(), learnerName: store.learnerName || undefined, goalMin: store.goalMin });
        printReport.innerHTML = weeklyReportHtml(w, api);
        window.print();
      });

      return { show: render };
    },
  });
}
