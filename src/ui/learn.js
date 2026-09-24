// "Learn this" panel (plan §11.5.7, unit G1a -- the FILE door only): one
// drop zone + file picker that turns any dropped/picked music file into a
// song the learner can practise, without ever asking "is this a recording
// or a music file?" (the plan's "any source, one door" acceptance,
// §11.5.1) -- learnSourceFor (src/ui/learn/source.js) answers that
// silently.
//
// A notation file (midi/abc/musicxml/gp7/gp5) is routed and imported exactly
// the way src/ui/songs.js's own file input already does (routeImportFile +
// importerFor, src/ui/songs/import-route.js). An audio recording is decoded
// and transcribed through the EXACT SAME pipeline src/ui/editor.js's file
// input already uses for "Record a tune" -- decodeAudioData -> mixToMono
// (src/ui/playalong/audio-prep.js) -> framesFromPCM (src/audio/
// file-frames.js) -> transcribe (src/song/transcribe.js) -- so a file
// picked here reads no differently than one picked there; nothing about
// pitch tracking is reimplemented in this file.
//
// Either way the result lands in the SAME shared song library Songs reads
// from (src/song/library.js, the same 'bandcoach-songs' IndexedDB
// database), then this panel shows: the song's title, any warnings as a
// plain check list, a confidence-coloured note strip when the result
// carries per-note confidence (every transcribed note does; an imported
// notation file's notes do not, and the strip is simply skipped -- no
// invented number), the same "Play it on…" instrument-card row Songs shows
// (src/ui/songs.js's renderPlayItOnCards, reused unchanged), and a
// "Practise this" button that hands off to Songs's own lesson (src/ui/
// songs.js's requestOpenSong() + a click on the real panel-picker button --
// see openSongsPanel() below for why a click, not a direct call).
//
// Recording via the microphone is this unit's own addition (G1b): a
// "Record" button that counts the learner in for four beats (clicks via
// panelApi.click(), the same clock/click every other count-in in the app
// already uses -- see app.js's startBar/startGroove) with a visible "1 2 3
// 4" and a live level meter, then starts capturing on the downbeat through
// the EXACT SAME frame recorder the older "Record a tune" panel uses
// (src/ui/editor/record.js's createRecorder -- reused, not reimplemented)
// and the same transcribe() the file door above already calls. Either mic
// or file ends at the one shared result view below. Retiring the older
// Record a tune / Play Along / Songs-file-button panels is a separate, later
// unit (G1c).
import { learnSourceFor } from './learn/source.js';
import { routeImportFile, importerFor } from './songs/import-route.js';
import { validateSong } from '../song/model.js';
import { createLibrary, memoryStore, indexedDbStore } from '../song/library.js';
import { renderReview, makeHandoffs } from './songs/review.js';
// practiceGate now lives in songs/review.js (P3-2, a behaviour-preserving
// move) -- re-exported here unchanged so tests/unit/learn-practice-gate.
// test.mjs, which imports it from this file, keeps passing untouched.
export { practiceGate } from './songs/review.js';
// The mic door (Record button, count-in, meter, capture -> transcribe) and
// the audio-file transcription pipeline it shares now live in
// songs/record-door.js (P3-3, a behaviour-preserving move) -- built once per
// panel instance below with idPrefix 'learn' so its ids/classes come out
// exactly as they always have.
import { createRecordDoor, transcribeAudioFile } from './songs/record-door.js';

const ACCEPT = '.mid,.midi,.abc,.xml,.musicxml,.mxl,.gp,.gp5,.wav,.mp3,.ogg,.m4a,.flac,.webm';

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === 'text') node.textContent = attrs[k];
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
    else node.setAttribute(k, attrs[k]);
  }
  (children || []).forEach((c) => { if (c) node.appendChild(c); });
  return node;
}

function readFile(file, as) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('the file could not be read'));
    reader.onload = () => resolve(reader.result);
    if (as === 'bytes') reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  });
}

