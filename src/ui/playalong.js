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

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BEATS_PER_BAR = 4;

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
    '<p class="pa-intro">Open a recording of a song. This finds its tempo, key and chords, then lets you loop any section slower — without changing the pitch — to learn your part. The recording never leaves this device.</p>' +
    '<p id="paSavedHint" class="pa-note" hidden></p>' +
    '<div class="row pa-open">' +
    '<label class="small file-label" for="paFileInput">Open a recording</label>' +
    '<input type="file" accept="audio/*" id="paFileInput" hidden>' +
    '<span id="paFileName" class="pa-filename"></span>' +
    '</div>' +
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
  let dragStart = null;
  let currentSource = null;
  let currentGain = null;

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
    dragStart = timeFromClientX(e.clientX);
  });
  timelineEl.addEventListener('pointermove', (e) => {
    if (dragStart === null || !recording) return;
    const cur = timeFromClientX(e.clientX);
    const { start, end } = clampLoopSelection(dragStart, cur, recording.duration);
    applyLoop(start, end);
  });
  window.addEventListener('pointerup', () => {
    dragStart = null;
  });

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
    analysis = null;
    transport = null;
  }

  async function loadFile(file) {
    resetForNewFile();
    fileNameEl.textContent = file.name;
    progressEl.hidden = false;
    setProgress(0);
    progressLabel.textContent = 'Listening…';
    cancelled = false;
    try {
      const actx = api.audio();
      if (!actx) throw new Error('audio is not available');
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await actx.decodeAudioData(arrayBuffer);
      const channels = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c));
      const pcm = mixToMono(channels);
      recording = { pcm, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration, fileName: file.name };

      const onProgress = makeCancellableProgress(
        (p) => setProgress(p),
        () => cancelled
      );
      const result = await analyse(pcm, audioBuffer.sampleRate, { onProgress, beatsPerBar: BEATS_PER_BAR });
      analysis = result;
      transport = createTransport({ durationSec: recording.duration, beatTimes: result.beats });
      transport.setRate(Number(speedInput.value) / 100);

      const saved = store.get();
      if (saved && saved.fileName === file.name && Number.isFinite(saved.loopStart) && Number.isFinite(saved.loopEnd)) {
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
      if (e instanceof AnalysisCancelledError) {
        errorEl.textContent = 'Analysis cancelled.';
      } else {
        api.recordError('playalong:load', e);
        errorEl.textContent = 'That recording could not be opened or analysed.';
      }
      errorEl.hidden = false;
    } finally {
      progressEl.hidden = true;
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

  showSavedHint();

  return {
    show() {
      showSavedHint();
    },
    hide() {
      stopLoop();
    },
  };
}
