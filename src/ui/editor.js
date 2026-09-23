// "Record a tune" panel: Listen/Stop capture -> transcribe() (src/song/
// transcribe.js) -> a mandatory "check these" step -> edit with the ops in
// src/song/edit.js, drawn with the notation engine (src/notation/) and
// hit-tested with hitTest -> play back with api.tone -> save to the shared
// song library (src/song/library.js).
//
// Registered as panel "editor" per the Wave-W contract (src/ui/panels.js):
// `register(panels)` calls `panels.register({ id, name, tag, color, mount })`.
import { transcribe } from '../song/transcribe.js';
import { framesFromPCM } from '../audio/file-frames.js';
import { mixToMono } from './playalong/audio-prep.js';
import { rangeForInstrument } from '../audio/range.js';
import {
  moveNote,
  repitch,
  deleteNote,
  insertNote,
  splitNote,
  mergeWithNext,
  setTie,
  setBpm,
  setMetre,
  shiftBarline,
  halveDurations,
  doubleDurations,
  octaveShiftPart,
  createHistory,
  hitTest,
} from '../song/edit.js';
import { validateSong, ticksToSeconds } from '../song/model.js';
import { createLibrary, indexedDbStore, memoryStore } from '../song/library.js';
import { drawPrimitives } from '../notation/draw-canvas.js';
import { createRecorder } from './editor/record.js';
import { layoutSong } from './editor/layout-song.js';

// A cross-panel "load this saved song for editing next time Record a tune is
// shown" request (used by src/ui/learn.js's "Fix it up" button, the same
// pattern src/ui/songs.js's requestOpenSong()/OPEN_REQUEST_STORE_ID already
// uses -- a panel only ever gets its own mounted instance, so there is no
// direct call from one panel's module into another's running closure).
// Backed by this panel's own saved-data slot (api.store), read once by
// mountEditor's show() below and cleared so it never re-fires.
const EDITOR_OPEN_REQUEST_STORE_ID = 'editor-open-request';
export function requestOpenInEditor(api, songId) {
  api.store(EDITOR_OPEN_REQUEST_STORE_ID).set({ songId });
}

// Shared across every unit that writes to the saved-song library — see the
// author brief's "Wiring wave W" section: "every unit uses exactly that
// database name." (src/song/library.js's own header comment shows a
// different example name, 'band-coach-songs'; that file is not this unit's
// to change, so this deliberately follows the brief's literal string rather
// than the comment.)
const LIBRARY_DB_NAME = 'bandcoach-songs';

// transcribe() produces exactly one part, 'melody', UNLESS the "More than
// one note at a time" checkbox sent it opts.polyphonic (src/song/
// transcribe.js), in which case it comes back with one part per voice heard
// (melody/bass/inner/percussion). Editing tools (delete/split/insert/arrow
// keys/etc.) work on whichever part was last clicked in the notation —
// `activePartIndex`, starting at part 0 for every newly loaded song.
let activePartIndex = 0;
const GRID_TICKS = 480 / 4; // a 16th note; the grid every move/insert/quantize snaps to.
const MIN_INSERT_DUR = GRID_TICKS;

const PC_TO_MAJOR_KEY = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC_TO_MINOR_KEY = ['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bm'];

function keyName(key) {
  if (!key) return 'C';
  return key.mode === 'minor' ? PC_TO_MINOR_KEY[key.tonic] : PC_TO_MAJOR_KEY[key.tonic];
}

