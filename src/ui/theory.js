// The "Music theory" panel: a graded lesson track, an Explore tab (keys,
// scales and chords, heard and shown on a staff and on the current
// instrument) and a Transpose tab (written vs concert pitch). Wiring note:
// every fact comes from src/core/theory/* -- this file only builds DOM and
// wires it to that pure layer plus panelApi (src/app.js).
import { ALL_KEYS, findKey, signatureFor } from '../core/theory/keys.js';
import { scale, scaleTypes, majorScale, naturalMinorScale, scaleOnInstrument } from '../core/theory/scales.js';
import { chord, chordQualities, voicingsOnFretboard } from '../core/theory/chords.js';
import { transposeKey, spellNotes, writtenToConcert } from '../core/theory/transpose.js';
import { levelCount, make, check } from '../core/theory/lessons.js';
import { spellingToString, parseSpelling } from '../core/theory/pitch.js';
import { layoutMeasure } from '../notation/layout.js';
import { drawPrimitives } from '../notation/draw-canvas.js';
import { byId as instrumentsById, INSTRUMENTS } from '../instruments/index.js';
import { sanitizeLessonState, recordAnswer } from './theory/lesson-state.js';
import { keyboardDiagramKeys } from './theory/keyboard-diagram.js';
import { ascendingMidis, chordMidis } from './theory/scale-run.js';

// Last-rendered lesson question, exposed to the debug hook (w-theory slot in
// src/app.js) so a test can compare against the right answer without
// re-deriving it from DOM text -- never read by anything a learner needs.
let lastLessonQuestion = null;
export function currentLessonQuestion() {
  return lastLessonQuestion;
}

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const VOICING_INSTRUMENTS = [
  { id: 'gtr', label: 'Guitar' },
  { id: 'bass', label: 'Bass' },
  { id: 'uke', label: 'Ukulele' },
];

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach((k) => {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
  }
  (children || []).forEach((c) => c && node.appendChild(c));
  return node;
}

function option(value, label) {
  return el('option', { value }, [document.createTextNode(label)]);
}

// A key's spelling as a chromatic tonic ('F#', 'Bb', ...), used when the
// learner is not choosing a full key but a bare pitch class for a scale/chord.
function chromaticOption(name) {
  return { value: name, pc: parseSpelling(name).pc };
}

function clefFor(rec) {
  if (!rec) return 'treble';
  return rec.clefs.indexOf('grand') >= 0 ? 'grand' : rec.clefs[0];
}

function drawStaff(canvas, midis, keyName) {
  if (!canvas) return;
  const width = canvas.width;
  const { primitives } = layoutMeasure({
    clef: 'treble', key: keyName || 'C', time: [4, 4],
    notes: midis.map((midi) => ({ midi, dur: 1 })),
    width,
  });
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#e9edf6';
  ctx.fillStyle = '#e9edf6';
  ctx.lineWidth = 1;
  drawPrimitives(ctx, primitives, null);
  canvas.__lastPrimitiveCount = primitives.length; // read by tests, harmless in the release build
}

function playChord(api, midis) {
  const ctx = api.audio();
  if (!ctx) return;
  const at = api.now() + 0.05;
  midis.forEach((m) => api.tone(m, at, 1.1, 0.18));
}

function playMelody(api, midis) {
  const ctx = api.audio();
  if (!ctx) return;
  const start = api.now() + 0.05;
  midis.forEach((m, i) => api.tone(m, start + i * 0.32, 0.3, 0.2));
}

function renderFretboard(container, notes, tuning) {
  container.innerHTML = '';
  const table = el('table', { class: 'panel-theory-fretboard' });
  const maxFret = notes.reduce((m, n) => Math.max(m, n.fret), 0);
  const byString = {};
  notes.forEach((n) => { (byString[n.string] = byString[n.string] || []).push(n); });
  for (let s = tuning.length - 1; s >= 0; s--) {
    const row = el('tr');
    row.appendChild(el('th', { scope: 'row' }, [document.createTextNode('String ' + (s + 1))]));
    for (let fret = 0; fret <= maxFret; fret++) {
      const hit = (byString[s] || []).find((n) => n.fret === fret);
      const cell = el('td', {}, [document.createTextNode(hit ? hit.letter + hit.accidental : '')]);
      if (hit) cell.setAttribute('data-degree', String(hit.degree));
      row.appendChild(cell);
    }
    table.appendChild(row);
  }
  container.appendChild(table);
}

