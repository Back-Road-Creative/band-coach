// "My progress" panel: turns the plain session log and each instrument's
// per-item memory into a plain-words report for the learner, plus a
// one-click copy of a shareable teacher/parent summary. All the real work
// (aggregating sessions, downsampling a trend into a sparkline, wording the
// teacher report, ranking items by how well they will be remembered) lives
// in src/core/history.js and src/core/srs.js — this module is the DOM glue.
import { summarize, sparkline, toTeacherSummary } from '../core/history.js';
import { due, migrateItem } from '../core/srs.js';
import { itemLabel } from './history/item-label.js';
import { sanitizeHistoryStore } from './history/store.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => Math.round((typeof x === 'number' && isFinite(x) ? x : 0) * 100) + '%';

/** Items this instrument has actually been practised on at least once. */
function practicedItems(model, now) {
  if (!model || !model.item) return [];
  return Object.keys(model.item)
    .filter((id) => model.item[id] && model.item[id].n > 0)
    .map((id) => Object.assign({ id }, migrateItem(model.item[id], now)));
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
        </div>`;

      const nameInput = el.querySelector('#historyNameInput');
      const modSelect = el.querySelector('#historyModSelect');
      const copyBtn = el.querySelector('#historyCopyBtn');
      const copyStatus = el.querySelector('#historyCopyStatus');
      const copyLabel = el.querySelector('#historyCopyTextLabel');
      const copyText = el.querySelector('#historyCopyText');

      function renderItemsFor(modId, db, now) {
        const box = el.querySelector('#historyItems');
        const items = practicedItems(db.mods && db.mods[modId], now);
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

        el.querySelector('#historySummary').innerHTML = s.totalSessions
          ? `<p>${s.totalSessions} session${s.totalSessions === 1 ? '' : 's'} logged. Current streak: ${s.currentStreak} day${s.currentStreak === 1 ? '' : 's'} (best ${s.bestStreak}). Accuracy is trending <strong>${esc(s.accuracyTrend.direction)}</strong>.</p>`
          : '<p>No sessions logged yet. Practice a little and come back.</p>';

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
          Object.keys(db.mods || {}).filter((m) => practicedItems(db.mods[m], now).length),
        )));
        const current = modSelect.value && modIds.indexOf(modSelect.value) >= 0 ? modSelect.value : (modIds.indexOf(api.mod()) >= 0 ? api.mod() : modIds[0]);
        modSelect.innerHTML = modIds.map((m) => `<option value="${esc(m)}">${esc((api.instrument(m) || {}).name || m)}</option>`).join('');
        if (current) modSelect.value = current;
        if (current) renderItemsFor(current, db, now); else el.querySelector('#historyItems').innerHTML = '<p>Nothing practised yet.</p>';
      }

      modSelect.addEventListener('change', () => renderItemsFor(modSelect.value, api.db(), Date.now()));

      nameInput.addEventListener('change', () => {
        const clean = sanitizeHistoryStore({ learnerName: nameInput.value });
        nameInput.value = clean.learnerName;
        api.store('history').set(clean);
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

      return { show: render };
    },
  });
}
