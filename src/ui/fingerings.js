// "How to play it" panel (Wave W, unit w-fingerings): pick an instrument and
// a note, see how to sound it drawn clearly, with a text description for
// screen readers, plus the instrument's playable range. All the musical
// computation lives in src/ui/fingerings/how.js (pure, unit tested); this
// file is just DOM.
import { INSTRUMENTS } from '../instruments/index.js';
import { howKindFor, computeHow, defaultNoteFor, alternateTuningsFor } from './fingerings/how.js';
import { noteName, chromaticRange } from './fingerings/notes.js';

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

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.keys(attrs || {}).forEach(k => {
    if (k === 'text') node.textContent = attrs[k];
    else if (k in node && k !== 'list') node[k] = attrs[k];
    else node.setAttribute(k, attrs[k]);
  });
  (children || []).forEach(c => c && node.appendChild(c));
  return node;
}

function rangeBar(range, midi) {
  const span = Math.max(1, range.high - range.low);
  const pct = Math.min(100, Math.max(0, ((midi - range.low) / span) * 100));
  const bar = el('div', { className: 'fing-range', role: 'img', 'aria-label': 'Playable range ' + noteName(range.low) + ' to ' + noteName(range.high) + ', current note ' + noteName(midi) });
  bar.appendChild(el('div', { className: 'fing-range-fill', style: 'width:' + pct + '%' }));
  bar.appendChild(el('div', { className: 'fing-range-marker', style: 'left:' + pct + '%' }));
  const labels = el('div', { className: 'fing-range-labels' }, [
    el('span', { text: noteName(range.low) }),
    el('span', { text: noteName(range.high) })
  ]);
  const wrap = el('div', { className: 'fing-range-wrap' }, [bar, labels]);
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
  const box = el('div', { className: 'fing-fretboard', role: 'img', 'aria-label': how.description });
  stringRowOrder(strings, how.leftHanded).forEach(s => {
    const row = el('div', { className: 'fing-string' });
    row.appendChild(el('span', { className: 'fing-string-label', text: noteName(tuning[s] + how.capo) }));
    for (let f = 0; f <= maxFret; f++) {
      const hit = how.positions.find(p => p.stringIndex === s && p.fret === f);
      row.appendChild(el('span', { className: 'fing-fret' + (hit ? ' fing-hit' : ''), text: hit ? '●' : '' }));
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
  const box = el('div', { className: 'fing-fingerboard', role: 'img', 'aria-label': how.description });
  stringRowOrder(strings, how.leftHanded).forEach(s => {
    const hit = how.positions.find(p => p.stringIndex === s);
    const row = el('div', { className: 'fing-fboard-string' });
    row.appendChild(el('span', { className: 'fing-string-label', text: noteName(tuning[s]) }));
    const track = el('div', { className: 'fing-fboard-track' });
    if (hit) {
      const pct = Math.min(100, (hit.fret / Math.max(1, maxFret)) * 100);
      track.appendChild(el('span', { className: 'fing-fboard-marker', style: 'left:' + pct + '%' }));
    }
    row.appendChild(track);
    box.appendChild(row);
  });
  return box;
}

function brassDiagram(instrument, how) {
  const s = how.result.standard;
  const box = el('div', { className: 'fing-brass', role: 'img', 'aria-label': how.description });
  if (!s) { box.appendChild(el('p', { text: 'No fingering found.' })); return box; }
  if (how.kind === 'brass-valves') {
    const engaged = s.label === 'open' ? [] : s.label.split('-').map(Number);
    const valveCount = how.hasFourthValve ? 4 : 3;
    for (let v = 1; v <= valveCount; v++) {
      box.appendChild(el('span', { className: 'fing-valve' + (engaged.includes(v) ? ' fing-hit' : ''), text: String(v) }));
    }
  } else {
    box.appendChild(el('div', { className: 'fing-slide' }, [
      el('span', { className: 'fing-slide-pos', text: 'Position ' + s.position })
    ]));
  }
  if (s.sharp || s.needsCheck) box.appendChild(el('p', { className: 'fing-warn', text: s.sharp ? 'Tends to run sharp.' : 'Unusual high partial — check pitch by ear.' }));
  return box;
}

function harmonicaDiagram(instrument, how) {
  const box = el('div', { className: 'fing-harmonica', role: 'img', 'aria-label': how.description });
  const best = how.options[0];
  for (let hole = 1; hole <= 10; hole++) {
    const hit = best && best.hole === hole;
    const cell = el('div', { className: 'fing-hole' + (hit ? ' fing-hit' : '') });
    cell.appendChild(el('span', { text: String(hole) }));
    if (hit) cell.appendChild(el('small', { text: best.action + (best.semitonesBent ? ' ↓' + best.semitonesBent : '') }));
    box.appendChild(cell);
  }
  return box;
}

function recorderDiagram(instrument, how) {
  const box = el('div', { className: 'fing-recorder', role: 'img', 'aria-label': how.description });
  if (!how.entry) { box.appendChild(el('p', { text: 'No fingering in this chart for this note.' })); return box; }
  const hasThumb = how.instrumentKind === 'recorder';
  how.entry.holes.split('').forEach((c, i) => {
    const label = hasThumb ? (i === 0 ? 'T' : String(i)) : String(i + 1);
    const state = c === 'x' ? 'fing-hit' : c === 'h' ? 'fing-half' : '';
    box.appendChild(el('span', { className: 'fing-recorder-hole ' + state, text: label }));
  });
  return box;
}

function voiceDiagram(instrument, how) {
  return el('div', { className: 'fing-voice', role: 'img', 'aria-label': how.description }, [
    el('p', { text: how.playable ? 'Sing this pitch — no fingering needed.' : 'Try the nearest comfortable octave of this pitch.' })
  ]);
}

function diagramFor(instrument, how) {
  if (how.kind === 'fretboard') return fretboardDiagram(instrument, how);
  if (how.kind === 'fingerboard') return fingerboardDiagram(instrument, how);
  if (how.kind === 'brass-valves' || how.kind === 'brass-slide') return brassDiagram(instrument, how);
  if (how.kind === 'harmonica') return harmonicaDiagram(instrument, how);
  if (how.kind === 'recorder' || how.kind === 'whistle') return recorderDiagram(instrument, how);
  return voiceDiagram(instrument, how);
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
      // Capo, alternate tuning and left-handed are per-instrument, session-
      // only choices (no persistence layer reaches this file without
      // touching src/app.js — out of scope here): they reset whenever the
      // learner switches instruments below.
      let capo = 0;
      let tuningName = null;
      let leftHanded = false;

      const title = el('h2', { text: 'How to play it' });
      const help = el('p', { className: 'small', text: 'Pick an instrument and a note to see how to play it, drawn clearly with a plain-text description underneath.' });
      const instrLabel = el('label', { htmlFor: 'fingInstrument', text: 'Instrument' });
      const instrSelect = el('select', { id: 'fingInstrument' });
      PLAYABLE.forEach(rec => instrSelect.appendChild(el('option', { value: rec.id, text: rec.name })));

      const capoLabel = el('label', { htmlFor: 'fingCapo', text: 'Capo' });
      const capoInput = el('input', { id: 'fingCapo', type: 'number', min: '0', max: '11', value: '0' });
      const tuningLabel = el('label', { htmlFor: 'fingTuning', text: 'Tuning' });
      const tuningSelect = el('select', { id: 'fingTuning' });
      const leftHandedLabel = el('label', { htmlFor: 'fingLeftHanded', text: 'Left-handed' });
      const leftHandedInput = el('input', { id: 'fingLeftHanded', type: 'checkbox' });
      const controlsHost = el('div', { className: 'fing-row fing-how-controls' });

      const rangeHost = el('div', { className: 'fing-range-host' });
      const notesHost = el('div', { className: 'fing-notes', role: 'group', 'aria-label': 'Notes' });
      const diagramHost = el('div', { className: 'fing-diagram-host' });
      const descHost = el('p', { id: 'fingDesc', className: 'fing-desc' });

      hostEl.appendChild(el('div', { className: 'panel-fingerings' }, [
        title, help,
        el('div', { className: 'fing-row' }, [instrLabel, instrSelect]),
        controlsHost,
        rangeHost, notesHost, diagramHost, descHost
      ]));

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

      function renderNotePicker() {
        notesHost.innerHTML = '';
        chromaticRange(instrument.range.low, instrument.range.high).forEach(m => {
          const btn = el('button', { type: 'button', className: 'fing-note-btn', text: noteName(m), 'aria-pressed': String(m === midi) });
          btn.addEventListener('click', () => {
            midi = m;
            try { api.audio(); api.tone(m, api.now(), 0.6, 0.18); } catch (e) { api.recordError('fingerings:tone', e); }
            render();
          });
          notesHost.appendChild(btn);
        });
      }

      function render() {
        rangeHost.innerHTML = '';
        rangeHost.appendChild(rangeBar(instrument.range, midi));
        Array.from(notesHost.children).forEach(b => b.setAttribute('aria-pressed', String(b.textContent === noteName(midi))));
        const how = computeHow(instrument, midi, { capo, tuning: tuningName, leftHanded });
        diagramHost.innerHTML = '';
        diagramHost.appendChild(diagramFor(instrument, how));
        descHost.textContent = how.description;
      }

      function selectInstrument(id) {
        instrument = api.instrument(id) || PLAYABLE.find(r => r.id === id) || PLAYABLE[0];
        instrSelect.value = instrument.id;
        capo = 0;
        tuningName = null;
        leftHanded = false;
        renderControls();
        midi = defaultNoteFor(instrument, {});
        renderNotePicker();
        render();
      }

      instrSelect.addEventListener('change', () => selectInstrument(instrSelect.value));
      capoInput.addEventListener('change', () => { capo = Math.max(0, Math.round(Number(capoInput.value)) || 0); render(); });
      tuningSelect.addEventListener('change', () => { tuningName = tuningSelect.value; render(); });
      leftHandedInput.addEventListener('change', () => { leftHanded = leftHandedInput.checked; render(); });

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
