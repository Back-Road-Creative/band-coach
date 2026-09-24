// The mic "Record door": Record -> a four-beat count-in -> capture -> Stop,
// plus the audio-file transcription pipeline it shares -- moved out of
// src/ui/learn.js (P3-3, a behaviour-preserving move) so Songs can reuse the
// same door later (P3-4+) instead of duplicating it. No DOM or behaviour
// change here: every id, every panel-learn-* class and every button label
// stays exactly as it was in learn.js when idPrefix is 'learn' (the default
// learn.js itself passes), and `library.add` stays in the caller (learn.js
// keeps its own save-before-review order for now -- see onTake below).
import { createRecorder } from '../editor/record.js';
import { countInTimes, clampBpm, DEFAULT_BPM } from '../learn/count-in.js';
import { rmsLevel } from '../learn/level.js';
import { mixToMono } from '../playalong/audio-prep.js';
import { framesFromPCM } from '../../audio/file-frames.js';
import { transcribe } from '../../song/transcribe.js';
import { rangeForInstrument } from '../../audio/range.js';
import { validateSong } from '../../song/model.js';

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

// Reads the picked file's own filename as this song's working title (the
// notation importers already do this for a title-less file); a learner
// can rename it from Songs afterwards the same way any imported song is
// renamed.
function titleFromFileName(fileName) {
  const name = String(fileName || 'My recording');
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name) || 'My recording';
}

// transcribeAudioFile(file, api): decodes a dropped/picked audio file
// through the EXACT SAME pipeline the mic door's own capture uses --
// decodeAudioData -> mixToMono (src/ui/playalong/audio-prep.js) ->
// framesFromPCM (src/audio/file-frames.js) -> transcribe (src/song/
// transcribe.js) -- and also hands back the decoded { pcm, sampleRate,
// duration, fileName } this file just became, so a "Play along with this
// recording" button can hand the SAME decoded audio to Play Along (src/ui/
// playalong.js's requestPlayalongRecording()) without decoding the file a
// second time.
export async function transcribeAudioFile(file, api) {
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

// createRecordDoor(api, { onTake, say, idPrefix }): builds the mic section
// (tempo field, level meter, count-in beat display, Record/Stop button) and
// wires Record -> Counting in… (four clicks, "1 2 3 4") -> recording starts
// on the downbeat -> Stop -> transcribe. On a successful take it calls
// onTake(song, warnings) and leaves saving (library.add) and rendering the
// result to the caller, so the caller's own save-before-review order is
// unchanged. `say` is the caller's own status line (shared with the file
// door), so both doors report through the one place a learner is already
// watching. idPrefix defaults to 'learn' so learn.js's own ids/classes
// (learnBpm, panel-learn-beat, panel-learn-record-btn, panel-learn-meter,
// ...) come out byte-identical; a later caller (Songs) can pass a different
// prefix so its own copy of this door never clashes ids with learn.js's.
export function createRecordDoor(api, { onTake, say, onStart, idPrefix = 'learn' } = {}) {
  // Reuses src/ui/editor/record.js's createRecorder unchanged (the same
  // frame recorder "Record a tune" drives) against this door's own panelApi,
  // so the capture itself is not reimplemented here.
  const recorder = createRecorder(api);
  const micSection = el('div', { class: `panel-${idPrefix}-mic` });
  micSection.appendChild(el('h4', { text: 'Or sing, hum or play into the mic' }));
  const bpmId = `${idPrefix}Bpm`;
  const bpmInput = el('input', {
    type: 'number', id: bpmId, min: '40', max: '200', value: String(DEFAULT_BPM),
    class: `panel-${idPrefix}-bpm`, 'aria-label': 'Tempo (beats per minute)',
  });
  const bpmRow = el('div', { class: `panel-${idPrefix}-bpm-row` }, [
    el('label', { for: bpmId, text: 'Tempo (beats per minute)' }), bpmInput,
  ]);
  const meterFill = el('div', { class: `panel-${idPrefix}-meter-fill` });
  const meterBox = el('div', {
    class: `panel-${idPrefix}-meter`, role: 'progressbar', 'aria-label': 'Microphone level',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0',
  }, [meterFill]);
  const beatEl = el('p', { class: `panel-${idPrefix}-beat`, 'aria-live': 'polite' });
  const recordBtn = el('button', { type: 'button', class: `panel-${idPrefix}-record-btn`, text: 'Record' });
  micSection.append(bpmRow, meterBox, beatEl, recordBtn);

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
    if (typeof onStart === 'function') onStart();
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
      await onTake(song, (report && report.needsCheck) || []);
    } catch (e) {
      if (typeof api.recordError === 'function') api.recordError('learn:mic', e);
      say('That recording could not be analysed. Try again, or drop a recording instead.');
    }
  }

  recordBtn.addEventListener('click', () => {
    if (recording || counting) stopMicRecording();
    else startMicRecording();
  });

  // Leaving this door mid count-in or mid recording must not leave the
  // meter's requestAnimationFrame loop or a pending count-in click running
  // in the background -- stop them, and any in-flight capture's frames are
  // simply discarded (nothing was played to the learner suggesting it was
  // saved). destroy() does the same, for a caller that unmounts this door
  // outright rather than just hiding it.
  function teardown() {
    if (counting) clearCountInTimers();
    if (recording) recorder.stop();
    resetMicUi();
  }

  return {
    el: micSection,
    hide: teardown,
    destroy: teardown,
    busy() { return counting || recording; },
  };
}
