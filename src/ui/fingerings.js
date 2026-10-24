// "How to play it" panel (Wave W, unit w-fingerings): pick an instrument and
// a note, see how to sound it drawn clearly, with a text description for
// screen readers, plus the instrument's playable range. All the musical
// computation lives in src/ui/fingerings/how.js (pure, unit tested); this
// file is just DOM.
import { el } from './dom.js';
import { INSTRUMENTS } from '../instruments/index.js';
import { howKindFor, computeHow, defaultNoteFor, alternateTuningsFor } from './fingerings/how.js';
import { noteName, chromaticRange } from './fingerings/notes.js';
import { readFingeringSetup } from './fingerings/setup.js';
import { isReviewed } from '../instruments/review.js';
import { t } from '../core/i18n.js';
import { KIT_ASPECT, THRONE } from '../instruments/how/drum-kit.js';
import { keyLayout } from '../instruments/how/keyboard.js';
import { barLayout } from '../instruments/how/mallet.js';
import { name } from '../core/note-names.js';
import { rangeIsWrittenPitch } from '../song/lesson.js';

// Human-readable labels for fretboard.js's named-tuning keys (alternateTuningsFor).
const TUNING_LABELS = {
  standard: 'Standard',
  'drop-d': 'Drop D',
  dadgad: 'DADGAD',
  'open-g': 'Open G',
  'open-d': 'Open D',
  'half-step-down': 'Half-step down'
};

// Only instruments this app can actually show a "how" diagram for.
const PLAYABLE = INSTRUMENTS.filter(rec => howKindFor(rec));

function rangeBar(range, midi) {
  const span = Math.max(1, range.high - range.low);
  const pct = Math.min(100, Math.max(0, ((midi - range.low) / span) * 100));
  const bar = el('div', { class: 'fing-range', role: 'img', 'aria-label': 'Playable range ' + noteName(range.low) + ' to ' + noteName(range.high) + ', current note ' + noteName(midi) });
  bar.appendChild(el('div', { class: 'fing-range-fill', style: 'width:' + pct + '%' }));
  bar.appendChild(el('div', { class: 'fing-range-marker', style: 'left:' + pct + '%' }));
  const labels = el('div', { class: 'fing-range-labels' }, [
    el('span', { text: noteName(range.low) }),
    el('span', { text: noteName(range.high) })
  ]);
  const wrap = el('div', { class: 'fing-range-wrap' }, [bar, labels]);
  return wrap;
}

// Row draw order, highest-pitched string at the top like a real diagram —
// reversed for a left-handed player (fretboard.js's `leftHanded` mirrors
// which side of the diagram each string is drawn on; the pitches, strings
// and frets underneath never change, only this visual order does).
function stringRowOrder(count, leftHanded) {
  const order = [];
  for (let s = count - 1; s >= 0; s--) order.push(s);
  return leftHanded ? order.reverse() : order;
}

function fretboardDiagram(instrument, how) {
  const tuning = how.tuning;
  const strings = tuning.length;
  const maxFret = how.maxFret;
  const box = el('div', { class: 'fing-fretboard', role: 'img', 'aria-label': how.description });
  stringRowOrder(strings, how.leftHanded).forEach(s => {
    const row = el('div', { class: 'fing-string' });
    row.appendChild(el('span', { class: 'fing-string-label', text: noteName(tuning[s] + how.capo) }));
    for (let f = 0; f <= maxFret; f++) {
      const hit = how.positions.find(p => p.stringIndex === s && p.fret === f);
      row.appendChild(el('span', { class: 'fing-fret' + (hit ? ' fing-hit' : ''), text: hit ? '●' : '' }));
    }
    box.appendChild(row);
  });
  return box;
}

// Fretless string instruments (bowed, `fretted: false`): a plain
// fingerboard with a position marker, never fret wires — the physical
// instrument has no frets to draw.
function fingerboardDiagram(instrument, how) {
  const tuning = how.tuning;
  const strings = tuning.length;
  const maxFret = how.maxFret;
  const box = el('div', { class: 'fing-fingerboard', role: 'img', 'aria-label': how.description });
  stringRowOrder(strings, how.leftHanded).forEach(s => {
    const hit = how.positions.find(p => p.stringIndex === s);
    const row = el('div', { class: 'fing-fboard-string' });
    row.appendChild(el('span', { class: 'fing-string-label', text: noteName(tuning[s]) }));
    const track = el('div', { class: 'fing-fboard-track' });
    if (hit) {
      const pct = Math.min(100, (hit.fret / Math.max(1, maxFret)) * 100);
      track.appendChild(el('span', { class: 'fing-fboard-marker', style: 'left:' + pct + '%' }));
    }
    row.appendChild(track);
    box.appendChild(row);
  });
  return box;
}

