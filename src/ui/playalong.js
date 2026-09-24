// "Play along with a recording" panel: a learner opens an audio file of a
// song, this panel figures out its tempo/key/chords, and lets them loop any
// section slower (pitch kept the same) to learn their part. Nothing about
// the recording itself ever leaves this device — see mount() below for what
// little state is kept, and where.
//
// Analysis timing: measured (Node, this machine, 2026-09-19) at ~2.6s for a
// synthetic 3-minute mono buffer via src/audio/analysis/analyse.js directly
// (see .data/handoff for the throwaway script). analyse() already yields to
// the event loop between chunks (its own `await yieldToEventLoop()` calls),
// so a ~2.6s analysis keeps the progress bar animating and the Cancel button
// responsive without a Worker. A Worker was considered and rejected: the
// analysis code is several ES modules deep (analyse.js -> fft/onset/tempo/
// chroma/key/chords.js), and this app ships as one bundled file opened from
// file:// with no sibling-file fetches (see build/build.mjs) — a Worker
// would need its own self-contained source string the way
// src/audio/pitch-worklet.js builds one via Function.prototype.toString(),
// which only works for single self-contained functions, not a module graph.
// If a future recording turns out slow enough to need it, revisit then.

import { analyse } from '../audio/analysis/analyse.js';
import { stretch } from '../audio/stretch/wsola.js';
import { createTransport } from '../audio/stretch/loop.js';
import { mixToMono, formatTime, makeCancellableProgress, AnalysisCancelledError } from './playalong/audio-prep.js';
import { chordSegments, isLowConfidence, clampLoopSelection } from './playalong/timeline.js';
import { createTakeAccumulator } from '../audio/take-recorder.js';

// How often the mic-capture timer reads the analyser during "Record a take"
// (src/ui/editor/record.js polls the same AnalyserNode on the same kind of
// timer, for pitch frames rather than raw audio -- see startRecordingCapture
// below for why only the TAIL of each read is kept). Matches that module's
// own default interval so this panel's recording cadence is consistent with
// the rest of the app's mic reads.
const RECORD_CAPTURE_INTERVAL_MS = 50;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BEATS_PER_BAR = 4;

// A cross-panel "analyse this decoded recording next time Play Along is
// shown" handoff (used by src/ui/learn.js's "Play along with this
// recording" button). Kept in memory at module scope, NOT api.store — the
// PCM buffer this carries is real audio data, far past the 256KB panel-data
// budget src/ui/panels.js's sanitizePanelData enforces, and it only ever
// needs to survive the one click-through a learner just made, same lifetime
// as songs.js's OPEN_REQUEST_STORE_ID request but too big for that slot.
let pendingRecording = null; // { pcm, sampleRate, duration, fileName }
export function requestPlayalongRecording(rec) {
  pendingRecording = rec;
}

export function register(panels) {
  panels.register({
    id: 'playalong',
    name: 'Play Along',
    tag: 'Loop a recording, slower',
    color: '#f3c52f',
    mount(el, api) {
      return mountPlayalong(el, api);
    },
  });
}