function renderVoicingGroup(container, instrumentId, label, built) {
  const rec = instrumentsById[instrumentId];
  if (!rec || !Array.isArray(rec.tuning)) return;
  const group = el('div', { class: 'panel-theory-voicing-group', 'data-instrument': instrumentId });
  group.appendChild(el('h4', {}, [document.createTextNode(label)]));
  const voicings = voicingsOnFretboard(built, rec.tuning).slice(0, 3);
  if (!voicings.length) {
    group.appendChild(el('p', {}, [document.createTextNode('No easy open-position shape found.')]));
  }
  voicings.forEach((v, i) => {
    const shape = v.frets.map((f) => (f === null ? 'x' : String(f))).join(' ');
    group.appendChild(el('p', { class: 'panel-theory-voicing' }, [
      document.createTextNode('Shape ' + (i + 1) + ': ' + shape + ' (low string first)'),
    ]));
  });
  container.appendChild(group);
}

export function register(panels) {
  panels.register({
    id: 'theory', name: 'Music theory', tag: 'learn', color: '#8a6bd6',
    mount(hostEl, api) {
      const root = el('div', { class: 'panel-theory' });
      hostEl.appendChild(root);

      // ---------- tabs ----------
      const tabsBar = el('div', { class: 'panel-theory-tabs', role: 'tablist', 'aria-label': 'Music theory sections' });
      const panelsBox = el('div', { class: 'panel-theory-panels' });
      const TABS = ['lesson', 'explore', 'transpose'];
      const TAB_LABEL = { lesson: 'Lesson', explore: 'Explore', transpose: 'Transpose' };
      const tabButtons = {};
      const tabPanels = {};
      TABS.forEach((id) => {
        const btn = el('button', { type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': 'false' }, [document.createTextNode(TAB_LABEL[id])]);
        btn.addEventListener('click', () => selectTab(id));
        tabsBar.appendChild(btn);
        tabButtons[id] = btn;
        const panel = el('div', { class: 'panel-theory-tabpanel', 'data-tab': id, hidden: 'hidden' });
        panelsBox.appendChild(panel);
        tabPanels[id] = panel;
      });
      root.appendChild(tabsBar);
      root.appendChild(panelsBox);

      function selectTab(id) {
        TABS.forEach((t) => {
          tabButtons[t].setAttribute('aria-selected', String(t === id));
          tabPanels[t].hidden = t !== id;
        });
      }

      // ================= Lesson tab =================
      const lessonPanel = tabPanels.lesson;
      const lessonStatus = el('p', { class: 'panel-theory-status' });
      const questionEl = el('p', { class: 'panel-theory-question', id: 'theoryQuestion' });
      const choicesBox = el('div', { class: 'panel-theory-choices' });
      const feedbackEl = el('p', { class: 'panel-theory-feedback', 'aria-live': 'polite' });
      const nextBtn = el('button', { type: 'button', id: 'theoryNextBtn', hidden: 'hidden' }, [document.createTextNode('Next question')]);
      lessonPanel.appendChild(lessonStatus);
      lessonPanel.appendChild(questionEl);
      lessonPanel.appendChild(choicesBox);
      lessonPanel.appendChild(feedbackEl);
      lessonPanel.appendChild(nextBtn);

      const store = api.store('theory');
      let lessonState = sanitizeLessonState((store.get() || {}), levelCount());
      let question = null;
      let answered = false;

      function saveLessonState() {
        const saved = store.get() || {};
        store.set(Object.assign({}, saved, lessonState));
      }

      function renderStatus() {
        lessonStatus.textContent = 'Level ' + lessonState.level + ' of ' + levelCount() + ' -- streak ' + lessonState.streak + '.';
      }

      function renderQuestion() {
        const instrument = api.instrument();
        question = make(lessonState.level, lessonState.seed, instrument);
        lastLessonQuestion = question;
        answered = false;
        questionEl.textContent = question.prompt;
        choicesBox.innerHTML = '';
        feedbackEl.textContent = '';
        feedbackEl.className = 'panel-theory-feedback';
        nextBtn.hidden = true;
        question.choices.forEach((text) => {
          const b = el('button', { type: 'button', class: 'panel-theory-choice' }, [document.createTextNode(text)]);
          b.addEventListener('click', () => onAnswer(text, b));
          choicesBox.appendChild(b);
        });
        renderStatus();
      }

      function onAnswer(text, btn) {
        if (answered) return;
        answered = true;
        const correct = check(question, text);
        Array.from(choicesBox.children).forEach((b) => {
          b.disabled = true;
          if (b.textContent === question.answer) b.classList.add('panel-theory-correct');
        });
        if (!correct) btn.classList.add('panel-theory-wrong');
        feedbackEl.textContent = question.explain;
        feedbackEl.className = 'panel-theory-feedback ' + (correct ? 'panel-theory-ok' : 'panel-theory-no');
        const { next, leveledUp } = recordAnswer(lessonState, correct, levelCount());
        lessonState = next;
        saveLessonState();
        renderStatus();
        api.say(correct ? 'Correct.' : 'Not quite -- read the explanation below.', correct ? 'ok' : 'no');
        if (leveledUp) api.coach('Three in a row -- moving up to level ' + lessonState.level + '.');
        nextBtn.hidden = false;
        nextBtn.focus();
      }

      nextBtn.addEventListener('click', renderQuestion);

      // ================= Explore tab =================
      const explorePanel = tabPanels.explore;
      const kindSelect = el('select', { id: 'theoryExploreKind' }, [option('key', 'Key'), option('scale', 'Scale'), option('chord', 'Chord')]);
      const keySelect = el('select', { id: 'theoryExploreKey' }, ALL_KEYS.map((k) => option(k.name, k.name + ' ' + k.mode)));
      const tonicSelect = el('select', { id: 'theoryExploreTonic' }, CHROMATIC.map((n) => option(n, n)));
      const scaleTypeSelect = el('select', { id: 'theoryExploreScaleType' }, scaleTypes().map((t) => option(t, t.replace(/_/g, ' '))));
      const chordRootSelect = el('select', { id: 'theoryExploreChordRoot' }, CHROMATIC.map((n) => option(n, n)));
      const qualitySelect = el('select', { id: 'theoryExploreQuality' }, chordQualities().map((q) => option(q, q)));
      const playBtn = el('button', { type: 'button' }, [document.createTextNode('Hear it')]);
      const notesOut = el('p', { id: 'theoryExploreNotes' });
      const sigOut = el('p', { id: 'theoryExploreSignature' });
      const staffCanvas = el('canvas', { id: 'theoryExploreStaff', width: '320', height: '110' });
      const instrumentView = el('div', { id: 'theoryExploreInstrumentView' });

      const keyField = el('label', {}, [document.createTextNode('Key '), keySelect]);
      const tonicField = el('label', { hidden: 'hidden' }, [document.createTextNode('Tonic '), tonicSelect]);
      const scaleTypeField = el('label', { hidden: 'hidden' }, [document.createTextNode('Scale '), scaleTypeSelect]);
      const chordRootField = el('label', { hidden: 'hidden' }, [document.createTextNode('Root '), chordRootSelect]);
      const qualityField = el('label', { hidden: 'hidden' }, [document.createTextNode('Quality '), qualitySelect]);

      explorePanel.appendChild(el('p', {}, [document.createTextNode('Pick a key, scale or chord to hear and see it.')]));
      explorePanel.appendChild(el('label', {}, [document.createTextNode('Show a '), kindSelect]));
      explorePanel.appendChild(keyField);
      explorePanel.appendChild(tonicField);
      explorePanel.appendChild(scaleTypeField);
      explorePanel.appendChild(chordRootField);
      explorePanel.appendChild(qualityField);
      explorePanel.appendChild(playBtn);
      explorePanel.appendChild(sigOut);
      explorePanel.appendChild(notesOut);
      explorePanel.appendChild(staffCanvas);
      explorePanel.appendChild(instrumentView);

      let currentExplore = null; // { midis, playMidis, key/label text for the coach }

      function updateExploreFieldVisibility() {
        const kind = kindSelect.value;
        keyField.hidden = kind !== 'key';
        tonicField.hidden = kind === 'key';
        scaleTypeField.hidden = kind !== 'scale';
        chordRootField.hidden = kind !== 'chord';
        qualityField.hidden = kind !== 'chord';
      }

      function renderExplore() {
        updateExploreFieldVisibility();
        const kind = kindSelect.value;
        instrumentView.innerHTML = '';

        if (kind === 'key') {
          const key = findKey(keySelect.value);
          const built = key.mode === 'major' ? majorScale(key) : naturalMinorScale(key);
          const tonicMidi = 60 + key.tonic;
          const midis = ascendingMidis(tonicMidi, key.mode === 'major' ? 'major' : 'natural_minor');
          const sig = signatureFor(key);
          sigOut.textContent = key.name + ' ' + key.mode + ': ' + (sig.count === 0 ? 'no sharps or flats' : sig.count + ' ' + sig.type + (sig.count === 1 ? '' : 's')) + '.';
          notesOut.textContent = built.degrees.map(spellingToString).join(' ');
          drawStaff(staffCanvas, midis, key.name);
          renderScaleInstrumentView(built, midis.map((m) => ((m % 12) + 12) % 12));
          currentExplore = { melody: midis };
        } else if (kind === 'scale') {
          const tonicName = tonicSelect.value;
          const type = scaleTypeSelect.value;
          const built = scale(tonicName, type);
          const tonicMidi = 60 + parseSpelling(tonicName).pc;
          const midis = ascendingMidis(tonicMidi, type);
          const isDiatonic = type === 'major' || type === 'natural_minor';
          const keyName = isDiatonic ? tonicName + (type === 'natural_minor' ? 'm' : '') : 'C';
          sigOut.textContent = tonicName + ' ' + type.replace(/_/g, ' ') + '.';
          notesOut.textContent = built.degrees.map(spellingToString).join(' ');
          drawStaff(staffCanvas, midis, keyName);
          renderScaleInstrumentView(built, midis.map((m) => ((m % 12) + 12) % 12));
          currentExplore = { melody: midis };
        } else {
          const root = chordRootSelect.value;
          const quality = qualitySelect.value;
          const built = chord(root, quality);
          const rootPc = parseSpelling(root).pc;
          const rootMidi = 60 + rootPc;
          const midis = chordMidis(rootMidi, rootPc, built.pitchClasses);
          sigOut.textContent = root + ' ' + quality + '.';
          notesOut.textContent = built.notes.map(spellingToString).join(' ');
          drawStaff(staffCanvas, midis, 'C');
          VOICING_INSTRUMENTS.forEach((v) => renderVoicingGroup(instrumentView, v.id, v.label, built));
          currentExplore = { chord: midis };
        }
      }

      function renderScaleInstrumentView(built, pcSet) {
        const rec = api.instrument();
        if (rec && Array.isArray(rec.tuning) && rec.tuning.length) {
          const notes = scaleOnInstrument(built, rec);
          renderFretboard(instrumentView, notes, rec.tuning);
        } else if (rec && rec.id === 'kbd') {
          renderKeyboard(instrumentView, pcSet);
        } else {
          const label = rec ? rec.name : 'your instrument';
          instrumentView.appendChild(el('p', {}, [document.createTextNode('On ' + label + ': ' + built.degrees.map(spellingToString).join(', ') + '.')]));
        }
      }

      function renderKeyboard(container, pcSet) {
        const table = el('table', { class: 'panel-theory-keyboard' });
        const row = el('tr');
        keyboardDiagramKeys(pcSet).forEach((k) => {
          const cell = el('td', { class: k.isBlack ? 'panel-theory-key-black' : 'panel-theory-key-white' });
          if (k.active) cell.setAttribute('data-active', 'true');
          cell.textContent = k.letter || '';
          row.appendChild(cell);
        });
        table.appendChild(row);
        container.appendChild(table);
      }

      kindSelect.addEventListener('change', renderExplore);
      keySelect.addEventListener('change', renderExplore);
      tonicSelect.addEventListener('change', renderExplore);
      scaleTypeSelect.addEventListener('change', renderExplore);
      chordRootSelect.addEventListener('change', renderExplore);
      qualitySelect.addEventListener('change', renderExplore);
      playBtn.addEventListener('click', () => {
        if (!currentExplore) return;
        if (currentExplore.chord) playChord(api, currentExplore.chord);
        else if (currentExplore.melody) playMelody(api, currentExplore.melody);
      });

      // ================= Transpose tab =================
      const transposePanel = tabPanels.transpose;
      const transKeySelect = el('select', { id: 'theoryTransposeKey' }, ALL_KEYS.filter((k) => k.mode === 'major').map((k) => option(k.name, k.name + ' major')));
      const transInstSelect = el('select', { id: 'theoryTransposeInstrument' }, INSTRUMENTS.map((r) => option(r.id, r.name)));
      const writtenOut = el('p', { id: 'theoryTransposeWritten' });
      const concertOut = el('p', { id: 'theoryTransposeConcert' });
      const explainOut = el('p', { id: 'theoryTransposeExplain' });
      const writtenCanvas = el('canvas', { id: 'theoryTransposeWrittenStaff', width: '300', height: '110' });
      const concertCanvas = el('canvas', { id: 'theoryTransposeConcertStaff', width: '300', height: '110' });

      transposePanel.appendChild(el('p', {}, [document.createTextNode('Pick a written key and an instrument to see concert pitch alongside it.')]));
      transposePanel.appendChild(el('label', {}, [document.createTextNode('Written key '), transKeySelect]));
      transposePanel.appendChild(el('label', {}, [document.createTextNode('Instrument '), transInstSelect]));
      transposePanel.appendChild(el('h4', {}, [document.createTextNode('Written')]));
      transposePanel.appendChild(writtenOut);
      transposePanel.appendChild(writtenCanvas);
      transposePanel.appendChild(el('h4', {}, [document.createTextNode('Concert pitch')]));
      transposePanel.appendChild(concertOut);
      transposePanel.appendChild(concertCanvas);
      transposePanel.appendChild(explainOut);

      function renderTranspose() {
        const key = findKey(transKeySelect.value);
        const inst = instrumentsById[transInstSelect.value] || instrumentsById.kbd;
        const built = majorScale(key);
        const tonicMidi = 60 + key.tonic;
        const writtenMidis = ascendingMidis(tonicMidi, 'major');
        writtenOut.textContent = key.name + ' major: ' + built.degrees.map(spellingToString).join(' ');
        drawStaff(writtenCanvas, writtenMidis, key.name);

        const concertKey = transposeKey(key, inst.transposition);
        const concertMidis = writtenToConcert(writtenMidis.map((m) => ({ midi: m })), inst).map((n) => n.midi);
        const concertSpelled = spellNotes(concertMidis.map((m) => ({ midi: m })), concertKey);
        concertOut.textContent = concertKey.name + ' major: ' + concertSpelled.map(spellingToString).join(' ');
        drawStaff(concertCanvas, concertMidis, concertKey.name);

        if (inst.transposition === 0) {
          explainOut.textContent = inst.name + ' is not a transposing instrument: written and concert pitch match.';
        } else {
          const dir = inst.transposition < 0 ? 'below' : 'above';
          explainOut.textContent = 'On ' + inst.name + ', concert pitch sounds ' + Math.abs(inst.transposition) + ' semitone(s) ' + dir + ' what is written.';
        }
      }

      transKeySelect.addEventListener('change', renderTranspose);
      transInstSelect.addEventListener('change', renderTranspose);

      // ---------- boot ----------
      renderQuestion();
      renderExplore();
      renderTranspose();
      selectTab('lesson');

      return {
        show() {},
        hide() {},
      };
    },
  });
}