function brassDiagram(instrument, how) {
  const s = how.result.standard;
  const box = el('div', { class: 'fing-brass', role: 'img', 'aria-label': how.description });
  if (!s) { box.appendChild(el('p', { text: 'No fingering found.' })); return box; }
  if (how.kind === 'brass-valves') {
    const engaged = s.label === 'open' ? [] : s.label.split('-').map(Number);
    const valveCount = how.hasFourthValve ? 4 : 3;
    for (let v = 1; v <= valveCount; v++) {
      box.appendChild(el('span', { class: 'fing-valve' + (engaged.includes(v) ? ' fing-hit' : ''), text: String(v) }));
    }
  } else {
    box.appendChild(el('div', { class: 'fing-slide' }, [
      el('span', { class: 'fing-slide-pos', text: 'Position ' + s.position })
    ]));
  }
  if (s.sharp || s.needsCheck) box.appendChild(el('p', { class: 'fing-warn', text: s.sharp ? 'Tends to run sharp.' : 'Unusual high partial — check pitch by ear.' }));
  return box;
}

function harmonicaDiagram(instrument, how) {
  const box = el('div', { class: 'fing-harmonica', role: 'img', 'aria-label': how.description });
  const best = how.options[0];
  for (let hole = 1; hole <= 10; hole++) {
    const hit = best && best.hole === hole;
    const cell = el('div', { class: 'fing-hole' + (hit ? ' fing-hit' : '') });
    cell.appendChild(el('span', { text: String(hole) }));
    if (hit) cell.appendChild(el('small', { text: best.action + (best.semitonesBent ? ' ↓' + best.semitonesBent : '') }));
    box.appendChild(cell);
  }
  return box;
}

function recorderDiagram(instrument, how) {
  const box = el('div', { class: 'fing-recorder', role: 'img', 'aria-label': how.description });
  if (!how.entry) { box.appendChild(el('p', { text: 'No fingering in this chart for this note.' })); return box; }
  const hasThumb = how.instrumentKind === 'recorder';
  how.entry.holes.split('').forEach((c, i) => {
    const label = hasThumb ? (i === 0 ? 'T' : String(i)) : String(i + 1);
    const state = c === 'x' ? 'fing-hit' : c === 'h' ? 'fing-half' : '';
    box.appendChild(el('span', { class: 'fing-recorder-hole ' + state, text: label }));
  });
  return box;
}

function voiceDiagram(instrument, how) {
  return el('div', { class: 'fing-voice', role: 'img', 'aria-label': how.description }, [
    el('p', { text: how.playable ? 'Sing this pitch — no fingering needed.' : 'Try the nearest comfortable octave of this pitch.' })
  ]);
}

// Keyboard: the same two rows the practice canvas draws (keyLayout() in
// src/instruments/how/keyboard.js), left hand over right hand; the picked key is filled.
function keyboardDiagram(instrument, how) {
  const svg = svgEl('svg', { viewBox: '0 0 320 168', class: 'fing-keyboard', role: 'img', 'aria-label': how.description, width: '320', height: '168', style: 'max-width:100%;height:auto' });
  how.rows.forEach((row, i) => {
    const L = keyLayout(0, i * 88, 320, 80, row.lo, row.hi);
    L.whites.forEach(wk => {
      const hit = wk.m === how.midi;
      svg.appendChild(svgEl('rect', { x: String(wk.x), y: String(wk.y), width: String(wk.w), height: String(wk.h), class: 'fing-key' + (hit ? ' fing-hit' : ''), 'data-midi': String(wk.m), style: 'fill:' + (hit ? '#f3c52f' : '#e9edf6') + ';stroke:var(--line)' }));
      const label = svgEl('text', { x: String(wk.labelX), y: String(wk.labelY), 'font-size': String(L.labelPx), 'text-anchor': 'middle', style: 'fill:#3a4363' });
      label.textContent = name(wk.m, wk.m % 12 === 0);
      svg.appendChild(label);
    });
    L.blacks.forEach(bk => {
      const hit = bk.m === how.midi;
      svg.appendChild(svgEl('rect', { x: String(bk.x), y: String(bk.y), width: String(bk.w), height: String(bk.h), class: 'fing-key fing-key-black' + (hit ? ' fing-hit' : ''), 'data-midi': String(bk.m), style: 'fill:' + (hit ? '#f3c52f' : '#10131c') }));
    });
  });
  return svg;
}

