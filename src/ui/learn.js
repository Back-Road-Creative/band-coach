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
import { mixToMono } from './playalong/audio-prep.js';
import { framesFromPCM } from '../audio/file-frames.js';
import { transcribe } from '../song/transcribe.js';
import { rangeForInstrument } from '../audio/range.js';
import { renderPlayItOnCards, requestOpenSong } from './songs.js';
import { requestOpenInEditor } from './editor.js';
import { requestPlayalongRecording } from './playalong.js';
import { createRecorder } from './editor/record.js';
import { countInTimes, clampBpm, DEFAULT_BPM } from './learn/count-in.js';
import { rmsLevel } from './learn/level.js';

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

function titleFromFileName(fileName) {
  const name = String(fileName || 'My recording');
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name) || 'My recording';
}

// Pure decision behind renderResult()'s "Practise this" button: a song
// whose transcription still has unresolved check items (warnings, from
// report.needsCheck) must not be sent straight to practice with doubtful
// notes uncorrected -- it has to go through "Fix it up" first. No DOM in
// it, tested the same way src/ui/editor.js's chooseSaveTarget is.
export function practiceGate(warnings) {
  const list = Array.isArray(warnings) ? warnings : [];
  if (!list.length) return { allowed: true, reason: null };
  return { allowed: false, reason: 'Fix up the ' + list.length + ' flagged note' + (list.length === 1 ? '' : 's') + ' first, then practise.' };
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

  // ---- mic door: Record -> a four-beat count-in -> capture -> Stop -------
  // Reuses src/ui/editor/record.js's createRecorder unchanged (the same
  // frame recorder "Record a tune" drives) against this panel's own
  // panelApi, so the capture itself is not reimplemented here -- this file
  // only adds the count-in, the level meter, and routing the result through
  // the shared renderResult() below.
  const recorder = createRecorder(api);
  const micSection = el('div', { class: 'panel-learn-mic' });
  micSection.appendChild(el('h4', { text: 'Or sing, hum or play into the mic' }));
  const bpmInput = el('input', {
    type: 'number', id: 'learnBpm', min: '40', max: '200', value: String(DEFAULT_BPM),
    class: 'panel-learn-bpm', 'aria-label': 'Tempo (beats per minute)',
  });
  const bpmRow = el('div', { class: 'panel-learn-bpm-row' }, [
    el('label', { for: 'learnBpm', text: 'Tempo (beats per minute)' }), bpmInput,
  ]);
  const meterFill = el('div', { class: 'panel-learn-meter-fill' });
  const meterBox = el('div', {
    class: 'panel-learn-meter', role: 'progressbar', 'aria-label': 'Microphone level',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0',
  }, [meterFill]);
  const beatEl = el('p', { class: 'panel-learn-beat', 'aria-live': 'polite' });
  const recordBtn = el('button', { type: 'button', class: 'panel-learn-record-btn', text: 'Record' });
  micSection.append(bpmRow, meterBox, beatEl, recordBtn);
  root.appendChild(micSection);

  const statusEl = el('p', { class: 'panel-learn-status', role: 'status' });
  root.appendChild(statusEl);
  const resultEl = el('div', { class: 'panel-learn-result' });
  resultEl.hidden = true;
  root.appendChild(resultEl);
  hostEl.appendChild(root);

  function say(text) { statusEl.textContent = text; }

  // ---- mic level meter: a plain requestAnimationFrame loop reading RMS off
  // the SAME time-domain analyser the rest of the app already keeps running
  // (panelApi.analysers().time) through the pure rmsLevel() (src/ui/learn/
  // level.js) -- started only while the mic door is actually listening
  // (count-in or capture), stopped on Stop or when the panel is hidden, so
  // it never spins in the background once a learner leaves this screen.
  let meterRaf = null;
  function setLevel(v) {
    const pct = Math.round(v * 100);
    meterFill.style.width = pct + '%';
    meterBox.setAttribute('aria-valuenow', String(pct));
  }
  function startMeterLoop() {
    function loop() {
      const analysers = typeof api.analysers === 'function' ? api.analysers() : null;
      const time = analysers && analysers.time;
      if (time) {
        const buf = new Float32Array(time.fftSize);
        time.getFloatTimeDomainData(buf);
        setLevel(rmsLevel(buf));
      }
      meterRaf = requestAnimationFrame(loop);
    }
    meterRaf = requestAnimationFrame(loop);
  }
  function stopMeterLoop() {
    if (meterRaf !== null) cancelAnimationFrame(meterRaf);
    meterRaf = null;
    setLevel(0);
  }

  let counting = false;
  let recording = false;
  let countInTimers = [];
  function clearCountInTimers() {
    countInTimers.forEach((id) => clearTimeout(id));
    countInTimers = [];
  }
  function resetMicUi() {
    counting = false;
    recording = false;
    clearCountInTimers();
    stopMeterLoop();
    beatEl.textContent = '';
    recordBtn.textContent = 'Record';
    recordBtn.disabled = false;
    bpmInput.disabled = false;
  }

  // Record -> Counting in… (four clicks, "1 2 3 4") -> recording starts on
  // the downbeat -> Stop. The mic itself is opened (and any denial reported)
  // BEFORE the count-in is scheduled, so a learner who has no mic, or has
  // blocked it, sees the plain message immediately rather than after
  // watching a count-in that was never going to record anything.
  async function startMicRecording() {
    if (counting || recording) return;
    // Claimed synchronously, before the `await` below, so a second Record
    // click landing while the microphone permission prompt (or a slow
    // device) is still pending is turned away by the guard above instead of
    // running this whole function a second time. recordBtn is disabled for
    // this (usually brief) stretch too -- it still reads "Record" and there
    // is nothing yet to cancel back to -- and re-enabled the moment the
    // count-in itself begins, below, so a learner CAN cancel a count-in in
    // progress. Both are reset in the catch if opening the mic fails, so a
    // denial does not leave the slot, or the button, stuck.
    counting = true;
    recordBtn.disabled = true;
    resultEl.hidden = true;
    resultEl.innerHTML = '';
    say('Getting the microphone ready…');
    try { await api.openMic(); }
    catch (e) {
      counting = false;
      recordBtn.disabled = false;
      say('The microphone is not available. You can drop a recording instead.');
      return;
    }
    recordBtn.textContent = 'Counting in…';
    recordBtn.disabled = false;
    bpmInput.disabled = true;
    say('Get ready…');
    startMeterLoop();
    const bpm = clampBpm(bpmInput.value);
    const spb = 60 / bpm;
    const startAt = api.now() + 0.15;
    const times = countInTimes(bpm, 4, startAt);
    times.forEach((t, i) => {
      api.click(t, i === 0);
      const delayMs = Math.max(0, (t - api.now()) * 1000);
      countInTimers.push(setTimeout(() => { beatEl.textContent = String(i + 1); }, delayMs));
    });
    const lastBeat = times[times.length - 1];
    const captureDelayMs = Math.max(0, (lastBeat + spb - api.now()) * 1000);
    countInTimers.push(setTimeout(beginCapture, captureDelayMs));
  }

  async function beginCapture() {
    if (!counting) return; // Stop was pressed mid count-in
    counting = false;
    beatEl.textContent = '';
    try { await recorder.start(); }
    catch (e) {
      resetMicUi();
      say('The microphone is not available. You can drop a recording instead.');
      return;
    }
    recording = true;
    say('Recording…');
    recordBtn.textContent = 'Stop';
    recordBtn.disabled = false;
  }

  async function stopMicRecording() {
    if (counting) { clearCountInTimers(); resetMicUi(); say(''); return; }
    if (!recording) return;
    const frames = recorder.stop();
    resetMicUi();
    say('Working it out…');
    try {
      const { song, report } = transcribe(frames, { title: 'My recording' });
      const notes = song.parts[0] ? song.parts[0].notes : [];
      if (!notes.length) {
        say('Nothing was heard clearly enough to turn into notes. Try again a little closer to the mic, or drop a recording instead.');
        return;
      }
      const { ok, errors } = validateSong(song);
      if (!ok) { say('That recording did not turn into a usable song: ' + errors.join('; ')); return; }
      const id = await library.add(song, { now: Date.now() });
      say('');
      renderResult({ ...song, id }, (report && report.needsCheck) || []);
    } catch (e) {
      if (typeof api.recordError === 'function') api.recordError('learn:mic', e);
      say('That recording could not be analysed. Try again, or drop a recording instead.');
    }
  }

  recordBtn.addEventListener('click', () => {
    if (recording || counting) stopMicRecording();
    else startMicRecording();
  });

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
      const id = await library.add(song, { now: Date.now() });
      say('');
      renderResult({ ...song, id }, warnings || [], audioRec);
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
  // Also hands back the decoded { pcm, sampleRate, duration, fileName } this
  // file just became -- so a "Play along with this recording" button can
  // hand the SAME decoded audio to Play Along (src/ui/playalong.js's
  // requestPlayalongRecording()) without decoding the file a second time.
  async function transcribeAudioFile(file, api) {
    const actx = typeof api.audio === 'function' ? api.audio() : null;
    if (!actx) throw new Error('audio is not available');
    const audioBuffer = await actx.decodeAudioData(await file.arrayBuffer());
    const channels = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c));
    const pcm = mixToMono(channels);
    const { fmin, fmax } = rangeForInstrument(typeof api.instrument === 'function' ? api.instrument() : null);
    const { frames, onsets } = framesFromPCM(pcm, audioBuffer.sampleRate, { fmin, fmax });
    const result = transcribe(frames, { title: titleFromFileName(file.name), onsets });
    return { ...result, rec: { pcm, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration, fileName: file.name } };
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
  function clickPanelButton(panelId) {
    const doc = hostEl.ownerDocument || document;
    const btn = doc.querySelector('#panelPicker button[data-panel="' + panelId + '"]') || doc.querySelector('button[data-panel="' + panelId + '"]');
    if (btn) { btn.click(); return true; }
    return false;
  }

  function openSongsPanel(songId, partId, instrumentId) {
    requestOpenSong(api, songId, partId, instrumentId);
    return clickPanelButton('songs');
  }

  // "Fix it up" (every result): hands the just-learned song to the older
  // "Record a tune" editor, the one panel with note-editing ops (src/song/
  // edit.js) this one deliberately does not reimplement -- same
  // request+click pattern as openSongsPanel() above, mirrored in src/ui/
  // editor.js's requestOpenInEditor()/checkOpenRequest().
  function openEditorPanel(songId, needsCheck) {
    requestOpenInEditor(api, songId, needsCheck);
    return clickPanelButton('editor');
  }

  // "Play along with this recording" (audio sources only, where a decoded
  // buffer exists -- see transcribeAudioFile's rec): hands the SAME decoded
  // PCM to Play Along's beat/chord analysis and loop, rather than asking the
  // learner to re-pick the file there. In-memory handoff (src/ui/
  // playalong.js's requestPlayalongRecording()), not api.store -- audio is
  // far too big for the 256KB panel-data budget.
  function openPlayalongPanel(rec) {
    requestPlayalongRecording(rec);
    return clickPanelButton('playalong');
  }

  function renderResult(song, warnings, audioRec) {
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

    // A song with unresolved check items (warnings) cannot be sent straight
    // to practice with doubtful notes uncorrected -- see practiceGate,
    // above. The button stays visible (never a dead end) but disabled,
    // with the reason spelled out in plain language right next to it.
    const gate = practiceGate(warnings);
    const practiseBtn = el('button', { type: 'button', class: 'panel-learn-practise-btn', text: 'Practise this' });
    if (!gate.allowed) practiseBtn.disabled = true;
    practiseBtn.addEventListener('click', () => {
      if (!gate.allowed) return;
      const opened = openSongsPanel(song.id, partId, null);
      if (!opened) say('Saved "' + song.title + '". Open the Songs panel to practise it.');
    });
    resultEl.appendChild(practiseBtn);
    if (!gate.allowed) resultEl.appendChild(el('p', { class: 'panel-learn-practise-gate-reason', text: gate.reason }));

    // "Fix it up" -- every result, notation or audio, can be sent to the
    // fuller note-editing panel. Any unresolved check items ride along
    // (requestOpenInEditor/loadReport, src/ui/editor.js) so the editor
    // shows the learner the SAME check list rather than losing it.
    const fixItUpBtn = el('button', { type: 'button', class: 'panel-learn-fixitup-btn', text: 'Fix it up' });
    fixItUpBtn.addEventListener('click', () => {
      const opened = openEditorPanel(song.id, warnings);
      if (!opened) say('Saved "' + song.title + '". Open Record a tune to fix it up.');
    });
    resultEl.appendChild(fixItUpBtn);

    // "Play along with this recording" -- only ever shown where a decoded
    // audio buffer actually exists (the file door's own recording; the mic
    // door's recorder captures pitch frames only, never raw audio, so it has
    // none to hand over -- never claim a hand-off the app cannot back up).
    if (audioRec) {
      const playAlongBtn = el('button', { type: 'button', class: 'panel-learn-playalong-btn', text: 'Play along with this recording' });
      playAlongBtn.addEventListener('click', () => {
        const opened = openPlayalongPanel(audioRec);
        if (!opened) say('Saved "' + song.title + '". Open Play Along to use this recording.');
      });
      resultEl.appendChild(playAlongBtn);
    }
  }

  return {
    show() {},
    // Leaving this panel mid count-in or mid recording must not leave the
    // meter's requestAnimationFrame loop or a pending count-in click running
    // in the background -- stop them, and any in-flight capture's frames are
    // simply discarded (nothing was played to the learner suggesting it was
    // saved).
    hide() {
      if (counting) clearCountInTimers();
      if (recording) recorder.stop();
      resetMicUi();
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