function mountLearnPanel(hostEl, api) {
  // Shares the exact library Songs reads from (same store name), so a song
  // saved here shows up in Songs's own list without either panel knowing
  // about the other's internals. Falls back to an in-memory library only
  // where IndexedDB itself is unavailable (private browsing in some
  // browsers), same fallback src/ui/songs.js already uses.
  let library;
  try { library = createLibrary(indexedDbStore(indexedDB, 'bandcoach-songs')); }
  catch (e) { library = createLibrary(memoryStore()); }

  const root = el('div', { class: 'panel-learn' });
  root.appendChild(el('h3', { text: 'Learn this' }));
  root.appendChild(el('p', { class: 'panel-learn-intro', text: 'Drop a recording or a music file below, or pick one. Either way it turns into a song you can practise.' }));

  const drop = el('div', { class: 'panel-learn-drop' });
  const inputId = 'learnFileInput';
  const input = el('input', { type: 'file', id: inputId, accept: ACCEPT, class: 'panel-learn-input' });
  const label = el('label', { for: inputId, class: 'panel-learn-drop-label', text: 'Drop a recording or a music file, or pick one' });
  drop.appendChild(label);
  drop.appendChild(input);
  root.appendChild(drop);

  const statusEl = el('p', { class: 'panel-learn-status', role: 'status' });
  const resultEl = el('div', { class: 'panel-learn-result' });
  resultEl.hidden = true;

  function say(text) { statusEl.textContent = text; }

  // ---- mic door: Record -> a four-beat count-in -> capture -> Stop -------
  // Built by songs/record-door.js (P3-3, a behaviour-preserving move):
  // idPrefix 'learn' keeps every id/class (learnBpm, panel-learn-beat,
  // panel-learn-record-btn, panel-learn-meter, ...) exactly as it always
  // was, `say` is this panel's own status line (shared with the file door
  // below), `onStart` clears any earlier result the moment Record is
  // pressed, and `onTake` keeps this panel's save-before-review order --
  // library.add happens here, in the caller, not inside the door.
  function onMicTake(song, warnings) {
    return saveAndRenderResult(song, warnings, null);
  }
  const door = createRecordDoor(api, {
    say,
    idPrefix: 'learn',
    onStart() { resultEl.hidden = true; resultEl.innerHTML = ''; },
    onTake: onMicTake,
  });
  root.appendChild(door.el);
  root.appendChild(statusEl);
  root.appendChild(resultEl);
  hostEl.appendChild(root);

  // Shared save-then-render step both doors (file and mic) end on: save the
  // learned song to the library, clear the status line, then show the
  // shared result view (songs/review.js). Left to throw up to each caller's
  // own try/catch (the mic door's, or handleFile's below), same as before
  // this file split into two modules.
  async function saveAndRenderResult(song, warnings, audioRec) {
    const id = await library.add(song, { now: Date.now() });
    say('');
    renderResult({ ...song, id }, warnings || [], audioRec);
  }

  // Drag-and-drop is the file input's own better-known sibling gesture, not
  // a separate code path: a dropped file is handed to the SAME handleFile()
  // a picked one reaches, so there is exactly one place that decides what a
  // file becomes.
  ['dragover', 'dragenter'].forEach((type) => drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('panel-learn-drop-active');
  }));
  ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, () => drop.classList.remove('panel-learn-drop-active')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) handleFile(file);
  });

  async function handleFile(file) {
    resultEl.hidden = true;
    resultEl.innerHTML = '';
    const source = learnSourceFor(file.name, file.type);
    if (source === 'unknown') {
      say('That file is not something this panel can learn from yet. Drop a music file (.mid, .abc, .musicxml, .gp, .gp5) or a recording (.wav, .mp3, .ogg, .m4a, .flac, .webm).');
      return;
    }
    say('Working it out…');
    try {
      let song, warnings, audioRec = null;
      if (source === 'notation') {
        const route = routeImportFile(file.name);
        const data = await readFile(file, route.readAs);
        const importer = importerFor(route.kind);
        ({ song, warnings } = importer(data, { fileName: file.name }));
      } else {
        const result = await transcribeAudioFile(file, api);
        song = result.song;
        warnings = (result.report && result.report.needsCheck) || [];
        audioRec = result.rec;
      }
      const { ok, errors } = validateSong(song);
      if (!ok) { say('That file did not turn into a usable song: ' + errors.join('; ')); return; }
      await saveAndRenderResult(song, warnings, audioRec);
    } catch (e) {
      if (typeof api.recordError === 'function') api.recordError('learn:file', e);
      say(source === 'audio'
        ? 'That recording could not be opened or analysed. Try a different file, such as a .wav or .mp3.'
        : 'That file could not be read: ' + (e && e.message ? e.message : String(e)));
    }
  }

  // The result view itself, and the three ways it can hand a learned song
  // on, now live in src/ui/songs/review.js (P3-2, a behaviour-preserving
  // move) -- built once per panel instance so every renderResult() call
  // below reuses the same wiring.
  const handoffs = makeHandoffs(api);
  function renderResult(song, warnings, audioRec) {
    renderReview(resultEl, {
      song, warnings, audioRec, api, say,
      onPractise: handoffs.openSongsPanel,
      onEditNotes: handoffs.openEditorPanel,
      onPlayAlong: handoffs.openPlayalongPanel,
    });
  }

  return {
    show() {},
    // Leaving this panel mid count-in or mid recording must not leave the
    // meter's requestAnimationFrame loop or a pending count-in click running
    // in the background -- stop them, and any in-flight capture's frames are
    // simply discarded (nothing was played to the learner suggesting it was
    // saved). Delegated to the mic door itself (songs/record-door.js).
    hide() {
      door.hide();
    },
  };
}

export function register(panels) {
  panels.register({
    id: 'learn',
    name: 'Learn this',
    tag: 'turn any file into a song',
    color: '#ffd27f',
    mount: mountLearnPanel,
  });
}