// Mallet percussion: the same bar rows the practice canvas draws (barLayout() in
// src/instruments/how/mallet.js): sharps and flats raised behind, bars shorter as they rise; the picked bar is filled.
function malletDiagram(instrument, how) {
  const rg = instrument.range, svg = svgEl('svg', { viewBox: '0 0 320 188', class: 'fing-mallet', role: 'img', 'aria-label': how.description, width: '320', height: '188', style: 'max-width:100%;height:auto' });
  how.rows.forEach((row, i) => {
    const L = barLayout(0, i * 96, 320, 92, row.lo, row.hi, 1, [rg.low, rg.high]);
    [...L.raised, ...L.bars].forEach(b => {
      const hit = b.m === how.midi;
      svg.appendChild(svgEl('rect', { x: String(b.x), y: String(b.y), width: String(b.w), height: String(b.h), rx: '3', class: 'fing-bar' + (b.black ? ' fing-bar-raised' : '') + (hit ? ' fing-hit' : ''), 'data-midi': String(b.m), style: 'fill:' + (hit ? '#f3c52f' : b.black ? '#7f8fb0' : '#c4d0e6') + ';stroke:var(--line)' }));
      if (!b.black) {
        const label = svgEl('text', { x: String(b.labelX), y: String(b.labelY), 'font-size': String(L.labelPx), 'text-anchor': 'middle', style: 'fill:#26304d' });
        label.textContent = name(b.m, b.m % 12 === 0);
        svg.appendChild(label);
      }
    });
  });
  return svg;
}

// Keyed Boehm-system woodwinds (flute, clarinet, oboe, sax): the underlying
// chart (src/instruments/how/keyed-woodwind.js) is typed prose, not a
// structured set of key positions like a fretboard or brass valve, so there
// is no diagram to draw here that wouldn't be invented -- just the plain
// text the chart actually carries for this pitch, same wording as
// how.description (describeKeyedWoodwind in fingerings/how.js), plus a
// standalone note for the half-hole technique when the entry flags it.
function keyedWoodwindDiagram(instrument, how) {
  const box = el('div', { class: 'fing-keyed-woodwind', role: 'img', 'aria-label': how.description });
  if (!how.entry) {
    box.appendChild(el('p', { class: 'fing-keyed-keys', text: 'No fingering shown: this pitch is outside the beginner fingering chart for this instrument.' }));
    return box;
  }
  box.appendChild(el('p', { class: 'fing-keyed-keys', text: how.entry.keys }));
  if (how.entry.halfHole) box.appendChild(el('p', { class: 'fing-warn', text: 'Uses the half-hole technique.' }));
  return box;
}

// Any `how.kind` this app has no diagram module for (a future instrument
// family, or `how` itself missing) -- a truthful "not ready yet" state,
// never a thrown error and never the voice fallback that used to catch
// every unmatched kind (the keyed-woodwind bug: flute, clarinet, oboe and
// both saxes fell through to "Sing this pitch", src/ui/fingerings.js history).
function unavailableDiagram() {
  return el('div', { class: 'fing-unavailable', role: 'img', 'aria-label': t('fingerings.unavailable') }, [
    el('p', { class: 'fing-unavailable', text: t('fingerings.unavailable') })
  ]);
}

// Pure routing: which diagram kind applies to a computeHow() result. Kept
// separate from the DOM-building functions above (which need a real
// `document`, browser-tested only) so the ROUTING itself -- the part that
// was actually wrong -- is unit testable without one. An unrecognised or
// missing `how.kind` maps to 'unavailable', never silently falling through
// to 'voice'.
const DIAGRAM_KINDS = ['drum-kit', 'fretboard', 'fingerboard', 'brass-valves', 'brass-slide', 'harmonica', 'recorder', 'whistle', 'keyed-woodwind', 'keyboard', 'mallet', 'voice'];
export function diagramKindFor(how) {
  return (how && DIAGRAM_KINDS.includes(how.kind)) ? how.kind : 'unavailable';
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach(k => node.setAttribute(k, attrs[k]));
  return node;
}