function clefFor(rec) {
  if (!rec || !Array.isArray(rec.clefs) || !rec.clefs.length) return 'treble';
  return rec.clefs.indexOf('grand') >= 0 ? 'grand' : rec.clefs[0];
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.keys(attrs).forEach((k) => {
    if (k === 'text') node.textContent = attrs[k];
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
    else node.setAttribute(k, attrs[k]);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => c && node.appendChild(c));
  return node;
}

// Test-only escape hatch (wired to window.__coach.editorSetFrames by the
// app.js debug hook, compiled out of the release build with everything else
// __DEBUG_HOOK__ gates): lets a browser test hand Stop a fixed, known set of
// raw pitch frames instead of whatever a fake microphone device produced, so
// transcribe()'s output is deterministic to assert on.
let debugFrames = null;
export function __setDebugFrames(frames) {
  debugFrames = frames;
}

// Same escape hatch, for reading the current Song back out in a test
// (wired to window.__coach.editorSong). Only one editor panel is ever
// mounted, so a module-level pointer is enough.
let debugSong = null;
export function __getDebugSong() {
  return debugSong;
}

// True once recorder.start()'s openMic() has actually resolved and the
// sampling timer is running -- lets a test wait past that async gap instead
// of racing Stop against Listen's own in-flight await.
let debugRecorder = null;
export function __isRecording() {
  return !!(debugRecorder && debugRecorder.listening);
}

export function register(panels) {
  panels.register({
    id: 'editor',
    name: 'Record a tune',
    tag: 'record',
    color: '#5b8dee',
    mount(hostEl, api) {
      return mountEditor(hostEl, api);
    },
  });
}

// Switches to another registered panel the one real, already-shipping way
// any panel switches to another: a click on the app's own panel-picker
// button (src/app.js's buildPanelPicker()/openPanel()) -- same precedent as
// src/ui/learn.js's openSongsPanel(). No-op where no such button exists (a
// host page that never wired panel switching in).
function openOtherPanel(hostEl, panelId) {
  const doc = hostEl.ownerDocument || document;
  const btn = doc.querySelector('#panelPicker button[data-panel="' + panelId + '"]') || doc.querySelector('button[data-panel="' + panelId + '"]');
  if (btn) { btn.click(); return true; }
  return false;
}

function mountEditor(hostEl, api) {
  const recorder = createRecorder(api);
  debugRecorder = recorder;
  let song = null;
  let history = null;
  let report = null;
  let acknowledged = false;
  let selected = null; // note index into song.parts[activePartIndex].notes, or null
  let hitboxes = [];
  let library = null;
  let playing = false;

  // ---- library (lazy: IndexedDB in the real app, memory when it throws) ---
  function getLibrary() {
    if (library) return library;
    try {
      library = createLibrary(indexedDbStore(indexedDB, LIBRARY_DB_NAME));
    } catch (e) {
      library = createLibrary(memoryStore());
    }
    return library;
  }

  // ---- DOM ---------------------------------------------------------------
  const titleInput = el('input', {
    type: 'text', id: 'editorTitle', value: 'My recording',
    'aria-label': 'Song title',
  });
  const listenBtn = el('button', { type: 'button', id: 'editorListenBtn', text: 'Listen' });
  const recordStatus = el('span', { class: 'editor-status', 'aria-live': 'polite' });
  const fileInput = el('input', { type: 'file', id: 'editorFileInput', accept: 'audio/*' });
  // Off by default: multipitch detection (src/song/transcribe.js's
  // opts.polyphonic) costs real accuracy on a single clean melody line, so a
  // learner recording just one instrument should get the plain monophonic
  // path unless they ask for more. Read only from the file-import path — the
  // live-mic Listen/Stop path is unchanged.
  const polyphonicCheckbox = el('input', { type: 'checkbox', id: 'editorPolyphonic' });

  const checkBox = el('div', { class: 'editor-check', id: 'editorCheck', hidden: 'hidden' });
  const checkList = el('ul');
  const ackCheckbox = el('input', { type: 'checkbox', id: 'editorAck' });
  checkBox.append(
    el('p', { text: "Before you practise or save, check these — the computer guessed and isn't sure:" }),
    checkList,
    el('label', { for: 'editorAck' }, [ackCheckbox, document.createTextNode(" I've checked these")]),
  );

  const say = el('p', { class: 'editor-say', 'aria-live': 'polite' });
  // api.say (panelApi) writes to the main trainer's #feedback element, which
  // is hidden for as long as any panel (including this one) is open — so it
  // has no visible effect while a learner is looking at this screen. Called
  // anyway, alongside this panel's own visible message, on the chance that
  // gets fixed; the visible copy lives here regardless.
  function tell(text, kind) {
    say.textContent = text;
    say.className = 'editor-say' + (kind ? ' ' + kind : '');
    api.say(text, kind);
  }

  const canvas = el('canvas', { class: 'editor-canvas', id: 'editorCanvas', tabindex: '0', 'aria-label': 'The recorded song, as sheet music. Use arrow keys to select and move notes, plus/minus to change pitch, Delete to remove, Ctrl+Z to undo, Ctrl+Y to redo.' });

  const bpmInput = el('input', { type: 'number', id: 'editorBpm', min: '20', max: '300', 'aria-label': 'Beats per minute' });
  const metreNum = el('input', { type: 'number', id: 'editorMetreNum', min: '1', max: '32', 'aria-label': 'Beats per bar' });
  const metreDen = el('select', { id: 'editorMetreDen', 'aria-label': 'Note value of one beat' });
  [1, 2, 4, 8, 16, 32, 64].forEach((d) => metreDen.appendChild(el('option', { value: String(d), text: '/' + d })));
  const pickupInput = el('input', { type: 'number', id: 'editorPickup', min: '0', step: String(GRID_TICKS), value: '0', 'aria-label': 'Pickup length in ticks' });

  const btn = (label, onClick, extra = {}) => el('button', { type: 'button', text: label, onclick: onClick, ...extra });

  const playBtn = btn('Play', playSong, { id: 'editorPlayBtn' });
  const saveBtn = btn('Save to my songs', saveSong, { id: 'editorSaveBtn' });
  const undoBtn = btn('Undo', () => { if (!history) return; setSongState(history.undo()); render(); }, { id: 'editorUndoBtn' });
  const redoBtn = btn('Redo', () => { if (!history) return; setSongState(history.redo()); render(); }, { id: 'editorRedoBtn' });
  const deleteBtn = btn('Delete note', () => {
    if (selected === null) return;
    applyOp((s) => deleteNote(s, activePartIndex, selected), { clearSelection: true });
  });
  const splitBtn = btn('Split note in half', () => {
    if (selected === null) return;
    const note = song.parts[activePartIndex].notes[selected];
    applyOp((s) => splitNote(s, activePartIndex, selected, Math.max(1, Math.round(note.dur / 2))));
  });
  const mergeBtn = btn('Merge with next', () => {
    if (selected === null) return;
    applyOp((s) => mergeWithNext(s, activePartIndex, selected));
  });
  const tieBtn = btn('Tie to previous', () => {
    if (selected === null) return;
    applyOp((s) => setTie(s, activePartIndex, selected, !isTied()));
  });
  const insertBtn = btn('Insert note', insertHere);
  // halveDurations/doubleDurations (src/song/edit.js) rescale every note's
  // ticks and the song's bpm by the SAME factor, so the tune keeps its
  // speed and only the notation changes. (Until 2026-09-19 bpm moved the
  // other way, which made playback four times too fast; tests/unit/
  // editor-ops.test.mjs now pins the sounding position of a note.)
  const halveBtn = btn('Halve note values (the tune keeps its speed)', () => applyOp((s) => halveDurations(s)));
  const doubleBtn = btn('Double note values (the tune keeps its speed)', () => applyOp((s) => doubleDurations(s)));
  const octaveUpBtn = btn('Whole song up an octave', () => applyOp((s) => octaveShiftPart(s, activePartIndex, 1)));
  const octaveDownBtn = btn('Whole song down an octave', () => applyOp((s) => octaveShiftPart(s, activePartIndex, -1)));
  const pickupBtn = btn('Shift barline (pickup)', () => {
    const ticks = Number(pickupInput.value) || 0;
    applyOp((s) => shiftBarline(s, ticks));
  });

  bpmInput.addEventListener('change', () => {
    const v = Number(bpmInput.value);
    if (v > 0) applyOp((s) => setBpm(s, v));
  });
  const applyMetre = () => {
    const num = Math.max(1, Math.round(Number(metreNum.value) || 4));
    const den = Number(metreDen.value) || 4;
    applyOp((s) => setMetre(s, { num, den }));
  };
  metreNum.addEventListener('change', applyMetre);
  metreDen.addEventListener('change', applyMetre);

  const toolbar = el('div', { class: 'editor-toolbar' }, [
    playBtn, saveBtn, undoBtn, redoBtn, deleteBtn, splitBtn, mergeBtn, tieBtn, insertBtn,
    el('label', { for: 'editorBpm', text: 'Tempo (bpm)' }), bpmInput,
    el('label', { for: 'editorMetreNum', text: 'Beats/bar' }), metreNum, metreDen,
    el('label', { for: 'editorPickup', text: 'Pickup (ticks)' }), pickupInput, pickupBtn,
    halveBtn, doubleBtn, octaveUpBtn, octaveDownBtn,
  ]);

  // Pointer to the one shared door (plan §11.5.7): Listen/Stop and this file
  // input keep working exactly as before (existing tests use them directly),
  // this just tells a learner where the newer, simpler door is.
  const learnTipBtn = el('button', { type: 'button', id: 'editorLearnTipBtn', class: 'small', text: 'Open Learn this' });
  learnTipBtn.addEventListener('click', () => openOtherPanel(hostEl, 'learn'));
  const learnTip = el('p', { class: 'editor-learn-tip' }, [
    document.createTextNode('Tip: Learn this takes any recording or music file in one place. '), learnTipBtn,
  ]);

  const root = el('div', { class: 'panel-editor' }, [
    el('h2', { text: 'Record a tune' }),
    el('p', { text: 'Press Listen, play or sing your tune, then press Stop. It will write down what it heard so you can fix it up and practise it.' }),
    learnTip,
    el('div', { class: 'editor-record' }, [
      el('label', { for: 'editorTitle', text: 'Title' }), titleInput, listenBtn, recordStatus,
      el('label', { for: 'editorFileInput', text: 'Or choose an audio file' }), fileInput,
      el('label', { for: 'editorPolyphonic', text: 'More than one note at a time' }), polyphonicCheckbox,
    ]),
    checkBox,
    toolbar,
    canvas,
    say,
  ]);
  hostEl.appendChild(root);
  setControlsEnabled(false);

  // ---- recording -----------------------------------------------------
  listenBtn.addEventListener('click', async () => {
    if (recorder.listening) {
      const captured = recorder.stop();
      const frames = debugFrames !== null ? debugFrames : captured;
      debugFrames = null;
      listenBtn.textContent = 'Listen';
      recordStatus.textContent = 'Working it out…';
      // Disabled across the yield below so a click landing in this gap can't
      // race Stop's own transcribe() -- the button re-enables once
      // loadTranscription has run. One task yield (not e.g. a promise
      // microtask) so the browser actually paints "Working it out…" before
      // transcribe() -- synchronous CPU work -- runs; without it the status
      // text is overwritten by loadTranscription() in the very same task and
      // a learner never sees it (src/ui/editor.js's own setTimeout(...,
      // duration) pattern below is the precedent this borrows).
      listenBtn.disabled = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = transcribe(frames, { title: titleInput.value || 'My recording' });
      loadTranscription(result);
      listenBtn.disabled = false;
      return;
    }
    // Disabled synchronously, before the await, so a second tap while
    // openMic() is still pending can't reach recorder.start() at all --
    // mirrors src/ui/playalong.js's startRecordingCapture(), which disables
    // its own record button the same way before opening the mic.
    listenBtn.disabled = true;
    try {
      listenBtn.textContent = 'Stop';
      recordStatus.textContent = 'Listening…';
      await recorder.start();
      listenBtn.disabled = false;
    } catch (e) {
      api.recordError('editor:listen', e);
      listenBtn.textContent = 'Listen';
      recordStatus.textContent = '';
      listenBtn.disabled = false;
      tell('The microphone could not be opened.', 'no');
    }
  });

  // ---- transcribing from a chosen audio file (instead of the microphone) --
  // Same destination as Listen/Stop: decode the file to mono PCM (mirroring
  // src/ui/playalong.js's loadFile), walk it with framesFromPCM
  // (src/audio/file-frames.js) into the same frame/onset shape the mic
  // produces, then hand it to the same transcribe() -> loadTranscription()
  // path so a file-picked tune lands in the same mandatory check-list step.
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      recordStatus.textContent = 'Working it out…';
      const actx = api.audio();
      if (!actx) throw new Error('audio is not available');
      const audioBuffer = await actx.decodeAudioData(await file.arrayBuffer());
      const channels = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c));
      const pcm = mixToMono(channels);
      const { fmin, fmax } = rangeForInstrument(typeof api.instrument === 'function' ? api.instrument() : null);
      const { frames, onsets } = framesFromPCM(pcm, audioBuffer.sampleRate, { fmin, fmax });
      const polyphonic = polyphonicCheckbox.checked ? { pcm, sampleRate: audioBuffer.sampleRate } : undefined;
      const result = transcribe(frames, { title: titleInput.value || 'My recording', onsets, polyphonic });
      loadTranscription(result);
    } catch (e) {
      api.recordError('editor:file', e);
      recordStatus.textContent = '';
      tell('That file could not be read as audio. Try a different file, such as a .wav or .mp3.', 'no');
    } finally {
      fileInput.value = '';
    }
  });

  // A song handed over already-built (src/ui/learn.js's "Fix it up"), rather
  // than one just transcribed here -- it was already validated by whoever
  // saved it, so there is no needsCheck list to gate behind; editing tools
  // unlock immediately, same as after a check list has been acknowledged.
  function loadSong(loadedSong) {
    song = loadedSong;
    debugSong = song;
    report = { notesCaptured: song.parts[0] ? song.parts[0].notes.length : 0, needsCheck: [] };
    history = createHistory(song);
    selected = null;
    activePartIndex = 0;
    acknowledged = true;
    titleInput.value = song.title;
    renderCheckList();
    recordStatus.textContent = 'Loaded "' + song.title + '" for editing.';
    setControlsEnabled(true);
    render();
  }

  // A pending requestOpenInEditor() -- read once, on the very next show(),
  // then cleared so it never re-fires the next time a learner opens this
  // panel normally. A song this panel cannot find (removed, or from a store
  // that failed to open) is silently skipped, same precedent as songs.js's
  // own checkOpenRequest().
  async function checkOpenRequest() {
    const req = api.store(EDITOR_OPEN_REQUEST_STORE_ID).get();
    if (!req || !req.songId) return;
    api.store(EDITOR_OPEN_REQUEST_STORE_ID).set(null);
    const loaded = await getLibrary().get(req.songId);
    if (!loaded) return;
    loadSong(loaded);
  }

  function loadTranscription(result) {
    song = result.song;
    debugSong = song;
    report = result.report;
    history = createHistory(song);
    selected = null;
    activePartIndex = 0;
    acknowledged = false;
    renderCheckList();
    recordStatus.textContent = 'Captured ' + report.notesCaptured + ' notes.';
    setControlsEnabled(false);
    render();
  }

  function renderCheckList() {
    checkList.innerHTML = '';
    (report.needsCheck || []).forEach((line) => checkList.appendChild(el('li', { text: line })));
    checkBox.hidden = !(report.needsCheck && report.needsCheck.length);
    ackCheckbox.checked = false;
  }

  ackCheckbox.addEventListener('change', () => {
    acknowledged = ackCheckbox.checked;
    setControlsEnabled(acknowledged && !!song);
  });

  function setControlsEnabled(on) {
    [playBtn, saveBtn, undoBtn, redoBtn, deleteBtn, splitBtn, mergeBtn, tieBtn, insertBtn,
      bpmInput, metreNum, metreDen, pickupInput, pickupBtn, halveBtn, doubleBtn, octaveUpBtn, octaveDownBtn,
      canvas].forEach((node) => { node.disabled = !on; });
    canvas.setAttribute('aria-disabled', String(!on));
  }

  // ---- editing ---------------------------------------------------------
  function setSongState(s) {
    song = s;
    debugSong = song;
    syncFormFields();
  }

  function syncFormFields() {
    if (!song) return;
    bpmInput.value = String(Math.round(song.bpm * 100) / 100);
    metreNum.value = String(song.metre.num);
    metreDen.value = String(song.metre.den);
  }

  // opFn(song) -> Song | { song, changed } (any op above). Runs it through
  // history so undo/redo cover it, updates selection from `changed` when
  // given, and re-renders.
  function applyOp(opFn, { clearSelection = false } = {}) {
    if (!song || !history) return;
    let result;
    try {
      result = history.apply(opFn);
    } catch (e) {
      api.recordError('editor:op', e);
      tell('That could not be done.', 'no');
      return;
    }
    setSongState(history.current());
    if (clearSelection) {
      selected = null;
    } else if (result && Array.isArray(result.changed) && result.changed.length) {
      const last = result.changed[result.changed.length - 1];
      selected = typeof last === 'number' ? last : selected;
    }
    render();
  }

  function isTied() {
    if (selected === null) return false;
    const note = song.parts[activePartIndex].notes[selected];
    return !!(note && note.tieFromPrev);
  }

  function insertHere() {
    const notes = song.parts[activePartIndex].notes;
    const base = selected !== null && notes[selected] ? notes[selected] : notes[notes.length - 1];
    const start = base ? base.start + base.dur : 0;
    const midi = base ? base.midi : 60;
    applyOp((s) => insertNote(s, activePartIndex, { start, dur: MIN_INSERT_DUR, midi }));
  }

  // ---- drawing + hit testing --------------------------------------------
  function render() {
    if (!song) {
      canvas.width = 300;
      canvas.height = 40;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillText('Nothing recorded yet.', 10, 20);
      hitboxes = [];
      return;
    }
    const rec = api.instrument();
    const clef = clefFor(rec);
    const width = Math.max(220, Math.min(340, (hostEl.clientWidth || 340) - 20));
    // One lane per part (src/ui/editor/layout-song.js already lays out one
    // part at a time), stacked vertically with a text label above each when
    // there is more than one -- a mono song keeps today's single, unlabelled
    // staff exactly as before. Each hitbox is tagged with the part it came
    // from so a click on any lane both selects the note AND makes that
    // lane's part the one the toolbar/keyboard edit.
    const LABEL_HEIGHT = song.parts.length > 1 ? 18 : 0;
    let yOffset = 0;
    const lanes = song.parts.map((part, pIndex) => {
      const layout = layoutSong(song, pIndex, { clef, key: keyName(song.key), width });
      const laneY0 = yOffset;
      yOffset += LABEL_HEIGHT + layout.barCount * layout.rowHeight;
      return { part, pIndex, layout, laneY0 };
    });
    canvas.width = width;
    canvas.height = yOffset + 10;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hitboxes = [];
    lanes.forEach(({ part, pIndex, layout, laneY0 }) => {
      if (LABEL_HEIGHT) {
        ctx.save();
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#1a1a1a';
        ctx.fillText(part.name || part.role || ('Part ' + (pIndex + 1)), 4, laneY0 + 13);
        ctx.restore();
      }
      ctx.strokeStyle = '#1a1a1a';
      ctx.fillStyle = '#1a1a1a';
      ctx.lineWidth = 1.2;
      ctx.font = '20px serif';
      layout.rows.forEach((row) => {
        ctx.save();
        ctx.translate(0, laneY0 + LABEL_HEIGHT + row.y0);
        drawPrimitives(ctx, row.primitives, {});
        ctx.restore();
      });
      layout.hitboxes.forEach((h) => hitboxes.push({ ...h, y: h.y + laneY0 + LABEL_HEIGHT, partIndex: pIndex }));
    });
    if (selected !== null) {
      const box = hitboxes.find((h) => h.noteIndex === selected && h.partIndex === activePartIndex);
      if (box) {
        ctx.strokeStyle = '#5b8dee';
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      }
    }
  }

  canvas.addEventListener('click', (ev) => {
    if (!song) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const box = hitTest(hitboxes, x, y, 6);
    if (box) {
      activePartIndex = typeof box.partIndex === 'number' ? box.partIndex : activePartIndex;
      selected = box.noteIndex;
      render();
    }
  });

  canvas.addEventListener('keydown', (ev) => {
    if (!song || canvas.disabled) return;
    if (ev.ctrlKey && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); undoBtn.click(); return; }
    if (ev.ctrlKey && (ev.key === 'y' || ev.key === 'Y')) { ev.preventDefault(); redoBtn.click(); return; }
    const notes = song.parts[activePartIndex].notes;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      if (!notes.length) return;
      if (selected === null) { selected = 0; }
      else { selected = Math.max(0, Math.min(notes.length - 1, selected + (ev.key === 'ArrowRight' ? 1 : -1))); }
      render();
      return;
    }
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (selected === null) return;
      const note = notes[selected];
      const delta = ev.key === 'ArrowDown' ? GRID_TICKS : -GRID_TICKS;
      applyOp((s) => moveNote(s, activePartIndex, selected, Math.max(0, note.start + delta), GRID_TICKS));
      return;
    }
    if (ev.key === '+' || ev.key === '=') {
      ev.preventDefault();
      if (selected === null) return;
      applyOp((s) => repitch(s, activePartIndex, selected, { semitones: 1 }));
      return;
    }
    if (ev.key === '-' || ev.key === '_') {
      ev.preventDefault();
      if (selected === null) return;
      applyOp((s) => repitch(s, activePartIndex, selected, { semitones: -1 }));
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      if (selected === null) return;
      deleteBtn.click();
      return;
    }
  });

  // ---- playback ----------------------------------------------------------
  // Plays every part together, not just the active one -- "hear more than
  // one note at a time" is the whole point of a polyphonic transcription; a
  // mono song still has exactly one part, so this is unchanged for it.
  function playSong() {
    if (!song || playing) return;
    playing = true;
    const t0 = api.now() + 0.1;
    let totalEndTicks = 0;
    song.parts.forEach((part) => {
      part.notes.forEach((n) => {
        const at = t0 + ticksToSeconds(n.start, song.bpm);
        const dur = Math.max(0.05, ticksToSeconds(n.dur, song.bpm));
        api.tone(n.midi, at, dur, 0.22);
        totalEndTicks = Math.max(totalEndTicks, n.start + n.dur);
      });
    });
    const totalDur = totalEndTicks ? ticksToSeconds(totalEndTicks, song.bpm) : 0;
    setTimeout(() => { playing = false; }, (totalDur + 0.2) * 1000);
  }

  // ---- save ----------------------------------------------------------
  async function saveSong() {
    if (!song) return;
    const named = { ...song, title: titleInput.value || song.title };
    const { ok, errors } = validateSong(named);
    if (!ok) {
      api.recordError('editor:save', new Error(errors.join('; ')));
      tell('That song could not be saved: ' + errors[0], 'no');
      return;
    }
    try {
      await getLibrary().add(named, { now: Date.now() });
      tell('Saved to your songs.', 'ok');
    } catch (e) {
      api.recordError('editor:save', e);
      tell('That song could not be saved.', 'no');
    }
  }

  return {
    show() {
      checkOpenRequest();
      render();
    },
    hide() {
      if (recorder.listening) {
        recorder.stop();
        listenBtn.textContent = 'Listen';
      }
    },
  };
}
