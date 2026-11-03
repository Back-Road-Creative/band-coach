import { PIECES } from '../instruments/drum-kit.js';
import { drawKit } from './kit-draw.js';
import { kitLayout, describeHit, kitGroup } from '../instruments/how/drum-kit.js';
import { sanitizeKitPrefs, learnPad, hatPartner, deviceKey, KIT_ASPECT, PLACE_SCALE } from '../instruments/how/kit-presets.js';
import { t } from '../core/i18n.js';

// One hit teaches one pad: after a note is taken, further note-ons are ignored until the pad has been quiet this long (a bouncing pad or a double trigger sends several).
export const LEARN_QUIET_MS = 250;
// The piece an earlier step of this walk-through already taught `note`, or null. Closed and open hi-hat may share a note on purpose (many e-kits send one note for both), so the other hi-hat piece does not count as having taken it.
const takenThisRun = (run, note, id) => { const owner = run.learned[note]; return owner && owner !== hatPartner(id) ? owner : null; };
// `learn` is { listen(fn) -> stop }: while listening, each MIDI note-on arrives as fn(deviceName, note), and a pedal that sends only CC4 arrives as fn(deviceName, null, 'pedal'); fn returns true when the walk-through used the note (so the app does not also judge it as a hit).
let stopLearning = null;
export function renderKitSetup(host, raw, onChange, learn) {
  if (stopLearning) stopLearning();
  host.replaceChildren();
  let prefs = sanitizeKitPrefs(raw), svgReady = false;
  const save = patch => { prefs = sanitizeKitPrefs({ ...prefs, ...patch }); if (svgReady) draw(); onChange(prefs); };
  const legend = document.createElement('legend'); legend.textContent = t('kit.setup'); host.appendChild(legend);
  const label = (id, text, input) => {
    input.id = id;
    const row = document.createElement('label'); row.htmlFor = id;
    row.append(input, document.createTextNode(' ' + text)); host.appendChild(row);
  };
  const select = document.createElement('select');
  for (const id of ['standard', 'compact']) {
    const option = document.createElement('option'); option.value = id; option.textContent = t('kit.' + id); select.appendChild(option);
  }
  select.value = prefs.preset;
  select.addEventListener('change', () => save({ preset: select.value }));
  label('kitPreset', t('kit.layout'), select);
  const check = (id, text, checked, change) => {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
    input.addEventListener('change', () => change(input.checked)); label(id, text, input);
  };
  check('kitLeftHanded', t('kit.leftHanded'), prefs.leftHanded, leftHanded => save({ leftHanded }));
  const note = document.createElement('p'); note.className = 'small'; note.textContent = t('kit.visibility'); host.appendChild(note);
  for (const piece of PIECES) check('kitShow-' + piece.id, t('kit.piece.' + piece.id), !prefs.hiddenPieces.includes(piece.id), visible => {
    save({ hiddenPieces: visible ? prefs.hiddenPieces.filter(id => id !== piece.id) : [...prefs.hiddenPieces, piece.id] });
  });
  const placeNote = document.createElement('p'); placeNote.className = 'small'; placeNote.textContent = t('kit.place'); host.appendChild(placeNote);
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'); svg.id = 'kitPreview'; svg.setAttribute('viewBox', '0 0 ' + KIT_ASPECT + ' 1'); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', t('kit.preview')); svg.style.touchAction = 'none'; host.appendChild(svg);
  const size = document.createElement('input'); size.type = 'range'; size.min = PLACE_SCALE.min; size.max = PLACE_SCALE.max; size.step = 0.05; size.value = 1;
  label('kitSize', t('kit.size'), size);
  const reset = document.createElement('button'); reset.type = 'button'; reset.id = 'kitReset'; reset.className = 'small'; reset.textContent = t('kit.reset'); host.appendChild(reset);
  let sel = PIECES[0].id, drag = null;
  const mirror = x => prefs.leftHanded ? KIT_ASPECT - x : x, parts = { shape: {}, icon: {}, text: {} }, els = parts.shape;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  // The picture is the shared kit drawing (src/ui/kit-draw.js); this sheet adds the handle on each shape: drag, arrow keys, selection. Every piece is drawn, hidden ones dimmed, so a hidden piece can still be placed for when it reappears. Names and icons take no pointer, the shape under them is the handle.
  const wire = (el, p) => {
    el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); el.setAttribute('aria-label', t('kit.piece.' + p.id));
    el.addEventListener('pointerdown', ev => { pick(p.id); drag = { id: p.id, pointer: ev.pointerId }; if (el.setPointerCapture) try { el.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic pointers cannot be captured */ } ev.preventDefault(); });
    el.addEventListener('focus', () => pick(p.id));
    el.addEventListener('keydown', ev => { const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key]; if (!d) return; ev.preventDefault(); const q = kitLayout(prefs, [p.id]).find(o => o.id === p.id); move(p.id, q.x + d[0] * 0.02, q.y + d[1] * 0.02, true); });
  };
  const draw = () => {
    const layout = kitLayout(prefs, PIECES.map(p => p.id));
    drawKit(svg, layout, parts, wire);
    for (const p of layout) { const hidden = prefs.hiddenPieces.includes(p.id); els[p.id].classList.toggle('kit-hidden', hidden); els[p.id].classList.toggle('kit-sel', p.id === sel); parts.icon[p.id].classList.toggle('kit-hidden', hidden); parts.text[p.id].classList.toggle('kit-hidden', hidden); }
  };
  const pick = id => { sel = id; size.value = (prefs.placements && prefs.placements[id] ? prefs.placements[id].scale : 1); for (const k in els) els[k].classList.toggle('kit-sel', k === id); };
  // x is in the right-handed frame, so a mirrored kit's drag is un-mirrored first. The hi-hat, its tab and its pedal are one cymbal: they move by the same amount (kept inside the frame together), each keeping its own size. Only pieces that move get a saved placement, so a saved layout is never changed for the player.
  const move = (id, x, y, commit) => {
    const all = kitLayout(prefs, PIECES.map(p => p.id)), group = kitGroup(id).map(m => all.find(o => o.id === m)), here = group.find(o => o.id === id);
    const range = (get, hi, want) => Math.min(hi - Math.max(...group.map(get)), Math.max(-Math.min(...group.map(get)), want));
    const dx = range(o => mirror(o.x), KIT_ASPECT, mirror(x) - mirror(here.x)), dy = range(o => o.y, 1, y - here.y), put = {};
    for (const o of group) { const cur = prefs.placements && prefs.placements[o.id]; put[o.id] = { x: clamp(mirror(o.x) + dx, 0, KIT_ASPECT), y: clamp(o.y + dy, 0, 1), scale: cur ? cur.scale : 1 }; }
    prefs = sanitizeKitPrefs({ ...prefs, placements: { ...prefs.placements, ...put } }); draw(); if (commit) onChange(prefs);
  };
  const toFrame = ev => { const b = svg.getBoundingClientRect(), u = b.height || 1; return [(ev.clientX - b.left) / u, (ev.clientY - b.top) / u]; };
  svg.addEventListener('pointermove', ev => { if (!drag || ev.pointerId !== drag.pointer) return; const [x, y] = toFrame(ev); move(drag.id, x, y, false); });
  const end = ev => { if (!drag || ev.pointerId !== drag.pointer) return; const [x, y] = toFrame(ev), id = drag.id; drag = null; move(id, x, y, true); };
  // A cancelled gesture carries no usable position (clientX/Y are 0): keep the last move and save it.
  const cancel = ev => { if (!drag || ev.pointerId !== drag.pointer) return; drag = null; onChange(prefs); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', cancel);
  size.addEventListener('input', () => { const cur = prefs.placements && prefs.placements[sel], q = kitLayout(prefs, [sel]).find(o => o.id === sel); prefs = sanitizeKitPrefs({ ...prefs, placements: { ...prefs.placements, [sel]: { x: cur ? cur.x : mirror(q.x), y: cur ? cur.y : q.y, scale: Number(size.value) } } }); draw(); });
  size.addEventListener('change', () => onChange(prefs));
  reset.addEventListener('click', () => { const { placements, ...rest } = prefs; prefs = sanitizeKitPrefs(rest); size.value = 1; draw(); onChange(prefs); });
  svgReady = true; draw(); pick(sel);
  // "Hit each pad": light each piece in turn and save the note the pad sends, per device name. The GM map stays the default for any note not learned.
  const hint = document.createElement('p'); hint.className = 'small'; hint.textContent = t('kit.learnHint'); host.appendChild(hint);
  const button = (id, text, on) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'small'; b.textContent = text; b.addEventListener('click', on); host.appendChild(b); return b; };
  const status = document.createElement('p'); status.id = 'kitLearnStatus'; status.className = 'small'; status.setAttribute('role', 'status');
  const stepNote = document.createElement('p'); stepNote.id = 'kitLearnStep'; stepNote.className = 'small';
  const listHost = document.createElement('div'); listHost.id = 'kitLearnList';
  let run = null, lastDevice = null;
  const startBtn = button('kitLearn', t('kit.learn'), () => begin());
  const backBtn = button('kitLearnBack', t('kit.learnBack'), () => back());
  const skipBtn = button('kitLearnSkip', t('kit.learnSkip'), () => { if (run) run.last = null; advance(); });
  const noSendBtn = button('kitLearnNoSend', t('kit.learnNoSend'), () => noSend());
  const stopBtn = button('kitLearnStop', t('kit.learnStop'), () => finish());
  const forgetBtn = button('kitLearnForget', t('kit.learnForget'), () => { finish(); status.textContent = ''; const { midiMaps, hatShared, cc4Only, ...rest } = prefs; prefs = sanitizeKitPrefs(rest); syncLearn(); onChange(prefs); });
  host.appendChild(status); host.appendChild(stepNote); host.appendChild(listHost);
  const name = id => t('kit.piece.' + id);
  const cur = () => run.pieces[run.i].id;
  const say = extra => { status.textContent = (status.textContent + ' ' + extra).trim(); };
  function syncLearn() { skipBtn.hidden = stopBtn.hidden = !run; backBtn.hidden = !run || run.only; backBtn.disabled = !run || run.i === 0; noSendBtn.hidden = !run || cur() !== 'hihat-pedal'; if (!run) stepNote.textContent = ''; startBtn.hidden = !!run; forgetBtn.hidden = !!run || !(prefs.midiMaps || prefs.cc4Only); renderList(); }
  // The pieces shown on this sheet with the note each one learned for the device in front, and a Relearn button on every row.
  function renderList() {
    const maps = prefs.midiMaps || {}, keys = Object.keys(maps).length ? Object.keys(maps) : Object.keys(prefs.cc4Only || {}), dev = (run && run.device) || lastDevice || (keys.length === 1 ? keys[0] : null);
    listHost.replaceChildren(); if (!dev) return;
    const saved = maps[dev] || {}, sharedNote = (prefs.hatShared || {})[dev], pedalCc = !!(prefs.cc4Only || {})[dev];
    const h = document.createElement('p'); h.className = 'small'; h.textContent = t('kit.learnListHead') + ' (' + dev + ')'; listHost.appendChild(h);
    const ul = document.createElement('ul'); ul.className = 'small';
    for (const piece of PIECES.filter(p => !prefs.hiddenPieces.includes(p.id))) {
      const id = piece.id, own = Object.keys(saved).find(n => saved[n] === id), li = document.createElement('li'); li.id = 'kitRow-' + id;
      const partner = hatPartner(id), shares = own === undefined && partner && sharedNote !== undefined && saved[sharedNote] === partner;
      const what = own !== undefined ? t('kit.learnRowNote', { note: own }) : shares ? t('kit.learnRowShared', { note: sharedNote, piece: name(partner) }) : id === 'hihat-pedal' && pedalCc ? t('kit.learnRowCc') : t('kit.learnRowNone');
      li.append(name(id) + ': ' + what + ' ');
      const b = document.createElement('button'); b.type = 'button'; b.id = 'kitRelearn-' + id; b.className = 'small'; b.textContent = t('kit.learnRelearn'); b.setAttribute('aria-label', t('kit.learnRelearn') + ': ' + name(id)); b.addEventListener('click', () => relearn(id)); li.appendChild(b); ul.appendChild(li);
    }
    listHost.appendChild(ul);
  }
  function prompt() { clearTimeout(run.ccTimer); run.ccTimer = null; const id = cur(); pick(id); status.textContent = t(id === 'hihat-pedal' ? 'kit.learnPromptPress' : 'kit.learnPrompt', { piece: name(id) }); stepNote.textContent = id.startsWith('hihat-') ? describeHit(id, prefs) : ''; syncLearn(); }
  function advance() { if (!run) return; run.i++; if (run.i >= run.pieces.length) finish(); else prompt(); }
  // A piece taught again starts clean: its earlier note no longer counts as taken in this run.
  function forgetTaught(id) { for (const n of Object.keys(run.learned)) if (run.learned[n] === id) delete run.learned[n]; delete run.taught[id];  }
  function back() { if (!run || run.only || run.i === 0) return; run.i--; run.last = null; forgetTaught(cur()); prompt(); }
  function noSend() { if (!run || cur() !== 'hihat-pedal') return; const id = cur(); run.last = null; advance(); say(t('kit.learnNoSent', { piece: name(id) })); }
  function relearn(id) {
    if (run && !run.only) { const i = run.pieces.findIndex(p => p.id === id); if (i < 0) return; run.i = i; run.last = null; forgetTaught(id); prompt(); return; }
    if (run) finish();
    begin({ only: id });
  }
  function finish() {
    if (!run) return;
    const done = run; run = null; stopLearning = null; clearTimeout(done.ccTimer); done.off(); if (done.device) lastDevice = done.device;
    // The count is pieces of this run that still have a note in the saved map (their own, or the one they share), not note-ons heard.
    const saved = (prefs.midiMaps || {})[done.device] || {}, count = Object.keys(done.taught).filter(id => saved[done.taught[id]] === id || saved[done.taught[id]] === hatPartner(id)).length;
    status.textContent = count ? t(count === 1 ? 'kit.learnDone.one' : 'kit.learnDone', { count, device: done.device }) : '';
    syncLearn();
  }
  function begin({ only } = {}) {
    if (!learn || run) return;
    // Pieces hidden on this sheet are not on the player's kit, so the walk-through does not ask for them.
    const shown = PIECES.filter(p => !prefs.hiddenPieces.includes(p.id)), pieces = only ? shown.filter(p => p.id === only) : shown;
    if (!pieces.length) return;
    run = { i: 0, learned: {}, taught: {}, last: null, device: only ? (lastDevice || (Object.keys(prefs.midiMaps || {}).length === 1 ? Object.keys(prefs.midiMaps)[0] : null)) : null, off: null, pieces, only: !!only };
    stopLearning = finish;
    run.off = learn.listen((device, note, kind) => {
      // The sheet closed or this render was replaced: hand the note back to the app.
      if (!run || !host.isConnected || host.closest('[hidden]')) { finish(); return false; }
      const key = deviceKey(device);
      if (!key) return false;
      if (run.device === null) run.device = key; else if (key !== run.device) return false;
      const id = cur(), now = performance.now(), quiet = run.last === null || now - run.last >= LEARN_QUIET_MS;
      if (kind === 'pedal') {
        // Many pedals send CC4 together with a note, so a CC4 alone does not end the step: wait one quiet gap for the note. If none comes, this pedal sends only CC4: save that flag for this device (the app reads CC4 as the pedal only for a flagged device).
        if (id !== 'hihat-pedal') return false;
        if (run.ccTimer) return true;
        const mine = run; run.ccTimer = setTimeout(() => { mine.ccTimer = null; if (run !== mine || cur() !== 'hihat-pedal') return; save({ cc4Only: { ...prefs.cc4Only, [key]: true } }); advance(); say(t('kit.learnPedalCc', { piece: name(id) })); }, LEARN_QUIET_MS); return true;
      }
      run.last = now;
      if (!quiet) { prompt(); status.textContent += ' ' + t('kit.learnIgnored', { note }); return true; }
      const owner = takenThisRun(run, note, id);
      if (owner) { prompt(); status.textContent += ' ' + t('kit.learnTaken', { note, piece: name(owner) }); return true; }
      const maps = prefs.midiMaps || {}, partner = hatPartner(id), shared = !!partner && (maps[key] || {})[note] === partner;
      // A hat piece taught its own note ends any share; a note (not CC4) for the pedal ends its CC4-only flag.
      const hatShared = { ...prefs.hatShared }, cc4Only = { ...prefs.cc4Only };
      if (partner) { if (shared) hatShared[key] = note; else delete hatShared[key]; }
      if (id === 'hihat-pedal') delete cc4Only[key];
      save({ midiMaps: { ...maps, [key]: learnPad(maps[key], id, note, { shareHat: true }) }, hatShared, cc4Only });
      if (!run.learned[note]) run.learned[note] = id;
      run.taught[id] = note;
      advance(); if (shared) say(t('kit.learnShared', { note, first: name(partner), second: name(id) })); return true;
    });
    prompt();
  }
  syncLearn();
}