// Drum kit as seen from the throne (src/instruments/how/drum-kit.js's kitLayout(),
// in a frame KIT_ASPECT wide and 1 tall scaled by 100): a head with a rim for
// each drum, a disc with a bell for each cymbal, a footboard for each pedal
// (the bass drum's also has its shell), the open hi-hat as a tab on the hi-hat's
// far edge, and a small throne mark at the bottom edge. The struck piece is
// filled with the panel's highlight colour. Colours come from the stage's CSS
// variables so the dark and light themes both read; the shapes, not the colours,
// tell a drum from a cymbal.
const hihatWords = () => ({ 'hihat-closed': t('kit.draw.hihat'), 'hihat-open': t('kit.draw.open'), 'hihat-pedal': t('kit.draw.pedal') });
export function drumKitDiagram(instrument, how) {
  const HIHAT_WORDS = hihatWords(), svg = svgEl('svg', { viewBox: '0 0 ' + 100 * KIT_ASPECT + ' 100', class: 'fing-drumkit', role: 'img', 'aria-label': how.description, width: String(320 * KIT_ASPECT), height: '320', style: 'max-width:100%;height:auto' });
  const line = 'stroke:var(--line)';
  svg.appendChild(svgEl('ellipse', { cx: String(THRONE.x * 100), cy: String(THRONE.y * 100), rx: String(THRONE.w * 50), ry: String(THRONE.h * 50), class: 'fing-throne', style: 'fill:var(--panel-2);' + line, 'stroke-width': '0.5' }));
  how.layout.forEach(p => {
    const hit = p.id === how.piece, fill = hit ? 'fill:#f3c52f;stroke:#f3c52f' : 'fill:' + (p.shape === 'cymbal' ? 'none' : 'var(--panel-2)') + ';' + line;
    const cls = 'fing-drum fing-' + p.shape + (hit ? ' fing-hit' : ''), sw = p.shape === 'cymbal' ? '0.5' : '1.2', x = p.x * 100, y = p.y * 100;
    if (p.r !== undefined) {
      svg.appendChild(svgEl('circle', { cx: String(x), cy: String(y), r: String(p.r * 100), class: cls, 'data-piece': p.id, 'stroke-width': sw, style: fill }));
      svg.appendChild(svgEl('circle', { cx: String(x), cy: String(y), r: String(p.r * (p.shape === 'drum' ? 80 : 30)), class: p.shape === 'drum' ? 'fing-rim' : 'fing-bell', 'stroke-width': '0.5', style: 'fill:none;' + line }));
    } else {
      svg.appendChild(svgEl('rect', { x: String(x - p.w * 50), y: String(y - p.h * 50), width: String(p.w * 100), height: String(p.h * 100), rx: p.shape === 'tab' ? '2' : '1', class: cls, 'data-piece': p.id, 'stroke-width': sw, style: fill }));
      if (p.id === 'kick') {
        svg.appendChild(svgEl('ellipse', { cx: String(x), cy: String(y - p.h * 28), rx: String(p.w * 38), ry: String(p.h * 18), class: 'fing-shell', 'stroke-width': '0.5', style: 'fill:none;' + line }));
        svg.appendChild(svgEl('rect', { x: String(x - p.w * 35), y: String(y + p.h * 22), width: String(p.w * 70), height: String(p.h * 20), class: 'fing-footboard', 'stroke-width': '0.5', style: 'fill:none;' + line }));
      }
    }
    // the hi-hat is one cymbal named once, on its disc; its tab and footboard carry one small word each, set inside their own shapes
    const part = HIHAT_WORDS[p.id], label = svgEl('text', { x: String(x), y: String(y + (part ? 0.9 : 1.2)), 'text-anchor': 'middle', 'font-size': part && p.id !== 'hihat-closed' ? '2.4' : '3', style: 'fill:' + (hit ? '#06101d' : 'var(--text)') });
    label.textContent = part || p.name;
    svg.appendChild(label);
  });
  return svg;
}

