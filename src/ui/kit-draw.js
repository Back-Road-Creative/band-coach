// The drum kit as SVG, drawn once for every screen that shows it as a picture (the set-up sheet and the "How to play it" panel): a shape, a line-icon and a name per piece, in kit frame units (see src/instruments/how/drum-kit.js). Each screen adds its own behaviour on top (drag and keys on the sheet, the struck piece on the panel) and its own colours in CSS.
import { pieceIcon, kitWord } from '../instruments/how/drum-kit.js';

const NS = 'http://www.w3.org/2000/svg';
const make = (tag, attrs) => { const node = document.createElementNS(NS, tag); for (const k in attrs) node.setAttribute(k, attrs[k]); return node; };
const set = (node, attrs) => { for (const k in attrs) node.setAttribute(k, attrs[k]); return node; };

// `layout` is kitLayout() output; `parts` is the caller's { shape: {}, icon: {}, text: {} }, filled on the first call (elements are appended to `svg`: every shape first, so no shape covers a name) and updated in place on later ones. `wire(shapeEl, piece)` runs once per new shape.
export function drawKit(svg, layout, parts, wire) {
  for (const p of layout) {
    const round = p.r !== undefined;
    let el = parts.shape[p.id];
    if (!el) {
      el = parts.shape[p.id] = make(round ? 'circle' : 'rect', { 'data-piece': p.id, class: 'kit-pc fing-drum ' + (p.shape === 'cymbal' ? 'fing-cymbal' : 'fing-' + p.shape), 'stroke-width': p.shape === 'cymbal' ? 0.005 : 0.012 }); svg.appendChild(el);
      if (p.shape === 'tab') set(el, { rx: 0.02 }); else if (!round) set(el, { rx: 0.01 });
      if (wire) wire(el, p);
    }
    set(el, round ? { cx: p.x, cy: p.y, r: p.r } : { x: p.x - p.w / 2, y: p.y - p.h / 2, width: p.w, height: p.h });
  }
  // The icon and the name go on after every shape. The hi-hat is named once ("Hi-hat"), its tab and pedal by one small word each; the words come from kitWord(), the one table the trainer reads too.
  for (const p of layout) {
    const small = p.shape === 'tab' || p.id === 'hihat-pedal', dy = p.shape === 'cymbal' ? p.r * 0.62 : p.id === 'kick' ? p.h * 0.18 : p.shape === 'tab' ? p.h * 0.3 : small ? p.h * 0.38 : 0.013;
    let ic = parts.icon[p.id], tx = parts.text[p.id];
    if (!ic) {
      ic = parts.icon[p.id] = make('path', { 'data-icon': p.id, class: 'kit-ic' + (p.shape === 'drum' ? ' fing-rim' : p.shape === 'cymbal' ? ' fing-bell' : '') });
      tx = parts.text[p.id] = make('text', { 'data-label': p.id, class: 'kit-lab', 'text-anchor': 'middle' }); tx.textContent = kitWord(p.id); svg.appendChild(ic); svg.appendChild(tx);
    }
    set(ic, { d: pieceIcon(p.id, p) }); set(tx, { x: p.x, y: p.y + dy, 'font-size': small ? 0.035 : 0.04 });
  }
  return parts;
}
