import { PIECES } from '../instruments/drum-kit.js';
import { kitLayout } from '../instruments/how/drum-kit.js';
import { sanitizeKitPrefs, KIT_ASPECT, PLACE_SCALE } from '../instruments/how/kit-presets.js';
import { t } from '../core/i18n.js';

export function renderKitSetup(host, raw, onChange) {
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
  const mirror = x => prefs.leftHanded ? KIT_ASPECT - x : x, els = {};
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  // Every piece is drawn, hidden ones dimmed, so a hidden piece can still be placed for when it reappears.
  const draw = () => {
    const layout = kitLayout(prefs, PIECES.map(p => p.id));
    for (const p of layout) {
      let el = els[p.id];
      if (!el) {
        el = els[p.id] = document.createElementNS(NS, p.r !== undefined ? 'circle' : 'rect'); el.dataset.piece = p.id; el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); el.setAttribute('aria-label', t('kit.piece.' + p.id)); el.setAttribute('class', 'kit-pc'); svg.appendChild(el);
        el.addEventListener('pointerdown', ev => { pick(p.id); drag = { id: p.id, pointer: ev.pointerId }; if (el.setPointerCapture) try { el.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic pointers cannot be captured */ } ev.preventDefault(); });
        el.addEventListener('focus', () => pick(p.id));
        el.addEventListener('keydown', ev => { const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key]; if (!d) return; ev.preventDefault(); const q = kitLayout(prefs, [p.id]).find(o => o.id === p.id); move(p.id, q.x + d[0] * 0.02, q.y + d[1] * 0.02, true); });
      }
      if (p.r !== undefined) { el.setAttribute('cx', p.x); el.setAttribute('cy', p.y); el.setAttribute('r', p.r); } else { el.setAttribute('x', p.x - p.w / 2); el.setAttribute('y', p.y - p.h / 2); el.setAttribute('width', p.w); el.setAttribute('height', p.h); }
      el.classList.toggle('kit-hidden', prefs.hiddenPieces.includes(p.id)); el.classList.toggle('kit-sel', p.id === sel);
    }
  };
  const pick = id => { sel = id; size.value = (prefs.placements && prefs.placements[id] ? prefs.placements[id].scale : 1); for (const k in els) els[k].classList.toggle('kit-sel', k === id); };
  // x is in the right-handed frame, so a mirrored kit's drag is un-mirrored first.
  const move = (id, x, y, commit) => {
    const cur = prefs.placements && prefs.placements[id], base = cur ? cur.scale : 1;
    const next = sanitizeKitPrefs({ ...prefs, placements: { ...prefs.placements, [id]: { x: clamp(mirror(x), 0, KIT_ASPECT), y: clamp(y, 0, 1), scale: base } } });
    prefs = next; draw(); if (commit) onChange(prefs);
  };
  const toFrame = ev => { const b = svg.getBoundingClientRect(), u = b.height || 1; return [(ev.clientX - b.left) / u, (ev.clientY - b.top) / u]; };
  svg.addEventListener('pointermove', ev => { if (!drag || ev.pointerId !== drag.pointer) return; const [x, y] = toFrame(ev); move(drag.id, x, y, false); });
  const end = ev => { if (!drag || ev.pointerId !== drag.pointer) return; const [x, y] = toFrame(ev), id = drag.id; drag = null; move(id, x, y, true); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  size.addEventListener('input', () => { const cur = prefs.placements && prefs.placements[sel], q = kitLayout(prefs, [sel]).find(o => o.id === sel); prefs = sanitizeKitPrefs({ ...prefs, placements: { ...prefs.placements, [sel]: { x: cur ? cur.x : mirror(q.x), y: cur ? cur.y : q.y, scale: Number(size.value) } } }); draw(); });
  size.addEventListener('change', () => onChange(prefs));
  reset.addEventListener('click', () => { const { placements, ...rest } = prefs; prefs = sanitizeKitPrefs(rest); size.value = 1; draw(); onChange(prefs); });
  svgReady = true; draw();
}