function diagramFor(instrument, how) {
  switch (diagramKindFor(how)) {
    case 'drum-kit': return drumKitDiagram(instrument, how);
    case 'fretboard': return fretboardDiagram(instrument, how);
    case 'fingerboard': return fingerboardDiagram(instrument, how);
    case 'brass-valves':
    case 'brass-slide': return brassDiagram(instrument, how);
    case 'harmonica': return harmonicaDiagram(instrument, how);
    case 'recorder':
    case 'whistle': return recorderDiagram(instrument, how);
    case 'keyed-woodwind': return keyedWoodwindDiagram(instrument, how);
    case 'keyboard': return keyboardDiagram(instrument, how);
    case 'mallet': return malletDiagram(instrument, how);
    case 'voice': return voiceDiagram(instrument, how);
    default: return unavailableDiagram();
  }
}

// The unreviewed-instrument text (src/instruments/review.js's isReviewed),
// shared by the panel's own reviewHost badge (renderReview below) and
// Songs' inline expander (renderHowInline) so the two callers never drift
// apart on wording. Returns null when the instrument IS reviewed -- both
// callers skip the badge entirely in that case, same as before this split.
function reviewText(instrument) {
  if (isReviewed(instrument.provenance)) return null;
  const reference = instrument.provenance && instrument.provenance.reference;
  return reference ? t('review.unreviewedWithRef', { reference }) : t('review.unreviewed');
}

// A running counter for `aria-controls`/id pairs on the inline expander --
// Songs can render more than one lesson's practice section per page
// lifetime (Practise again, a new song), so a fixed id would collide with
// a stale, still-mounted-but-detached copy from an earlier render.
let howInlineSeq = 0;

// Songs' "How to play this" (C1b): the SAME diagram and description the
// Fingerings panel gives for `instrument`/`soundingMidi`, dropped inline
// under the current lesson step, collapsed by default. Returns null (and
// appends nothing) when this instrument has no how diagram at all
// (howKindFor null -- the wind picker). `setup` is
// the caller's own instrumentSetup() result (capo/tuning/leftHanded/
// harpKey), read fresh at render time rather than cached on `practice`.
export function renderHowInline(container, instrument, soundingMidi, setup) {
  if (!howKindFor(instrument)) return null;
  const rangeMidi = rangeIsWrittenPitch(instrument) ? soundingMidi - instrument.transposition : soundingMidi;
  const how = computeHow(instrument, rangeMidi, { capo: setup.capo, tuning: setup.tuning, leftHanded: setup.leftHanded, key: setup.harpKey, kit: setup.kit });
  const id = 'howInline' + (++howInlineSeq);
  const toggle = el('button', { type: 'button', class: 'how-inline-toggle', 'aria-expanded': 'false', 'aria-controls': id, text: t('howInline.button') });
  const bodyChildren = [];
  const badgeText = reviewText(instrument);
  if (badgeText) bodyChildren.push(el('p', { class: 'how-inline-badge', role: 'note', text: badgeText }));
  bodyChildren.push(diagramFor(instrument, how));
  bodyChildren.push(el('p', { class: 'how-inline-desc', text: how.description }));
  const body = el('div', { id, class: 'how-inline-body', hidden: 'hidden' }, bodyChildren);
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    body.hidden = expanded;
  });
  const wrapper = el('div', { class: 'how-inline' }, [toggle, body]);
  // Escape collapses THIS expander without closing the whole Songs panel --
  // panels.js's own container-level Escape listener (src/ui/panels.js) only
  // backs off when `ev.defaultPrevented`, so preventDefault() here is load-
  // bearing, not decorative. A collapsed expander does nothing on Escape,
  // so the panel's own handler still gets to close Songs as normal.
  wrapper.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    ev.preventDefault();
    toggle.setAttribute('aria-expanded', 'false');
    body.hidden = true;
    toggle.focus();
  });
  container.appendChild(wrapper);
  return { toggle, body };
}

