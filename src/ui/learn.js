// "Learn this" panel (plan §11.5.7, unit G1a -- the FILE door only): one
// drop zone + file picker that turns any dropped/picked music file into a
// song the learner can practise, without ever asking "is this a recording
// or a music file?" (the plan's "any source, one door" acceptance,
// §11.5.1) -- learnSourceFor (src/ui/learn/source.js) answers that
// silently.
//
// A notation file (midi/abc/musicxml/gp7) is routed and imported exactly
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
// Recording via the microphone (the plan's other door) and retiring the
// older Record a tune / Play Along / Songs-file-button panels are separate,
// later units (G1b, G1c) -- this panel never opens a microphone itself.
import { learnSourceFor } from './learn/source.js';
import { routeImportFile, importerFor } from './songs/import-route.js';
import { validateSong } from '../song/model.js';
import { createLibrary, memoryStore, indexedDbStore } from '../song/library.js';
import { mixToMono } from './playalong/audio-prep.js';
import { framesFromPCM } from '../audio/file-frames.js';
import { transcribe } from '../song/transcribe.js';
import { rangeForInstrument } from '../audio/range.js';
import { renderPlayItOnCards, requestOpenSong } from './songs.js';

const ACCEPT = '.mid,.midi,.abc,.xml,.musicxml,.mxl,.gp,.wav,.mp3,.ogg,.m4a,.flac,.webm';

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

function titleFromFileName(fileName) {
  const name = String(fileName || 'My recording');
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name) || 'My recording';
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
  root.appendChild(statusEl);
  const resultEl = el('div', { class: 'panel-learn-result' });
  resultEl.hidden = true;
  root.appendChild(resultEl);
  hostEl.appendChild(root);

  function say(text) { statusEl.textContent = text; }

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
      say('That file is not something this panel can learn from yet. Drop a music file (.mid, .abc, .musicxml, .gp) or a recording (.wav, .mp3, .ogg, .m4a, .flac, .webm).');
      return;
    }
    say('Working it out…');
    try {
      let song, warnings;
      if (source === 'notation') {
        const route = routeImportFile(file.name);
        const data = await readFile(file, route.readAs);
        const importer = importerFor(route.kind);
        ({ song, warnings } = importer(data, { fileName: file.name }));
      } else {
        const result = await transcribeAudioFile(file, api);
        song = result.song;
        warnings = (result.report && result.report.needsCheck) || [];
      }
      const { ok, errors } = validateSong(song);
      if (!ok) { say('That file did not turn into a usable song: ' + errors.join('; ')); return; }
      const id = await library.add(song, { now: Date.now() });
      say('');
      renderResult({ ...song, id }, warnings || []);
    } catch (e) {
      if (typeof api.recordError === 'function') api.recordError('learn:file', e);
      say(source === 'audio'
        ? 'That recording could not be opened or analysed. Try a different file, such as a .wav or .mp3.'
        : 'That file could not be read: ' + (e && e.message ? e.message : String(e)));
    }
  }

  // Reads the picked file's own filename as this song's working title (the
  // notation importers already do this for a title-less file); a learner
  // can rename it from Songs afterwards the same way any imported song is
  // renamed.
  async function transcribeAudioFile(file, api) {
    const actx = typeof api.audio === 'function' ? api.audio() : null;
    if (!actx) throw new Error('audio is not available');
    const audioBuffer = await actx.decodeAudioData(await file.arrayBuffer());
    const channels = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c));
    const pcm = mixToMono(channels);
    const { fmin, fmax } = rangeForInstrument(typeof api.instrument === 'function' ? api.instrument() : null);
    const { frames, onsets } = framesFromPCM(pcm, audioBuffer.sampleRate, { fmin, fmax });
    return transcribe(frames, { title: titleFromFileName(file.name), onsets });
  }

  // Opening the Songs panel's lesson from here: this panel only ever gets
  // its own mounted instance (see src/ui/panels.js), never a reference to
  // the shared panels registry app.js owns, so it cannot call panels.open()
  // itself. The one real, already-shipping way any panel switches to
  // another is the app's own panel-picker button (src/app.js's
  // buildPanelPicker()/openPanel(), one <button data-panel="…"> per
  // registered panel) -- clicking it here is the same click a learner would
  // make by hand, not a shortcut around it. requestOpenSong() (src/ui/
  // songs.js) is read by Songs's own show() the moment it opens. Where no
  // such button exists (a page that never wired panel switching in), this
  // still SAVES the song and tells the learner in plain words where to go,
  // rather than silently doing nothing.
  function openSongsPanel(songId, partId, instrumentId) {
    requestOpenSong(api, songId, partId, instrumentId);
    const doc = hostEl.ownerDocument || document;
    const songsBtn = doc.querySelector('#panelPicker button[data-panel="songs"]') || doc.querySelector('button[data-panel="songs"]');
    if (songsBtn) { songsBtn.click(); return true; }
    return false;
  }

  function renderResult(song, warnings) {
    resultEl.innerHTML = '';
    resultEl.hidden = false;
    resultEl.appendChild(el('h4', { text: song.title }));

    if (warnings.length) {
      const list = el('ul', { class: 'panel-learn-checklist' });
      warnings.forEach((w) => list.appendChild(el('li', { text: w })));
      resultEl.appendChild(list);
    }

    // Confidence colours: only ever drawn from a real per-note confidence
    // transcribe() already attached (src/song/transcribe.js's
    // eventsToNotes -- every transcribed note carries one). A notation
    // import's notes carry none, and this strip is simply omitted rather
    // than inventing a number -- see the author brief's "never hide what
    // the app heard" (also never show a confidence you did not measure).
    const partId = song.parts[0] ? song.parts[0].id : null;
    const notes = partId ? song.parts[0].notes : [];
    if (notes.length && notes.every((n) => typeof n.confidence === 'number')) {
      const strip = el('div', { class: 'panel-learn-confidence-strip', 'aria-label': 'Note confidence' });
      notes.forEach((n) => {
        const level = n.confidence >= 0.7 ? 'high' : n.confidence >= 0.4 ? 'medium' : 'low';
        strip.appendChild(el('span', {
          class: 'panel-learn-confidence-note',
          'data-confidence': level,
          title: Math.round(n.confidence * 100) + '% confident',
        }));
      });
      resultEl.appendChild(strip);
    }

    if (partId) {
      resultEl.appendChild(renderPlayItOnCards(song, partId, typeof api.mod === 'function' ? api.mod() : null, (instrument) => openSongsPanel(song.id, partId, instrument.id)));
    }

    const practiseBtn = el('button', { type: 'button', class: 'panel-learn-practise-btn', text: 'Practise this' });
    practiseBtn.addEventListener('click', () => {
      const opened = openSongsPanel(song.id, partId, null);
      if (!opened) say('Saved "' + song.title + '". Open the Songs panel to practise it.');
    });
    resultEl.appendChild(practiseBtn);
  }

  return {
    show() {},
    hide() {},
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