function mountPlayalong(el, api) {
  el.innerHTML =
    '<div class="panel-playalong">' +
    '<p class="pa-intro">Open a recording of a song, or record yourself playing one — a duet with your own earlier take. This finds its tempo, key and chords, then lets you loop any section slower — without changing the pitch — to learn your part. The recording never leaves this device.</p>' +
    '<p id="paSavedHint" class="pa-note" hidden></p>' +
    '<div class="row pa-open">' +
    '<label class="small file-label" for="paFileInput">Open a recording</label>' +
    '<input type="file" accept="audio/*" id="paFileInput" hidden>' +
    '<button type="button" id="paRecordBtn" class="small">Record a take</button>' +
    '<span id="paFileName" class="pa-filename"></span>' +
    '</div>' +
    '<p id="paRecordNote" class="pa-note" hidden></p>' +
    '<div id="paProgress" class="pa-progress" hidden>' +
    '<div class="pa-progress-track"><div id="paProgressFill" class="pa-progress-fill"></div></div>' +
    '<span id="paProgressLabel">Listening&hellip;</span>' +
    '<button type="button" id="paCancelBtn" class="small">Cancel</button>' +
    '</div>' +
    '<p id="paError" class="pa-note pa-error" hidden></p>' +
    '<div id="paResults" class="pa-results" hidden>' +
    '<div class="pa-facts row" id="paFacts"></div>' +
    '<p id="paUnsure" class="pa-note" hidden>I&rsquo;m not sure about this one &mdash; the recording may be quiet, noisy, or without a clear beat.</p>' +
    '<div id="paTimeline" class="pa-timeline" tabindex="0" role="group" aria-label="Song timeline: beats, bars and chords. Drag to select a section to loop."></div>' +
    '<div class="row pa-playhead-row">' +
    '<label for="paPlayhead" class="small">Playhead</label>' +
    '<input type="range" id="paPlayhead" min="0" max="1000" value="0" step="1">' +
    '<span id="paPlayheadTime">0:00</span>' +
    '<button type="button" id="paSetStart" class="small">Set loop start here</button>' +
    '<button type="button" id="paSetEnd" class="small">Set loop end here</button>' +
    '</div>' +
    '<p id="paLoopRange" class="pa-note"></p>' +
    '<div class="row pa-practice-controls">' +
    '<button type="button" id="paPlayBtn" class="primary small">Play loop</button>' +
    '<label class="small">Speed <input type="range" id="paSpeed" min="50" max="100" step="5" value="80"> <span id="paSpeedVal">80%</span></label>' +
    '<label class="small"><input type="checkbox" id="paCountIn" checked> Count-in click</label>' +
    '</div>' +
    '<p class="pa-note">No pitch change (transpose) here: the slow-down keeps the recording&rsquo;s own pitch, and this panel has no separate pitch-shift control.</p>' +
    '</div>' +
    '</div>';

  const $ = (id) => el.querySelector('#' + id);
  const fileInput = $('paFileInput');
  const fileNameEl = $('paFileName');
  const recordBtn = $('paRecordBtn');
  const recordNoteEl = $('paRecordNote');
  const savedHintEl = $('paSavedHint');
  const progressEl = $('paProgress');
  const progressFill = $('paProgressFill');
  const progressLabel = $('paProgressLabel');
  const cancelBtn = $('paCancelBtn');
  const errorEl = $('paError');
  const resultsEl = $('paResults');
  const factsEl = $('paFacts');
  const unsureEl = $('paUnsure');
  const timelineEl = $('paTimeline');
  const playheadInput = $('paPlayhead');
  const playheadTimeEl = $('paPlayheadTime');
  const setStartBtn = $('paSetStart');
  const setEndBtn = $('paSetEnd');
  const loopRangeEl = $('paLoopRange');
  const playBtn = $('paPlayBtn');
  const speedInput = $('paSpeed');
  const speedValEl = $('paSpeedVal');
  const countInInput = $('paCountIn');

  const store = api.store('playalong');

  let recording = null; // { pcm, sampleRate, duration, fileName }
  let analysis = null; // analyse() result
  let transport = null; // createTransport(...)
  let cancelled = false;
  let destroyed = false; // set by destroy(); guards an in-flight analyse() from writing to a torn-down instance's DOM/store (see destroy() below)
  let dragStart = null;
  let currentSource = null;
  let currentGain = null;
  let captureTimer = null; // "Record a take": non-null while the mic-poll timer is running
  let takeAccumulator = null;

  function playheadSeconds() {
    if (!recording) return 0;
    return (Number(playheadInput.value) / 1000) * recording.duration;
  }

  function setPlayheadSeconds(t) {
    if (!recording || recording.duration <= 0) return;
    playheadInput.value = String(Math.round((Math.max(0, Math.min(recording.duration, t)) / recording.duration) * 1000));
    playheadTimeEl.textContent = formatTime(playheadSeconds());
  }

  function showSavedHint() {
    const saved = store.get();
    if (saved && typeof saved.fileName === 'string') {
      savedHintEl.textContent =
        'Last time: "' + saved.fileName + '" looped ' + formatTime(saved.loopStart) + '–' + formatTime(saved.loopEnd) + '. Open that file again to pick up where you left off.';
      savedHintEl.hidden = false;
    } else {
      savedHintEl.hidden = true;
    }
  }

  function persistLoop() {
    if (!recording || !transport) return;
    const loop = transport.getLoop();
    store.set({ fileName: recording.fileName, loopStart: loop.start, loopEnd: loop.end });
  }

  function setProgress(fraction) {
    progressFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
  }

  function renderFacts(result) {
    factsEl.innerHTML = '';
    const add = (text) => {
      const d = document.createElement('div');
      d.className = 'stat';
      d.textContent = text;
      factsEl.appendChild(d);
    };
    add(result.bpm > 0 ? Math.round(result.bpm) + ' BPM' : 'Tempo: not found');
    add(isLowConfidence(result.key.confidence) ? "Key: I'm not sure" : 'Key: ' + NOTE_NAMES[result.key.tonic] + ' ' + result.key.mode);
    add(Math.abs(result.tuningCents) < 3 ? 'Tuning: standard (A440)' : 'Tuning: ' + (result.tuningCents > 0 ? '+' : '') + Math.round(result.tuningCents) + ' cents from A440');
    unsureEl.hidden = !isLowConfidence(result.confidence);
  }

  function renderTimeline() {
    timelineEl.innerHTML = '';
    if (!recording || !analysis) return;
    const duration = recording.duration || 1;
    const pct = (t) => (Math.max(0, Math.min(duration, t)) / duration) * 100 + '%';

    for (const t of analysis.beats || []) {
      const tick = document.createElement('span');
      tick.className = 'pa-beat-tick';
      tick.style.left = pct(t);
      timelineEl.appendChild(tick);
    }
    for (const t of analysis.downbeats || []) {
      const tick = document.createElement('span');
      tick.className = 'pa-bar-tick';
      tick.style.left = pct(t);
      timelineEl.appendChild(tick);
    }
    const segments = chordSegments(analysis.chords || [], analysis.beats || [], duration);
    for (const seg of segments) {
      const label = document.createElement('span');
      label.className = 'pa-chord' + (isLowConfidence(seg.confidence) ? ' pa-chord-unsure' : '');
      label.style.left = pct(seg.start);
      label.style.width = Math.max(0, ((seg.end - seg.start) / duration) * 100) + '%';
      label.textContent = seg.symbol === 'N' ? '·' : seg.symbol;
      timelineEl.appendChild(label);
    }
    if (transport) {
      const loop = transport.getLoop();
      const region = document.createElement('span');
      region.className = 'pa-loop-region';
      region.style.left = pct(loop.start);
      region.style.width = Math.max(0, ((loop.end - loop.start) / duration) * 100) + '%';
      timelineEl.appendChild(region);
      loopRangeEl.textContent = 'Loop: ' + formatTime(loop.start) + '–' + formatTime(loop.end);
    }
  }

  function timeFromClientX(clientX) {
    const rect = timelineEl.getBoundingClientRect();
    const fraction = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.max(0, Math.min(recording.duration, fraction * recording.duration));
  }

  function applyLoop(a, b) {
    if (!transport) return;
    try {
      transport.setLoop(a, b);
    } catch (e) {
      return; // zero/negative-length request from a click with no drag; ignore
    }
    persistLoop();
    renderTimeline();
  }

  timelineEl.addEventListener('pointerdown', (e) => {
    if (!recording) return;
    // Without pointer capture, a drag that leaves the timeline strip (a
    // narrow target) stops receiving pointermove and the loop selection
    // freezes mid-drag; capture keeps events coming to this element until
    // pointerup, which releases it automatically. Guarded for test DOMs
    // that don't implement it.
    if (timelineEl.setPointerCapture) timelineEl.setPointerCapture(e.pointerId);
    dragStart = timeFromClientX(e.clientX);
  });
  timelineEl.addEventListener('pointermove', (e) => {
    if (dragStart === null || !recording) return;
    const cur = timeFromClientX(e.clientX);
    const { start, end } = clampLoopSelection(dragStart, cur, recording.duration);
    applyLoop(start, end);
  });
  function onWindowPointerUp() {
    dragStart = null;
  }
  window.addEventListener('pointerup', onWindowPointerUp);

  playheadInput.addEventListener('input', () => {
    playheadTimeEl.textContent = formatTime(playheadSeconds());
  });
  setStartBtn.addEventListener('click', () => {
    if (!transport) return;
    const loop = transport.getLoop();
    applyLoop(playheadSeconds(), loop.end);
  });
  setEndBtn.addEventListener('click', () => {
    if (!transport) return;
    const loop = transport.getLoop();
    applyLoop(loop.start, playheadSeconds());
  });

  speedInput.addEventListener('input', () => {
    speedValEl.textContent = speedInput.value + '%';
    if (transport) transport.setRate(Number(speedInput.value) / 100);
  });

  function stopLoop() {
    if (currentSource) {
      try {
        currentSource.stop();
      } catch (e) {
        // already stopped
      }
      try {
        currentSource.disconnect();
      } catch (e) {
        // already disconnected
      }
      currentSource = null;
    }
    if (currentGain) {
      try {
        currentGain.disconnect();
      } catch (e) {
        // already disconnected
      }
      currentGain = null;
    }
    playBtn.textContent = 'Play loop';
  }

  function playLoop() {
    if (!recording || !transport) return;
    const actx = api.audio();
    if (!actx) {
      api.say('Audio is not available right now.', 'no');
      return;
    }
    stopLoop();
    const loop = transport.getLoop();
    const rate = transport.getRate();
    const startSample = Math.max(0, Math.round(loop.start * recording.sampleRate));
    const endSample = Math.min(recording.pcm.length, Math.round(loop.end * recording.sampleRate));
    if (endSample - startSample < 2) return;
    const segment = recording.pcm.subarray(startSample, endSample);
    const stretched = stretch(segment, rate, { sampleRate: recording.sampleRate });
    const buffer = actx.createBuffer(1, Math.max(1, stretched.length), recording.sampleRate);
    if (buffer.copyToChannel) buffer.copyToChannel(stretched, 0);
    else buffer.getChannelData(0).set(stretched);

    const gain = actx.createGain();
    gain.gain.value = 0.85;
    gain.connect(actx.destination);
    const src = actx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gain);

    let startAt = api.now() + 0.05;
    if (countInInput.checked && analysis && analysis.bpm > 0) {
      const beatSec = (60 / analysis.bpm) / rate;
      for (let i = 0; i < BEATS_PER_BAR; i++) {
        api.click(startAt + i * beatSec, i === 0);
      }
      startAt += BEATS_PER_BAR * beatSec;
    }
    src.start(startAt);
    currentSource = src;
    currentGain = gain;
    playBtn.textContent = 'Stop';
  }

  playBtn.addEventListener('click', () => {
    if (currentSource) stopLoop();
    else playLoop();
  });

  function resetForNewFile() {
    stopLoop();
    resultsEl.hidden = true;
    errorEl.hidden = true;
    unsureEl.hidden = true;
    recordNoteEl.hidden = true;
    analysis = null;
    transport = null;
  }

  // Shared by both ways a `recording` object gets made — opening a file
  // (loadFile below) and finishing a mic take (stopRecordingCapture): once
  // there is PCM + a sampleRate + a duration + a fileName, everything after
  // (analysis, the timeline, the loop transport, the slow-down) is identical.
  async function analyzeRecording(rec) {
    resetForNewFile();
    recording = rec;
    fileNameEl.textContent = rec.fileName;
    progressEl.hidden = false;
    setProgress(0);
    progressLabel.textContent = 'Listening…';
    cancelled = false;
    try {
      const onProgress = makeCancellableProgress(
        (p) => setProgress(p),
        () => cancelled
      );
      const result = await analyse(rec.pcm, rec.sampleRate, { onProgress, beatsPerBar: BEATS_PER_BAR });
      // The panel may have been closed (panels.close() -> hide() then
      // destroy()) while analyse() above was still running -- it is not
      // cancellable mid-flight the way the Cancel button is. A destroyed
      // instance must never write to the shared store or a container that
      // may already be detached from the document.
      if (destroyed) return;
      analysis = result;
      transport = createTransport({ durationSec: recording.duration, beatTimes: result.beats });
      transport.setRate(Number(speedInput.value) / 100);

      const saved = store.get();
      if (saved && saved.fileName === rec.fileName && Number.isFinite(saved.loopStart) && Number.isFinite(saved.loopEnd)) {
        try {
          transport.setLoop(saved.loopStart, saved.loopEnd);
        } catch (e) {
          // saved points no longer make sense for this file's duration; keep the default loop
        }
      }

      renderFacts(result);
      renderTimeline();
      setPlayheadSeconds(0);
      resultsEl.hidden = false;
      persistLoop();
    } catch (e) {
      if (destroyed) return; // nothing left to show an error on
      if (e instanceof AnalysisCancelledError) {
        errorEl.textContent = 'Analysis cancelled.';
      } else {
        api.recordError('playalong:load', e);
        errorEl.textContent = 'That recording could not be opened or analysed.';
      }
      errorEl.hidden = false;
    } finally {
      if (!destroyed) progressEl.hidden = true;
    }
  }

  async function loadFile(file) {
    try {
      const actx = api.audio();
      if (!actx) throw new Error('audio is not available');
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await actx.decodeAudioData(arrayBuffer);
      const channels = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c));
      const pcm = mixToMono(channels);
      await analyzeRecording({ pcm, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration, fileName: file.name });
    } catch (e) {
      resetForNewFile();
      fileNameEl.textContent = file.name;
      api.recordError('playalong:load', e);
      errorEl.textContent = 'That recording could not be opened or analysed.';
      errorEl.hidden = false;
    }
  }

  fileInput.addEventListener('change', function () {
    const file = this.files && this.files[0];
    this.value = '';
    if (file) loadFile(file);
  });
  cancelBtn.addEventListener('click', () => {
    cancelled = true;
  });

  // A pending requestPlayalongRecording() (src/ui/learn.js's "Play along
  // with this recording") -- read once, on the very next show(), then
  // cleared so it never re-fires the next time a learner opens this panel
  // normally.
  function checkPendingRecording() {
    if (!pendingRecording) return;
    const rec = pendingRecording;
    pendingRecording = null;
    analyzeRecording(rec);
  }

  // "Record a take": press once to start (mic permission is requested only
  // now, on this press — never ahead of time), press again to stop. The
  // captured PCM is handed to analyzeRecording() the same way an opened file
  // is, so everything downstream (tempo/key/chords, the loopable timeline,
  // the slowed-down loop) works exactly the same for a learner's own take as
  // for a song file. Nothing recorded here is ever sent anywhere; it lives
  // only in memory for this tab, same as an opened file's decoded PCM.
  function startRecordingCapture() {
    const actx = api.audio();
    if (!actx) {
      api.say('Audio is not available right now.', 'no');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      recordNoteEl.textContent = 'This browser cannot open a microphone here. Open the standalone copy in Chrome.';
      recordNoteEl.hidden = false;
      return;
    }
    recordBtn.disabled = true;
    api.openMic().then(() => {
      const analysers = api.analysers();
      if (!analysers || !analysers.time) {
        recordBtn.disabled = false;
        recordNoteEl.textContent = 'The microphone could not be opened.';
        recordNoteEl.hidden = false;
        return;
      }
      recordNoteEl.hidden = true;
      const sampleRate = actx.sampleRate;
      takeAccumulator = createTakeAccumulator(sampleRate);
      // Each tick only keeps the TAIL of the analyser's buffer — the samples
      // that arrived since the previous tick — not the whole (much longer,
      // overlapping) analyser window every read hands back: the analyser's
      // fftSize (4096, see src/app.js's wireAnalysers) covers ~93ms of audio
      // at a typical mic sample rate, polled here every 50ms, so re-reading
      // the FULL buffer every tick would duplicate roughly the last 43ms of
      // audio into the take on every single poll.
      const tailSamples = Math.max(1, Math.round((RECORD_CAPTURE_INTERVAL_MS / 1000) * sampleRate));
      const buf = new Float32Array(analysers.time.fftSize);
      recordBtn.disabled = false;
      recordBtn.textContent = 'Stop recording';
      captureTimer = setInterval(() => {
        analysers.time.getFloatTimeDomainData(buf);
        const n = Math.min(tailSamples, buf.length);
        const tail = buf.subarray(buf.length - n);
        const stillRoom = takeAccumulator.push(tail);
        if (!stillRoom) stopRecordingCapture();
      }, RECORD_CAPTURE_INTERVAL_MS);
    }, () => {
      recordBtn.disabled = false;
      recordNoteEl.textContent = 'The microphone was blocked. Allow it to record a take.';
      recordNoteEl.hidden = false;
    });
  }

  function stopRecordingCapture() {
    if (captureTimer) clearInterval(captureTimer);
    captureTimer = null;
    recordBtn.textContent = 'Record a take';
    if (!takeAccumulator) return;
    const took = takeAccumulator.finish();
    takeAccumulator = null;
    if (took.duration < 0.2) {
      recordNoteEl.textContent = 'That take was too short to use.';
      recordNoteEl.hidden = false;
      return;
    }
    const fileName = 'My take (' + new Date().toLocaleTimeString() + ')';
    analyzeRecording({ pcm: took.pcm, sampleRate: took.sampleRate, duration: took.duration, fileName });
  }

  recordBtn.addEventListener('click', () => {
    if (captureTimer) stopRecordingCapture();
    else startRecordingCapture();
  });

  showSavedHint();

  return {
    show() {
      showSavedHint();
      checkPendingRecording();
    },
    hide() {
      stopLoop();
      if (captureTimer) stopRecordingCapture();
    },
    destroy() {
      // panels.close() always calls hide() then destroy() together (see
      // src/ui/panels.js) -- hide() alone (e.g. switching mods without
      // closing the panel) never happens, so it is safe to only cancel/guard
      // here rather than in hide(). destroyed stops any in-flight
      // analyzeRecording() from writing to the store or this (possibly
      // already-detached) DOM once it resolves; cancelled lets it notice
      // sooner, at its next onProgress tick (see makeCancellableProgress).
      destroyed = true;
      cancelled = true;
      if (captureTimer) { clearInterval(captureTimer); captureTimer = null; takeAccumulator = null; }
      window.removeEventListener('pointerup', onWindowPointerUp);
    },
  };
}