export function registerFingerings(panels) {
  panels.register({
    id: 'fingerings',
    name: 'How to play it',
    tag: 'reference',
    color: '#f3c52f',
    mount(hostEl, api) {
      let instrument = null;
      let midi = null;
      // Capo, alternate tuning and left-handed are per-instrument choices,
      // remembered across reloads in api.store('fingerings') — shape
      // { byInstrument: { [instrumentId]: { capo, tuning, leftHanded } } }
      // (see src/app.js's `store(id)`, DB.panels[id] as plain JSON). Loaded
      // in selectInstrument() below and saved back on every control change.
      let capo = 0;
      let tuningName = null;
      let leftHanded = false;

      // Reads and validates the store; never throws, never trusts what's in
      // it — a corrupt or hand-edited localStorage blob must not wedge the
      // panel. Unrecognised shapes fall back to an empty byInstrument map.
      // (src/ui/fingerings/setup.js's readFingeringSetup does the per-
      // instrument validation below; this wrapper only adds the try/catch
      // around api.store('fingerings').get() itself.)
      function loadStore() {
        try {
          const raw = api.store('fingerings').get();
          return raw && typeof raw === 'object' && raw.byInstrument && typeof raw.byInstrument === 'object'
            ? raw
            : { byInstrument: {} };
        } catch (e) {
          api.recordError('fingerings:store-load', e);
          return { byInstrument: {} };
        }
      }

      // Validates one instrument's saved entry against what THIS instrument
      // currently allows (alternate tunings differ per instrument, and an
      // instrument swap in instruments/index.js must never resurrect a
      // capo/tuning value that no longer makes sense) — delegated to
      // setup.js's readFingeringSetup (P4-5) so Songs can read the same
      // rule without importing this panel.
      function rememberedFor(id) {
        return readFingeringSetup(loadStore(), instrument && instrument.id === id ? instrument : null);
      }

      function rememberCurrent() {
        if (!instrument) return;
        try {
          const store = loadStore();
          store.byInstrument[instrument.id] = { capo: capo, tuning: tuningName, leftHanded: leftHanded };
          api.store('fingerings').set(store);
        } catch (e) {
          api.recordError('fingerings:store-save', e);
        }
      }

      const title = el('h2', { text: 'How to play it' });
      const help = el('p', { class: 'small', text: 'Pick an instrument and a note to see how to play it, drawn clearly with a plain-text description underneath.' });
      // A visible, honest flag for a record no musician has checked yet
      // (src/instruments/review.js's isReviewed) -- reference help AND the
      // "Show me" inline lesson prompt both funnel through this same panel,
      // so one badge here covers both. Every instrument in this app
      // currently qualifies (all 28 provenance fields are still null), so
      // this is visible on first load, not a rare edge case.
      const reviewHost = el('div', { class: 'fing-review-host' });
      const instrLabel = el('label', { for: 'fingInstrument', text: 'Instrument' });
      const instrSelect = el('select', { id: 'fingInstrument' });
      PLAYABLE.forEach(rec => instrSelect.appendChild(el('option', { value: rec.id, text: rec.name })));

      const capoLabel = el('label', { for: 'fingCapo', text: 'Capo' });
      const capoInput = el('input', { id: 'fingCapo', type: 'number', min: '0', max: '11', value: '0' });
      const tuningLabel = el('label', { for: 'fingTuning', text: 'Tuning' });
      const tuningSelect = el('select', { id: 'fingTuning' });
      const leftHandedLabel = el('label', { for: 'fingLeftHanded', text: 'Left-handed' });
      const leftHandedInput = el('input', { id: 'fingLeftHanded', type: 'checkbox' });
      const controlsHost = el('div', { class: 'fing-row fing-how-controls' });

      const rangeHost = el('div', { class: 'fing-range-host' });
      const notesHost = el('div', { class: 'fing-notes', role: 'group', 'aria-label': 'Notes' });
      const diagramHost = el('div', { class: 'fing-diagram-host' });
      const descHost = el('p', { id: 'fingDesc', class: 'fing-desc' });

      hostEl.appendChild(el('div', { class: 'panel-fingerings' }, [
        title, help, reviewHost,
        el('div', { class: 'fing-row' }, [instrLabel, instrSelect]),
        controlsHost,
        rangeHost, notesHost, diagramHost, descHost
      ]));

      // Reflects instrument.provenance, not the picked note -- only needs
      // recomputing on an instrument switch, in selectInstrument() below.
      function renderReview() {
        reviewHost.innerHTML = '';
        const text = reviewText(instrument);
        if (!text) return;
        reviewHost.appendChild(el('p', { class: 'fing-review-badge', role: 'note', text }));
      }

      // Which of the capo/tuning/left-handed controls apply depends on the
      // diagram kind: a capo and a named alternate tuning are a fretted
      // guitar-family concept ('fretboard' only); left-handed mirroring
      // applies to any string diagram, fretted or fretless.
      function renderControls() {
        controlsHost.innerHTML = '';
        const kind = howKindFor(instrument);
        if (kind === 'fretboard') {
          capoInput.value = String(capo);
          controlsHost.appendChild(capoLabel);
          controlsHost.appendChild(capoInput);
          const alts = alternateTuningsFor(instrument);
          if (alts) {
            tuningSelect.innerHTML = '';
            alts.forEach(name => tuningSelect.appendChild(el('option', { value: name, text: TUNING_LABELS[name] || name })));
            tuningSelect.value = tuningName || alts[0];
            controlsHost.appendChild(tuningLabel);
            controlsHost.appendChild(tuningSelect);
          }
        }
        if (kind === 'fretboard' || kind === 'fingerboard') {
          leftHandedInput.checked = leftHanded;
          controlsHost.appendChild(leftHandedLabel);
          controlsHost.appendChild(leftHandedInput);
        }
      }

      // A drum kit is picked by piece name (its canonical GM note), not by
      // pitch names that mean nothing on a drum; no tone is played for it
      // from this static diagram -- the drum's own sound (drumHit(), a kit
      // key or click in the live trainer) belongs to src/app.js, not here.
      function renderNotePicker() {
        notesHost.innerHTML = '';
        const isKit = howKindFor(instrument) === 'drum-kit';
        const choices = isKit
          ? instrument.kit.map(p => ({ m: p.midi[0], label: p.name }))
          : chromaticRange(instrument.range.low, instrument.range.high).map(m => ({ m, label: noteName(m) }));
        choices.forEach(({ m, label }) => {
          const btn = el('button', { type: 'button', class: 'fing-note-btn', text: label, 'data-midi': String(m), 'aria-pressed': String(m === midi) });
          btn.addEventListener('click', () => {
            midi = m;
            if (!isKit) { try { api.audio(); api.tone(m, api.now(), 0.6, 0.18); } catch (e) { api.recordError('fingerings:tone', e); } }
            render();
          });
          notesHost.appendChild(btn);
        });
      }

      function render() {
        rangeHost.innerHTML = '';
        if (howKindFor(instrument) !== 'drum-kit') rangeHost.appendChild(rangeBar(instrument.range, midi));
        Array.from(notesHost.children).forEach(b => b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-midi')) === midi)));
        const how = computeHow(instrument, midi, { capo, tuning: tuningName, leftHanded, kit: api.db().prefs.kit });
        diagramHost.innerHTML = '';
        diagramHost.appendChild(diagramFor(instrument, how));
        descHost.textContent = how.description;
      }

      function selectInstrument(id) {
        instrument = api.instrument(id) || PLAYABLE.find(r => r.id === id) || PLAYABLE[0];
        instrSelect.value = instrument.id;
        const remembered = rememberedFor(instrument.id);
        capo = remembered.capo;
        tuningName = remembered.tuning;
        leftHanded = remembered.leftHanded;
        renderReview();
        renderControls();
        midi = defaultNoteFor(instrument, {});
        renderNotePicker();
        render();
      }

      instrSelect.addEventListener('change', () => selectInstrument(instrSelect.value));
      capoInput.addEventListener('change', () => { capo = Math.min(11, Math.max(0, Math.round(Number(capoInput.value)) || 0)); capoInput.value = String(capo); rememberCurrent(); render(); });
      tuningSelect.addEventListener('change', () => { tuningName = tuningSelect.value; rememberCurrent(); render(); });
      leftHandedInput.addEventListener('change', () => { leftHanded = leftHandedInput.checked; rememberCurrent(); render(); });

      const current = api.instrument();
      const startId = current && howKindFor(current) ? current.id : (PLAYABLE[0] && PLAYABLE[0].id);
      if (startId) selectInstrument(startId);
      else {
        diagramHost.textContent = 'No instrument here has a fingering chart yet.';
      }

      return { show() { /* content is already current from the last render() */ } };
    }
  });
}
