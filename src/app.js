import { judgePitch, OCTAVE_POLICY } from './core/judge.js';
import { createDeafWindow } from './audio/deaf-window.js';
import { exportProgress as exportProgressFile, importProgress as importProgressFile, migrate as migrateDB } from './core/progress-file.js';
import { safeSet, safeGet } from './core/storage.js';
import { sanitizeDB as sanitizeDBCore } from './core/sanitize-db.js';
import { createLibrary, indexedDbStore, memoryStore } from './song/library.js';
import { captureToSong } from './song/capture.js';
import { toAudioTime, judgeTap, medianLatency } from './core/timing.js';
import { DEFAULT_STABILITY_DAYS, MIN_STABILITY_DAYS, MAX_STABILITY_DAYS, GRADE, retrievability, review, due, migrateItem } from './core/srs.js';
import { handsTogetherById, handsModeFromId, fingeringLabel, bothUnlocked, effectiveHands, prepLine, HANDS_TOGETHER_EXERCISES, isTimedPairId, PAIR_ONSET_TOL_MS, PAIR_RELEASE_TOL_MS, isStagedPairId, handsStageFromId, heldBassMelody, SPLIT_MID_TOL_RATIO, POSITION_SHIFT_SEMITONES, HANDS_POSITION_EXERCISES, positionPrepLine } from './core/hands-together.js';
import { step as stepHandsTogether } from './core/hands-together-stage.js';
import { createMidiParser, describeOutputs, scheduleSong, playOnOutput, stopAll } from './core/midi.js';
import { createNoteState } from './core/note-state.js';
import { PCKEYS } from './core/pckeys.js';
import { createTeardown } from './core/session-teardown.js';
// Merge slots: a unit in flight adds its imports by replacing ONLY its own
// slot line, so parallel branches never edit adjacent lines.
import { recordError, getErrors } from './core/error-log.js';
import { resolveAppVersion, DEV_VERSION } from './core/version.js';
import { loadPack, packStatus, createIndexedDBStore, packManifestUrl, DEFAULT_MODEL_PACK } from './core/model-pack.js';
import { checkForUpdate, FALLBACK_DOWNLOAD_URL } from './core/update-check.js';
import { setNoteNaming, name as noteNameFor } from './core/note-names.js';
import { t, en, setLocale, LOCALES } from './core/i18n.js';
import { CLEF_PATHS } from './notation/glyphs.js';
import { yin } from './audio/yin.js';
import { createPitchNode } from './audio/pitch-worklet.js';
//
import { gatesFor, meterLevel, releaseFloor, classifyRoomCheck, ROOM_CHECK_VERSION, MIN_FLOOR, QUIET_RELEASE_SEC } from './audio/levels.js';
import { diagnoseInput, stepDiagnosis } from './audio/input-diagnosis.js';
import { createOnsetDetector } from './audio/onset.js';
import { createDrumClassifier } from './audio/drum-classify.js';
//
import { chroma, judgeChord } from './audio/chords.js';
//
import { makeGrid, scoreTake, tempoLadder } from './core/groove.js';
import { stepTuner } from './core/tuner.js';
import { wrongNoteHint, writtenMidi } from './core/wrong-note.js';
import { shouldReveal, promptFor, hintFor as coreHintFor } from './core/reveal.js';
import { gradeOutcome } from './core/grade-outcome.js';
import { makeEvent, validateEvent, boundEvents } from './core/learning-events.js';
import { planSession, describePlan, describeWhy, nextPlanStep } from './core/curriculum.js';
//
import * as RHY from './core/rhythm.js';
//
import { forInstrument } from './notation/for-instrument.js';
import { drawPrimitives } from './notation/draw-canvas.js';
import { byId as instrumentById } from './instruments/index.js';
import { rangeForInstrument, FALLBACK_RANGE, frameSizeForInstrument } from './audio/range.js';
import { renderVoice } from './audio/voices.js';
import { layoutFor as harpLayoutFor } from './instruments/how/harmonica.js';
import { pieceForMidi } from './instruments/drum-kit.js';
import { kitLayout, pieceAt, spreadX } from './instruments/how/drum-kit.js';
import { layoutPercussionMeasure } from './notation/percussion.js';
import { songFor, KBD_SONG_SKILL_MAP } from './instruments/kbd-songs.js';
import { buildMods } from './instruments/mods.js';
import { itemReview, contentRev } from './instruments/review-ledger.js';
import { isReviewCurrent } from './instruments/review.js';
import { starterSongs } from './song/starter/index.js';
import { pathwayState } from './core/pathway.js';
import { reviewItems as kbdPathwayOutcomes, outcomeReviewed } from './instruments/kbd-pathway.js';
// slot:import:notation-wire
//
// slot:import:a11y
import { describeTask } from './ui/describe.js';
import { createWakeLock } from './ui/wake-lock.js';
import { createFocusTrap } from './ui/dialog-focus.js';
import { createPanels, sanitizePanelData } from './ui/panels.js';
import { estimateRange, classify, exerciseRangeFor, tonicFromRange } from './instruments/how/voice-range.js';
//
//
// slot:import:w-songs
import { register as registerSongs, forwardNote as forwardSongNote, forwardNoteAt as forwardSongNoteAt, requestOpenSong, recordStartSec as songsRecordStartSec } from './ui/songs.js';
import { itemIdForMidi } from './ui/songs/mastery.js';
import { __setDebugFrames as __editorSetDebugFrames, __isRecording as __editorIsRecording } from './ui/songs/record-door.js';
import { register as registerEditor, __getDebugSong } from './ui/editor.js';
//
//
import { registerEar, __earTestHook } from './ui/ear.js';
//
//
import { register as registerTheory, currentLessonQuestion as theoryCurrentQuestion } from './ui/theory.js';
//
//
import { registerHistory } from './ui/history.js';
//
//
import { registerFingerings, renderHowInline } from './ui/fingerings.js';
import { instrumentSetup } from './ui/fingerings/setup.js';
//
//
import { register as registerPlayalong } from './ui/playalong.js';
import { register as registerPathway } from './ui/pathway.js';
//
//
// slot:import:w-fixes
//
//

(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  // Static page labels: every element src/index.html marks with data-i18n="id"
  // gets its textContent set from t(id) once at startup, so the shipped copy
  // comes from the same English table as the strings app.js writes itself
  // (see src/core/i18n.js). i18n.js stays DOM-free by design, so the walk
  // lives here; the English text is left in the HTML too as the pre-JS/no-JS
  // fallback, and this only overwrites it with the identical string today.
  function applyStaticLabels(root) { root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); }); }
  // Language pick (Settings > Language, DB.prefs.locale): switches t(), <html lang>, the static labels and the nav landmark name. Dynamic text picks the new language up the next time it is drawn.
  function applyLocale(code) { setLocale(code); document.documentElement.lang = code; applyStaticLabels(document); $('mainNav').setAttribute('aria-label', t('nav.label')); }
  const deafWindow = createDeafWindow({ now: () => performance.now() });
  // ---------- accessibility: wake lock, dialog focus, reduced motion ----------
  const wakeLock = createWakeLock();
  let reducedMotion = false;
  try {
    const rmQuery = matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = rmQuery.matches;
    rmQuery.addEventListener('change', (ev) => { reducedMotion = ev.matches; });
  } catch (e) {}
  // ---------- music helpers ----------
  const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const SOLFA = { 0: 'Do', 2: 'Re', 4: 'Mi', 5: 'Fa', 7: 'Sol', 9: 'La', 11: 'Ti', 12: 'high Do' };
  const pc = m => ((Math.round(m) % 12) + 12) % 12;
  const nname = (m, oct) => noteNameFor(m, oct);
  const mfreq = m => 440 * Math.pow(2, (m - 69) / 12);
  const fmidi = f => 69 + 12 * Math.log2(f / 440);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const c01 = x => clamp(x, 0, 1);
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const CHORDS = { C: [0, 4, 7], F: [5, 9, 0], G: [7, 11, 2], Am: [9, 0, 4], Dm: [2, 5, 9], Em: [4, 7, 11], D: [2, 6, 9], A: [9, 1, 4], E: [4, 8, 11], G7: [7, 11, 2, 5] };
  const CHORD_NAMES = { C: 'C major', F: 'F major', G: 'G major', Am: 'A minor', Dm: 'D minor', Em: 'E minor', D: 'D major', A: 'A major', E: 'E major', G7: 'G seventh' };
  const INTERVALS = { 1: 'Minor second', 2: 'Major second', 3: 'Minor third', 4: 'Major third', 5: 'Perfect fourth', 6: 'Tritone', 7: 'Perfect fifth', 8: 'Minor sixth', 9: 'Major sixth', 10: 'Minor seventh', 11: 'Major seventh', 12: 'Octave' };
  const QUALS = { maj: ['Major chord', [0, 4, 7]], min: ['Minor chord', [0, 3, 7]], dim: ['Diminished chord', [0, 3, 6]], aug: ['Augmented chord', [0, 4, 8]], dom7: ['Dominant seventh', [0, 4, 7, 10]], maj7: ['Major seventh chord', [0, 4, 7, 11]], min7: ['Minor seventh chord', [0, 3, 7, 10]] };
  const CELLS = { q: { b: 1, on: [0], say: 'quarter note' }, ee: { b: 1, on: [0, 0.5], say: 'two eighths' }, h: { b: 2, on: [0], say: 'half note' }, qr: { b: 1, on: [], say: 'quarter rest' }, ssss: { b: 1, on: [0, 0.25, 0.5, 0.75], say: 'four sixteenths' }, dqe: { b: 2, on: [0, 1.5], say: 'dotted quarter, eighth' }, ree: { b: 1, on: [0.5], say: 'eighth rest, eighth' }, ess: { b: 1, on: [0, 0.5, 0.75], say: 'eighth, two sixteenths' }, sse: { b: 1, on: [0, 0.25, 0.5], say: 'two sixteenths, eighth' }, eqe: { b: 2, on: [0, 0.5, 1.5], say: 'eighth, quarter, eighth' } };

  // ---------- audio ----------
  let actx = null, micStream = null, anTime = null, anFreq = null, micReady = false, micHideReleased = false, testNodes = [];
  let gates = gatesFor(null), micDevices = [];
  // Counts ticks of the pitch-analysis setInterval (below) where the buffer
  // it read actually carried signal, not silence or a freshly-connected
  // AnalyserNode's zero-padding. micReady flips true (and #ioBtn.hidden with
  // it) synchronously, BEFORE any synthetic audio has flowed through the
  // analyser (testSource() wires it and sets micReady, then only afterwards
  // starts the oscillators) -- so a test that starts asserting on pitch the
  // moment #ioBtn hides can land inside that ~85ms (fftSize/sampleRate)
  // window and see a corrupted/zero yin() result. This counter is the
  // evidence a test can wait on instead: exposed read-only via __coach.
  let audioHeardTicks = 0;
  // AUDIO_HEARD_RMS_FLOOR: silence/zero-padding reads as rms === 0 exactly
  // (a zeroed Float32Array), and the default uncalibrated pitch gate
  // (DEFAULT_GATES.pitch, src/audio/levels.js) is 0.008 -- 0.02 sits clearly
  // above both, while testSource()'s synthetic tones (oscillator plus
  // 1/h^2 harmonics, summed and only mildly attenuated) read far louder
  // than that in practice, so real test audio never fails this floor.
  const AUDIO_HEARD_RMS_FLOOR = 0.02;
  // Diagnostic snapshot of monoSum()'s routing decision (RMS + gains), read-only, exposed on the debug hook.
  let lastMonoRoute = null;
  // E3: pitch tracking moved off the main thread onto an AudioWorklet
  // (src/audio/pitch-worklet.js) when available; pitchWorkletNode stays null
  // (and listen() below keeps running its setInterval sampling unchanged) on
  // any browser/context where AudioWorklet is missing or fails to load.
  let pitchWorkletNode = null, lastAudioSource = null, lastWorkletPitchAt = 0, pitchWorkletPromise = null, lastWorkletRangeSent = null, lastWorkletFrameSize = null, lastWorkletGateSent = null, lastWorkletMessageAt = 0;
  // VERIFIED DEFECT 1 (mic-gate-and-capture): setting `gates` on the main
  // thread (calibrateNoiseFloor below) used to never reach the worklet's own
  // rmsGate, which was fixed forever at whatever gates.pitch was when
  // ensurePitchWorklet() first built it. This is the ONE place `gates` is
  // reassigned and the worklet told about it, mirroring setMod's existing
  // range/frameSize re-send (see below) -- same port-message shape, same
  // applyGateMessage handler in src/audio/pitch-worklet.js.
  function applyGates(newGates) {
    gates = newGates;
    if (pitchWorkletNode && gates.pitch !== lastWorkletGateSent) { lastWorkletGateSent = gates.pitch; pitchWorkletNode.port.postMessage({ type: 'gate', rmsGate: gates.pitch }); }
  }
  // Returns a promise that resolves once the worklet is wired (or has
  // failed) so a caller that needs the real pipeline settled first — the
  // testPluck() debug hook below, so its synthetic timings are not a race
  // against addModule()'s async load — can await it. Real usage (openMic)
  // fires it without awaiting: nothing about live play depends on the
  // worklet winning the race against the setInterval fallback.
  function ensurePitchWorklet() {
    if (pitchWorkletPromise) return pitchWorkletPromise;
    if (!actx) return Promise.resolve(null);
    const M0 = MODS[mod], range0 = { fmin: (M0 && M0.fmin) || FALLBACK_RANGE.fmin, fmax: (M0 && M0.fmax) || FALLBACK_RANGE.fmax };
    const frameSize0 = frameSizeForInstrument(instrumentById[mod], actx.sampleRate);
    const gate0 = gates.pitch;
    pitchWorkletPromise = createPitchNode(actx, { fmin: range0.fmin, fmax: range0.fmax, rmsGate: gate0, frameSize: frameSize0 }).then(node => {
      pitchWorkletNode = node; lastWorkletRangeSent = range0; lastWorkletFrameSize = frameSize0; lastWorkletGateSent = gate0; lastWorkletMessageAt = now();
      // calibrateNoiseFloor() can finish (or run again) while addModule() was
      // still loading -- gates.pitch may already have moved past what this
      // node was built with by the time the promise settles, in which case
      // applyGates() above found no worklet yet to post to. Catch up here.
      if (gates.pitch !== gate0) { lastWorkletGateSent = gates.pitch; node.port.postMessage({ type: 'gate', rmsGate: gates.pitch }); }
      if (lastAudioSource) lastAudioSource.connect(node);
      const mute = actx.createGain(); mute.gain.value = 0; node.connect(mute); mute.connect(actx.destination); // keeps the worklet in the live render graph without making sound
      node.port.onmessage = ev => {
        lastWorkletMessageAt = now(); // watchdog liveness signal below -- updated regardless of `mod`, so the watchdog reflects the worklet actually running, not whether its output happens to be used right now
        const d = ev.data, M = MODS[mod]; if (!M || !(M.input === 'pluck' || M.input === 'sustain')) return;
        if (!micReady) return; // the mic was released (tab hidden, device unplugged): the source still streams zeros, which diagnoseInput would call a muted mic
        const fr = { rms: d.rms, freq: d.freq && d.clarity > 0.8 ? d.freq : 0, onset: d.onset, clarity: d.clarity }; if (fr.freq) fr.midi = fmidi(fr.freq);
        if (task && cur() && cur().info.kind === 'chord') { const db = new Float32Array(anFreq.frequencyBinCount); anFreq.getFloatFrequencyData(db); fr.chroma = chroma(db, actx.sampleRate); }
        meterUpdate(fr.rms);
        const t = now(), dt = Math.min(0.2, t - (lastWorkletPitchAt || t)); lastWorkletPitchAt = t;
        try { onPitch(fr, dt); } catch (e) { errCount++; recordError('onPitch', e); }
      };
      return node;
    }).catch(() => null);
    return pitchWorkletPromise;
  }
  // WORKLET WATCHDOG (VERIFIED DEFECT 2, mic-gate-and-capture): a processor
  // whose constructor throws surfaces asynchronously -- addModule() still
  // resolves and `new AudioWorkletNode(...)` still succeeds (createPitchNode
  // above), so pitchWorkletNode looks healthy while process() never ran and
  // no message ever arrives. Because pitchWorkletNode is then non-null,
  // listen() below stands down forever -- the fallback is switched off by
  // exactly the failure it exists to cover. A 'processorerror' event is not
  // a usable signal here either (measured against the actual broken build:
  // it never reached the page). The only trustworthy signal is whether
  // frames are actually ARRIVING.
  //
  // Grace period arithmetic: the worklet's process() (src/audio/
  // pitch-worklet.js) posts nothing until its ring buffer fills
  // (this.filled >= this.frameSize), then one message per hop. The largest
  // frameSize any instrument needs (frameSizeForInstrument, src/audio/
  // range.js) is 4096 -- the 5-string bass's open B0 (30.87Hz, ~1785-sample
  // period at 44.1kHz once FRAME_SIZE_MARGIN is applied) is the first note
  // whose period clears 2048's (2048>>1)-1 = 1023-sample search cap, so it
  // doubles to 4096 ((4096>>1)-1 = 2047). Worst-case initial fill is
  // therefore 4096 / 44100 ~= 92.9ms; hop stays 512 regardless of frameSize,
  // so every message after that first one is ~512/44100 ~= 11.6ms apart. 5x
  // the worst-case fill (~465ms) covers a dropped render quantum plus
  // ordinary scheduling jitter without ever tripping on a genuinely live
  // worklet, so the grace period below is 500ms.
  const WORKLET_WATCHDOG_GRACE_S = 0.5;
  const WORKLET_WATCHDOG_POLL_MS = 100;
  function checkWorkletWatchdog() {
    if (!pitchWorkletNode) return;
    if (now() - lastWorkletMessageAt < WORKLET_WATCHDOG_GRACE_S) return;
    const dead = pitchWorkletNode; pitchWorkletNode = null; // listen() below picks up the very next tick of its own setInterval
    try { dead.disconnect(); } catch (e) {} // takes it out of the render graph so a late/queued message can never reach onmessage after this
    recordError('worklet-watchdog', new Error('The pitch worklet produced no frames for ' + WORKLET_WATCHDOG_GRACE_S + 's; switched to the main-thread listener.'));
  }
  setInterval(checkWorkletWatchdog, WORKLET_WATCHDOG_POLL_MS);
  // ensureAudio() CREATES the context, so it belongs on gesture paths only
  // (clicks, key presses, taps): Chrome logs "The AudioContext was not
  // allowed to start" for a context created anywhere else. Handlers that
  // merely bring a learner back (visibilitychange, bfcache pageshow) call
  // resumeAudio(), which wakes a suspended context and never makes one.
  function ensureAudio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } } resumeAudio(); return actx; }
  function resumeAudio() { if (actx && actx.state === 'suspended') actx.resume(); }
  const now = () => actx ? actx.currentTime : performance.now() / 1000;
  // Instrument-family-shaped reference tone (src/audio/voices.js): a
  // pre-rendered buffer, computed by pure JS synthesis, never an embedded
  // recording. `mod` (the active instrument id) selects the family via
  // instrumentById; an instrument this build does not recognise falls back
  // to a plain sustained tone rather than throwing or staying silent. The
  // deaf window is opened for the BUFFER'S OWN length, so it always covers
  // exactly what will actually play, however long that family's tail runs.
  function tone(m, at, dur, vol) {
    if (!actx) return;
    const family = instrumentById[mod] && instrumentById[mod].family;
    const samples = renderVoice(family, mfreq(m), actx.sampleRate, dur, vol || 0.22);
    const buffer = actx.createBuffer(1, samples.length, actx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const src = actx.createBufferSource(), v = actx.createGain();
    src.buffer = buffer; v.gain.value = 1; src.connect(v); v.connect(actx.destination);
    src.start(at);
    const seconds = samples.length / actx.sampleRate;
    deafWindow.open(Math.max(0, (at + seconds - now()) * 1000));
  }
  // A synthesized drum for a kit key or click (no samples): kick a 150->50 Hz sine sweep, snare
  // noise plus a 200 Hz body, hi-hats highpassed noise (40 ms closed/pedal, 200 ms open), toms a
  // falling sine, crash and ride long noise. Opens the deaf window for its own length, like click().
  const DRUM_LEN = { kick: 0.12, snare: 0.15, 'hihat-closed': 0.04, 'hihat-pedal': 0.04, 'hihat-open': 0.2, 'tom-high': 0.2, 'tom-mid': 0.2, 'tom-floor': 0.2, crash: 0.8, ride: 0.8 }, TOM_HZ = { 'tom-high': 200, 'tom-mid': 160, 'tom-floor': 110 };
  function drumHit(piece, at) {
    if (!actx || !DRUM_LEN[piece]) return; const len = DRUM_LEN[piece];
    const env = (node, peak) => { const v = actx.createGain(); v.gain.setValueAtTime(peak, at); v.gain.exponentialRampToValueAtTime(0.0001, at + len); node.connect(v); v.connect(actx.destination); };
    const sine = (f0, f1, peak) => { const o = actx.createOscillator(); o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + len); env(o, peak); o.start(at); o.stop(at + len + 0.02); };
    const noise = (peak, hp) => { const n = Math.ceil(actx.sampleRate * len), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; const src = actx.createBufferSource(); src.buffer = b; let node = src; if (hp) { node = actx.createBiquadFilter(); node.type = 'highpass'; node.frequency.value = hp; src.connect(node); } env(node, peak); src.start(at); };
    if (piece === 'kick') sine(150, 50, 0.6); else if (piece === 'snare') { noise(0.3); sine(200, 180, 0.2); } else if (TOM_HZ[piece]) sine(TOM_HZ[piece], TOM_HZ[piece] * 0.8, 0.45); else noise(piece === 'crash' || piece === 'ride' ? 0.12 : 0.2, piece === 'crash' || piece === 'ride' ? 5000 : 7000);
    deafWindow.open(Math.max(0, (at + len - now()) * 1000));
  }
  function click(at, accent) { if (!actx) return; const o = actx.createOscillator(), v = actx.createGain(); o.type = 'square'; o.frequency.value = accent ? 1500 : 1000; v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(0.16, at + 0.002); v.gain.exponentialRampToValueAtTime(0.0001, at + 0.05); o.connect(v); v.connect(actx.destination); o.start(at); o.stop(at + 0.06); deafWindow.open(Math.max(0, (at + 0.06 - now()) * 1000)); }

  // ---------- listening: pitch (YIN, src/audio/yin.js) and chord colour (chroma) ----------
  // chroma() moved to src/audio/chords.js (imported above) — it now peels
  // harmonics of a strong peak out of the spectrum before folding to
  // pitch classes, fixing flaw F6 (a single note's own harmonics reading
  // as another note). See that module for detail.
  // VERIFIED DEFECT 3 (mic-gate-and-capture): a guitar/instrument plugged
  // into only one side of a 2-channel audio interface used to be handed to
  // the browser's own default stereo->mono downmix, whatever that happens to
  // be -- measured (headless Chromium, fake device, no channelCount
  // constraint) to SILENCE a signal that exists only on the right channel
  // entirely, not merely halve it. `channelCount: { ideal: 2 }` is an ideal,
  // never `exact`, so no mono-only device is rejected; monoSum() below then
  // sums L+R explicitly in the graph so the app's own behaviour never
  // depends on the browser's implicit downmix.
  //
  // Adaptive mono sum: two hardware behaviours are both real and in tension
  // here -- a genuinely one-sided interface (signal on exactly one channel,
  // silence on the other) and an interface that duplicates one mono
  // capsule's signal onto both channels identically. A FIXED 0.5/0.5 sum
  // fixes the second case perfectly but leaves the first at half a true
  // mono capture's level -- half level on an already-quiet instrument can
  // still sit under the gate, so that "fix" is a defect of its own, not a
  // tradeoff. This routes each case correctly instead of guessing: a brief
  // per-channel RMS reading, taken after a short settle window and then
  // re-checked periodically (a cable can be re-patched mid-session), decides
  // whether one channel is carrying the whole signal (route it alone, at
  // unity gain -- the same level a true mono capture of it would read) or
  // both are carrying comparable energy (average them 0.5/0.5, exactly
  // today's duplicated-mono behaviour, never doubled).
  function monoSum(src) {
    if (!src.channelCount || src.channelCount < 2) return src;
    const splitter = actx.createChannelSplitter(2), sum = actx.createGain(), gL = actx.createGain(), gR = actx.createGain();
    gL.gain.value = 0.5; gR.gain.value = 0.5; // starting point until the first measurement below routes it
    const anL = actx.createAnalyser(), anR = actx.createAnalyser();
    anL.fftSize = 1024; anR.fftSize = 1024;
    src.connect(splitter); splitter.connect(gL, 0); splitter.connect(gR, 1); splitter.connect(anL, 0); splitter.connect(anR, 1);
    gL.connect(sum); gR.connect(sum);
    const bufL = new Float32Array(anL.fftSize), bufR = new Float32Array(anR.fftSize);
    const chanRms = (an, buf) => { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); };
    // A channel routes out entirely when its RMS is under this fraction of
    // the other's -- above ordinary channel-separation crosstalk, below a
    // genuinely live channel's level.
    const SILENT_RATIO = 0.1;
    // Below this absolute RMS, both channels read as "nobody playing yet" --
    // under levels.js's quietest calibrated gate (gatesFor(MIN_FLOOR) == 0.0045).
    const MIN_MEASURABLE_RMS = 0.001;
    function route() {
      const rL = chanRms(anL, bufL), rR = chanRms(anR, bufR);
      if (rL < MIN_MEASURABLE_RMS && rR < MIN_MEASURABLE_RMS) { lastMonoRoute = { rL, rR, gL: gL.gain.value, gR: gR.gain.value, t: actx.currentTime, skipped: true }; return; } // nothing playing yet -- keep the current routing rather than guess off noise
      const at = actx.currentTime;
      if (rL <= rR * SILENT_RATIO) { gL.gain.setTargetAtTime(0, at, 0.02); gR.gain.setTargetAtTime(1, at, 0.02); }
      else if (rR <= rL * SILENT_RATIO) { gL.gain.setTargetAtTime(1, at, 0.02); gR.gain.setTargetAtTime(0, at, 0.02); }
      else { gL.gain.setTargetAtTime(0.5, at, 0.02); gR.gain.setTargetAtTime(0.5, at, 0.02); }
      lastMonoRoute = { rL, rR, gLTarget: gL.gain.value, gRTarget: gR.gain.value, t: at };
    }
    // Settle window, then periodic re-check; wireAnalysers below clears this on source swap.
    setTimeout(route, 150);
    sum.__monoRouteInterval = setInterval(route, 300);
    return sum;
  }
  // #ioBtn stays visible (ioRefresh) until micReady flips true, so an
  // impatient double-click -- easy while waiting on the permission prompt --
  // used to fire getUserMedia() twice concurrently: the loser's MediaStream
  // was dropped with its tracks never stopped, leaving the OS mic indicator
  // lit until the tab closed. Sharing one in-flight promise across
  // concurrent callers means only one getUserMedia() call is ever made.
  let openMicPromise = null;
  // micGen advances when the input device changes and when the mic is torn down; a room check that finishes for an older stream discards its result. roomSeq numbers room checks so only the newest one writes (a manual check supersedes the background one).
  let micGen = 0, roomSeq = 0, manualSeq = 0;
  async function openMic() {
    ensureAudio(); if (micReady) return true;
    if (openMicPromise) return openMicPromise;
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
    const wanted = DB.prefs.inputDeviceId ? { ...base, deviceId: { exact: DB.prefs.inputDeviceId } } : base;
    openMicPromise = (async () => {
      let st;
      try { st = await navigator.mediaDevices.getUserMedia({ audio: wanted }); }
      catch (e) { if (!DB.prefs.inputDeviceId) throw e; st = await navigator.mediaDevices.getUserMedia({ audio: base }); }
      micStream = st; micHideReleased = false; const src = actx.createMediaStreamSource(st); wireAnalysers(monoSum(src)); micReady = true;
      // A successful Connect clears the 'blocked' sentence calibrateNoiseFloor wrote (its catch below: keep the two texts identical), so it does not sit beside 'Listening through your microphone.'. Any other result text is left alone.
      { const cr = $('calibrateResult'); if (cr && cr.textContent === 'The microphone was blocked, so it could not be checked.') cr.textContent = ''; }
      // A track that ends (device unplugged, permission revoked) leaves the mic as the teardown 'mic' stopper does, then the status and Connect button follow. Only the CURRENT stream counts: a switched-away stream ending later must not close its replacement. micGen++ makes a room check still running for it discard its result.
      st.getAudioTracks().forEach(tr => tr.addEventListener('ended', () => { if (micStream !== st) return; const pm = $('practiceMeter'); if (pm) pm.hidden = true; st.getTracks().forEach(t => t.stop()); micStream = null; micReady = false; micGen++; ioRefresh(); }));
      ensurePitchWorklet(); refreshMicDevices();
      // First Connect (or first after a device change) with no stored floor: listen to the room for ~1.5 s so the gates follow this mic, not the fixed defaults. It abstains when it hears playing.
      if (DB.prefs.noiseFloor == null) checkRoomInBackground();
      return true;
    })();
    try { return await openMicPromise; } finally { openMicPromise = null; }
  }
  // Session teardown (E10): the tab going hidden used to only pause the
  // exercise (takeBreak/flushSave/releaseNotes, see the visibilitychange
  // listener below) -- the mic stream and the AudioContext kept running,
  // leaving the OS mic indicator lit and audio nodes ticking in a
  // backgrounded/closed tab. `teardown` is a small ordered registry (pure,
  // src/core/session-teardown.js) so both call sites that need this
  // (visibilitychange->hidden and pagehide) run the exact same stoppers
  // rather than duplicating stop logic. Each stopper only touches what it
  // owns, and a stopper that finds nothing to do (mic already stopped from a
  // device switch, actx never created) is a safe no-op -- runTeardown() is
  // called from both sites and needs to be idempotent either way.
  const teardown = createTeardown();
  let teardownRunCount = 0;
  teardown.add('mic', (reason) => { const pm = $('practiceMeter'); if (pm) pm.hidden = true; if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; micReady = false; micGen++; if (reason === 'hidden') micHideReleased = true; } }); // micHideReleased: only a hide that really released an open mic lets resume() say so
  teardown.add('audioContext', () => { if (actx && actx.state === 'running') actx.suspend(); });
  // "Play it for me" (see midiOutPlay below): a hidden/closed tab must not leave a keyboard sounding.
  teardown.add('midiOut', () => midiOutStop());
  function runTeardown(reason) { teardownRunCount++; teardown.run(reason); }
  async function refreshMicDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    let list = []; try { list = await navigator.mediaDevices.enumerateDevices(); } catch (e) { return; }
    micDevices = list.filter(d => d.kind === 'audioinput');
    const sel = $('micDeviceSelect'); if (!sel) return;
    const wanted = DB.prefs.inputDeviceId || '';
    sel.innerHTML = '';
    const def = document.createElement('option'); def.value = ''; def.textContent = 'Default microphone'; sel.appendChild(def);
    micDevices.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || ('Microphone ' + (i + 1)); sel.appendChild(o); });
    sel.value = micDevices.some(d => d.deviceId === wanted) ? wanted : '';
  }
  function meterUpdate(rms) { const pct = meterLevel(rms) * 100; ['micLevelFill', 'practiceLevelFill'].forEach(id => { const el = $(id); if (!el) return; el.style.width = pct + '%'; const box = el.closest('[role="progressbar"]'); if (box) box.setAttribute('aria-valuenow', String(Math.round(pct))); }); const pm = $('practiceMeter'); if (pm && pm.hidden && micReady) pm.hidden = false; }
  // Samples the analyser every 50 ms for `ms`: each frame's RMS and whether yin hears a pitch in it (the pitch search is skipped below MIN_FLOOR). `fresh` is false when the input device changed or the mic was torn down meanwhile: the reading is then partly or wholly another stream's. The window opens at the first frame with any signal: a stream that has not started delivering yet reads exactly 0 (a real microphone never does), and a window of those is not the room. If nothing arrives within ROOM_AUDIO_WAIT_MS the result has no frames, which the classifier calls unusable.
  const ROOM_AUDIO_WAIT_MS = 3000;
  async function listenRoom(ms) {
    const frames = [], gen = micGen, tWait = performance.now(); let t0 = null;
    await new Promise((resolve, reject) => {
      const iv = setInterval(() => {
        try {
          const buf = new Float32Array(anTime.fftSize); anTime.getFloatTimeDomainData(buf);
          // RMS over the whole window; the pitch search only for audible frames and only on the newest 2048 samples (the full 4096 costs ~5 ms of main thread per 50 ms frame, this about a third of that).
          let sq = 0; for (let i = 0; i < buf.length; i++) sq += buf[i] * buf[i]; const rms = Math.sqrt(sq / buf.length);
          if (t0 === null) { if (rms > 0) t0 = performance.now(); else { if (performance.now() - tWait > ROOM_AUDIO_WAIT_MS) { clearInterval(iv); resolve(); } return; } }
          const r = rms >= MIN_FLOOR ? yin(buf.subarray(buf.length - 2048), actx.sampleRate, 50, 1000, 0) : null; frames.push({ rms, pitched: !!(r && r.freq && r.clarity > 0.8) });
        } catch (e) { clearInterval(iv); reject(e); return; }
        if (performance.now() - t0 > ms) { clearInterval(iv); resolve(); }
      }, 50);
    });
    return { frames, fresh: gen === micGen };
  }
  const ROOM_QUIET_BELOW = 0.003, roomQuietOrNoisy = f => f < ROOM_QUIET_BELOW ? 'Your room is quiet.' : 'There\'s a lot of background noise — move closer to the mic.';
  const ROOM_NO_READING = 'Could not get a reading from the microphone, so the standard settings are in use. Press "Check my microphone" to try again.';
  const ROOM_ERROR = 'Something went wrong while listening to the microphone, so the standard settings are in use. Press "Check my microphone" to try again.'; // a throw inside listenRoom: kept apart from "no audio arrived" so the two can be told apart
  function storeRoomFloor(f) { DB.prefs.noiseFloor = f; DB.prefs.noiseFloorV = ROOM_CHECK_VERSION; applyGates(gatesFor(f)); save(); }
  // Connect's automatic check. Visible in #calibrateResult; on abstain nothing is stored (gates stay at the defaults, the next Connect tries again).
  async function checkRoomInBackground() {
    const my = ++roomSeq, el = $('calibrateResult'), say = s => { if (el) el.textContent = s; };
    say('Checking the room — stay quiet for a moment…');
    let r; try { r = await listenRoom(1500); } catch (e) { if (my === roomSeq) say(ROOM_ERROR); return; }
    if (my !== roomSeq) return; // a newer check owns the message now
    if (!r.fresh || DB.prefs.noiseFloor != null) { say(''); return; }
    const v = classifyRoomCheck(r.frames, { manual: false });
    if ('floor' in v) { storeRoomFloor(v.floor); say(roomQuietOrNoisy(v.floor)); }
    else say(v.abstain === 'unusable' ? ROOM_NO_READING : 'Heard sound while checking the room, so the standard settings are in use. For a custom check, press "Check my microphone" and stay quiet.');
  }
  async function calibrateNoiseFloor() {
    const resultEl = $('calibrateResult'), say = s => { if (resultEl) resultEl.textContent = s; };
    try { await openMic(); } catch (e) { say('The microphone was blocked, so it could not be checked.'); return; }
    const my = ++roomSeq, mine = ++manualSeq; // after openMic: the background check it may just have started is superseded
    say('Listening for 3 seconds — stay quiet…');
    let r; try { r = await listenRoom(3000); } catch (e) { if (mine === manualSeq) say(ROOM_ERROR); return; } // a stale check that threw must not overwrite a newer check's message
    if (mine !== manualSeq) return; // a newer manual check owns the message; never write 'interrupted' over it
    if (!r.fresh) { say('The check was interrupted because the microphone changed or stopped. Press "Check my microphone" to try again.'); return; }
    if (my !== roomSeq) return; // a newer manual check owns the message now
    const v = classifyRoomCheck(r.frames, { manual: true });
    if ('floor' in v) { storeRoomFloor(v.floor); say(roomQuietOrNoisy(v.floor)); }
    else say(v.abstain === 'unusable' ? ROOM_NO_READING : 'I heard playing during the check, so nothing was changed. Try again in silence.');
  }
  // VERIFIED DEFECT 4 (mic-gate-and-capture): the micDeviceSelect change
  // handler re-opened the mic and called wireAnalysers(src) again without
  // ever disconnecting the PREVIOUS source node -- switching input devices
  // left the old (now-stopped) stream's source node still wired into
  // anTime/anFreq/the worklet, piling up dead graph edges on every switch.
  // This is the one place every caller (openMic, testSource, testPluck)
  // routes a new source through, so disconnecting the old one here covers
  // all of them.
  function wireAnalysers(src) {
    if (lastAudioSource && lastAudioSource !== src) { if (lastAudioSource.__monoRouteInterval) clearInterval(lastAudioSource.__monoRouteInterval); try { lastAudioSource.disconnect(); } catch (e) {} }
    if (!anTime) { anTime = actx.createAnalyser(); anTime.fftSize = 4096; anFreq = actx.createAnalyser(); anFreq.fftSize = 8192; anFreq.smoothingTimeConstant = 0.5; }
    src.connect(anTime); src.connect(anFreq); lastAudioSource = src; if (pitchWorkletNode) src.connect(pitchWorkletNode);
  }
  // test hook: feed synthetic notes through the same listening chain
  function testSource(freqs) { ensureAudio(); testNodes.forEach(o => { try { o.stop(); } catch (e) {} }); testNodes = []; if (!freqs || !freqs.length) return; const mix = actx.createGain(); mix.gain.value = 0.5 / freqs.length; wireAnalysers(mix); micReady = true; ensurePitchWorklet(); freqs.forEach(f => [1, 2, 3].forEach(h => { const o = actx.createOscillator(), gg = actx.createGain(); o.frequency.value = f * h; gg.gain.value = 1 / (h * h); o.connect(gg); gg.connect(mix); o.start(); testNodes.push(o); })); }
  // test hook (F8): testSource() has no decay envelope, so it cannot express
  // a real pluck ringing out. testPluck(freq, attacksMs) schedules one real
  // exponentially-decaying attack per entry in attacksMs (offsets in ms from
  // now), through the same analyser/worklet chain as testSource, so a
  // characterization test can prove a same-pitch re-pluck re-fires while the
  // first attack is still ringing above the RMS 0.006 release floor.
  async function testPluck(freq, attacksMs) {
    ensureAudio(); testNodes.forEach(o => { try { o.stop(); } catch (e) {} }); testNodes = [];
    const mix = actx.createGain(); mix.gain.value = 1; wireAnalysers(mix); micReady = true;
    await ensurePitchWorklet(); // settle the worklet-vs-fallback race before scheduling test audio, not during it
    const startAt = now() + 0.05;
    (attacksMs && attacksMs.length ? attacksMs : [0]).forEach(ms => {
      const at = startAt + ms / 1000;
      [1, 2, 3].forEach(h => {
        const o = actx.createOscillator(), gg = actx.createGain();
        o.frequency.value = freq * h;
        gg.gain.setValueAtTime(0.0001, at);
        gg.gain.exponentialRampToValueAtTime(0.5 / (h * h), at + 0.005);
        gg.gain.exponentialRampToValueAtTime(0.0001, at + 3);
        o.connect(gg); gg.connect(mix); o.start(at); o.stop(at + 3.05); testNodes.push(o);
      });
    });
    return startAt;
  }
  // test hook: synthetic hits through the SAME analyser chain openMic()
  // uses (not drumHit()'s speaker-only synth, which never reaches the
  // classifier), so a characterization test can drive listenDrums() without
  // a real kit or a fixture WAV. hits is [{ kind, atMs }, ...]; kind is
  // 'kick' (low sine sweep, matching drum-classify.js's measured
  // low-dominant shape) or 'hihat' (highpassed noise, high-dominant). All
  // hits are scheduled in one call -- unlike testPluck/testSource, this does
  // NOT stop previously scheduled nodes first, so a whole bar's worth of
  // future hits can be queued without cutting off an earlier one still
  // waiting to fire. Returns each hit's audio-clock start time.
  async function testDrumHit(hits) {
    ensureAudio(); const mix = actx.createGain(); mix.gain.value = 1; wireAnalysers(mix); micReady = true;
    return hits.map(h => {
      const at = now() + (h.atMs || 0) / 1000, len = 0.05;
      if (h.kind === 'kick') { const o = actx.createOscillator(), v = actx.createGain(); o.frequency.setValueAtTime(120, at); o.frequency.exponentialRampToValueAtTime(50, at + len); v.gain.setValueAtTime(0.8, at); v.gain.exponentialRampToValueAtTime(0.0001, at + len); o.connect(v); v.connect(mix); o.start(at); o.stop(at + len + 0.02); testNodes.push(o); }
      else { const n = Math.ceil(actx.sampleRate * len), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; const src = actx.createBufferSource(); src.buffer = b; const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000; const v = actx.createGain(); v.gain.setValueAtTime(0.8, at); v.gain.exponentialRampToValueAtTime(0.0001, at + len); src.connect(hp); hp.connect(v); v.connect(mix); src.start(at); testNodes.push(src); }
      return at;
    });
  }

  // ---------- instruments: each is a curriculum plus a way of hearing you ----------
  // MODS (the trainer table) is built by src/instruments/mods.js; MODS.harp is added below.
  const MODS = buildMods();
  const MOD_IDS = Object.keys(MODS);
  // Instruments the notation engine (src/notation/) is wired into. Wind
  // already draws its own hand-built staff (drawStaff below); it is not
  // equivalent to the engine's output (task-row layout, live tuning gauge,
  // hold timer) so it is left alone rather than swapped.
  const NOTATE_MOD_IDS = ['kbd', 'gtr', 'bass', 'uke', 'voice'];
  const WIND_KINDS = { c: ['Concert pitch: flute, oboe, violin', 0, 'treble'], bb: ['B flat: trumpet, clarinet, soprano sax', -2, 'treble'], bbt: ['B flat, octave lower: tenor sax', -14, 'treble'], eb: ['E flat: alto sax', -9, 'treble'], ebb: ['E flat, octave lower: baritone sax', -21, 'treble'], f: ['F: French horn', -7, 'treble'], bc: ['Bass clef: trombone, euphonium, tuba', -19, 'bass'] };
  const VOICE_KINDS = { low: ['Lower voice (Do = C3)', 48], mid: ['Middle voice (Do = G3)', 55], high: ['Higher voice (Do = C4)', 60] };

  // K4: "Everything, faster (k)" anchors on the last level WITHOUT a `stage`
  // (level 15/16 carry one) so appending a staged level never re-anchors it.
  function levelDef(mod, L) { const T = MODS[mod].levels; if (L <= T.length) return T[L - 1]; const k = L - T.length, unstaged = T.filter(x => !x.stage), last = unstaged.length ? unstaged[unstaged.length - 1] : T[T.length - 1]; return { name: 'Everything, faster (' + k + ')', task: 'mix', limit: Math.max(2.5, (last.limit || 8) - 0.75 * k), bpm: Math.min(120, (last.bpm || 72) + 6 * k), fast: true }; }
  function activeItems(mod, L) { const T = MODS[mod].levels, out = []; for (let i = 0; i < Math.min(L, T.length); i++) (T[i].add || []).forEach(id => out.push(id)); return out; }
  // what an item id means
  let info = function (mod, id, prefs) {
    const M = MODS[mod], k = id[0], rest = id.slice(1);
    if (k === 'n') { const m = +rest; return { kind: 'note', midi: m, exact: true, label: nname(m) + (m < 60 ? ' (low)' : m >= 72 ? ' (high)' : ''), short: nname(m) }; }
    if (k === 'w') { const w = +rest, kind = WIND_KINDS[(M.windKind || prefs.wind || 'bb')] || WIND_KINDS.bb, wm = kind[2] === 'bass' ? w - 19 : w; return { kind: 'note', written: wm, midi: kind[2] === 'bass' ? wm : w + kind[1], clef: kind[2], label: nname(wm, true), short: nname(wm, true) }; }
    if (k === 's') { const mm = /^(\d+)f(\d+)$/.exec(rest), s = +mm[1], f = +mm[2], ns = M.tuning.length, m = M.tuning[ns - s] + f; return { kind: 'note', midi: m, string: s, fret: f, label: nname(m) + ': string ' + s + (f ? ', fret ' + f : ', open'), short: nname(m) + ' (string ' + s + ')' }; }
    if (k === 'p') { const p = +rest; return { kind: 'note', midi: 60 + p, anywhere: true, label: NAMES[p] + ', anywhere', short: NAMES[p] + ' by name' }; }
    if (k === 'c') return { kind: 'chord', pcs: CHORDS[rest], label: CHORD_NAMES[rest], short: CHORD_NAMES[rest], sym: rest };
    if (k === 'v') { const d = +rest, VKv = Object.assign({}, VOICE_KINDS, prefs.voiceRange ? { mine: ['My range (found by test)', tonicFromRange(exerciseRangeFor(prefs.voiceRange)).tonic] } : {}), base = (VKv[prefs.voice || 'low'] || VKv.low)[1]; return { kind: 'note', midi: base + d, degree: d, tonic: base, label: (SOLFA[d] || nname(base + d)) + ' (' + nname(base + d) + ')', short: SOLFA[d] || nname(base + d) }; }
    if (k === 'i') { const mm = /^(\d+)([adh])$/.exec(rest), semi = +mm[1], dir = mm[2]; return { kind: 'interval', semi: semi, dir: dir, label: INTERVALS[semi], short: INTERVALS[semi] + (dir === 'd' ? ' down' : dir === 'h' ? ' together' : '') }; }
    if (k === 'q') return { kind: 'quality', pcs: QUALS[rest][1], label: QUALS[rest][0], short: QUALS[rest][0] };
    if (k === 'r') return { kind: 'cell', cell: rest, beats: CELLS[rest].b, on: CELLS[rest].on, label: CELLS[rest].say, short: CELLS[rest].say };
    return { kind: 'note', midi: 60, label: id, short: id };
  };
  let validId = function (mod, id) { try { if (typeof id !== 'string' || id.length > 10) return false; if (id === 'bar2' || id === 'kit') return true; const k = id[0], r = id.slice(1); if (k === 'n' || k === 'w' || k === 'p' || k === 'v') return /^\d{1,3}$/.test(r); if (k === 's') return /^\d+f\d+$/.test(r) && MODS[mod].tuning && +r.split('f')[0] <= MODS[mod].tuning.length && +r.split('f')[0] >= 1; if (k === 'c') return !!CHORDS[r]; if (k === 'i') return /^\d{1,2}[adh]$/.test(r) && !!INTERVALS[parseInt(r, 10)]; if (k === 'q') return !!QUALS[r]; if (k === 'r') return !!CELLS[r]; return false; } catch (e) { return false; } };

  // ---------- harmonica (10-hole diatonic, any of the 12 keys) and the two tools ----------
  const H = (...xs) => xs.map(x => 'h' + x);
  // Bend ids: 'y' + hole + 'x' + semitonesBent, e.g. 'y3x2' = hole 3 bent down
  // two semitones. Bend availability (which holes bend, how deep) is
  // key-invariant -- transposing the whole harp preserves the blow/draw gap
  // in every hole -- so it is computed once from the C layout and reused by
  // validId() for any key the learner picks.
  const HY = (...xs) => xs.map(x => 'y' + x);
  const HARP_BEND_DEPTHS = harpLayoutFor(0).map(hole => hole.bends.map(b => b.semitonesBent));
  // The 12 key choices for the selector, in schema.js tonic order (0 = C).
  const HARP_KEY_OPTS = NAMES.reduce((o, n, i) => { o[i] = [n + ' harmonica']; return o; }, {});
  // fmin/fmax are getters, not fixed numbers: a harmonica in a low or high
  // key sounds a different absolute pitch range than a C harp, and a stale
  // C-only search window would make the microphone mishear (or miss
  // entirely) a real hole on any other key. Computed from the CHOSEN key's
  // own layout (src/audio/range.js's margin/rounding), so the window is
  // always honest about what this harp, in this key, actually sounds.
  const harpRangeFor = key => { const holes = harpLayoutFor(key); let lo = holes[0].blow, hi = holes[0].blow; holes.forEach(hole => { lo = Math.min(lo, hole.blow, hole.draw); hi = Math.max(hi, hole.blow, hole.draw); }); return rangeForInstrument({ range: { low: lo, high: hi } }); };
  MODS.harp = { name: 'Harmonica', tag: 'microphone', color: '#ff8fb8', input: 'sustain', exactPitch: true,
    get fmin() { return harpRangeFor((DB && DB.prefs && DB.prefs.harpKey) || 0).fmin; },
    get fmax() { return harpRangeFor((DB && DB.prefs && DB.prefs.harpKey) || 0).fmax; },
    help: 'Harmonica: for a 10-hole diatonic harmonica in any of the 12 keys -- pick your harmonica’s key below to match the one printed on it. Press Connect to let the page listen. Arrows pointing up mean blow, arrows pointing down mean draw. Aim for one clean hole at a time; if two holes sound together the page may not recognise the note. Later levels ask for bends: a draw or blow reed pulled down in pitch with your breath.',
    levels: [
      { name: 'Blow holes 4, 5 and 6', add: H('b4', 'b5', 'b6'), limit: 12 }, { name: 'Draw holes 4, 5 and 6', add: H('d4', 'd5', 'd6'), limit: 12 }, { name: 'Moves: blow to draw', task: 'seq', len: 2, limit: 10 },
      { name: 'Hole 7 completes the scale', add: H('d7', 'b7'), limit: 12 }, { name: 'Scale runs of three', task: 'seq', len: 3, limit: 9 }, { name: 'The low end: holes 1 to 3', add: H('b1', 'd1', 'b2', 'd2', 'b3', 'd3'), limit: 12 },
      { name: 'The top end: holes 8 to 10', add: H('b8', 'd8', 'b9', 'd9', 'b10', 'd10'), limit: 12 }, { name: 'Long tones: two steady seconds', task: 'hold', limit: 14 }, { name: 'Runs of four', task: 'seq', len: 4, limit: 8 },
      { name: 'Easy bends: one semitone down', add: HY('1x1', '2x1', '3x1', '4x1', '6x1', '8x1', '9x1', '10x1'), limit: 16 }, { name: 'Moderate bends: two semitones down', add: HY('2x2', '3x2', '10x2'), limit: 12 }, { name: 'The deepest bend: hole 3, three semitones down', add: HY('3x3'), limit: 8 }
    ] };
  MOD_IDS.push('harp');
  const TOOLS = {
    tuner: { name: 'Tuner', tag: 'tool', color: '#93a0bd', help: 'Tuner: press Set up input, then Connect microphone, pick your instrument, and play one open string at a time. The needle shows how far off you are; the string turns green when it has been in tune for a moment. Click a string to hear the note it should be.' },
    capture: { name: 'Capture a melody', tag: 'tool', color: '#93a0bd', help: 'Capture: press Set up input, then Connect microphone, then Listen, and play, sing, hum or whistle a tune, or hold the microphone to a recording of one instrument playing one note at a time. It writes down the notes it hears, and you can turn them into a lesson on any instrument here. It hears one note at a time: it cannot pull separate parts out of a full band recording.' }
  };
  // 'ear' and 'rhy' are the two pseudo-mods declared above alongside MODS
  // (see the comment at MODS.ear/MODS.rhy) -- they run through the same
  // session/level machinery as a real instrument, so they stay in MODS/
  // MOD_IDS untouched, but the picker groups them with TOOLS below because
  // to a learner they read as "a tool", not "an instrument to pick up".
  const TOOL_MOD_IDS = ['ear', 'rhy'];
  // P2b-3: the three feature panels (src/ui/panels.js) that read as small
  // reference/quick-drill tools rather than a whole practice screen of their
  // own -- Ear training (the eight-exercise panel, not MODS.ear above),
  // How to play it, Music theory -- get their plain home in the SAME
  // instrument-sheet Tools group as Tuner/Capture a melody/Interval drill/
  // Rhythm, via buildPanelToolButton() in buildPicker() below, rather than a
  // second disclosure of their own.
  const PANEL_TOOL_IDS = ['ear', 'fingerings', 'theory'];
  // U2/U-parent: keyed variant id -> parent id, for the same-instrument
  // groupings the picker collapses under one parent (buildPicker()/setMod()
  // below). Two sources feed it: a hand-declared pair for the two families
  // that predate the `parent` field (bass-5-string/ukulele-low-g/baritone --
  // nothing else in the codebase records "is a variant of": MODS' own
  // 'name'/'tag' fields and the instruments registry's 'family' field,
  // src/instruments/*.js, both describe a broader instrument category, e.g.
  // 'fretted', not this), and any MODS entry that names its own parent with
  // a `parent: '<mod id>'` field, so a newly-added instrument joins an
  // existing family by adding that one field to its own MODS entry rather
  // than a second edit here. A `parent` naming a mod id that does not exist,
  // or naming itself, is ignored (falls back to top-level) rather than
  // corrupting the picker. Every id, hand-declared or `parent`-derived,
  // keeps its own MODS entry and its own DB.mods[id] progress untouched --
  // grouping is purely visual.
  function variantParentsFrom(mods, staticPairs) { const out = Object.assign({}, staticPairs); Object.keys(mods).forEach(id => { const p = mods[id] && mods[id].parent; if (p && p !== id && mods[p]) out[id] = p; }); return out; }
  const VARIANT_PARENTS = variantParentsFrom(MODS, { 'bass-5-string': 'bass', 'ukulele-low-g': 'uke', 'ukulele-baritone': 'uke' });
  const TUNINGS = { gtr: ['Guitar', [40, 45, 50, 55, 59, 64]], bass: ['Bass', [28, 33, 38, 43]], uke: ['Ukulele', [67, 60, 64, 69]], vln: ['Violin', [55, 62, 69, 76]], chrom: ['Any note (chromatic)', []] };
  const _info = info, _valid = validId;
  info = function (m, id, prefs) { const hk = (prefs && Number.isInteger(prefs.harpKey) && prefs.harpKey >= 0 && prefs.harpKey <= 11) ? prefs.harpKey : 0; if (id[0] === 'h') { const mm = /^h([bd])(\d+)$/.exec(id), dir = mm[1], hole = +mm[2], layout = harpLayoutFor(hk), midi = layout[hole - 1][dir === 'b' ? 'blow' : 'draw']; return { kind: 'note', midi: midi, hole: hole, dir: dir, note: nname(midi), label: (dir === 'b' ? 'Blow ' : 'Draw ') + hole + ' (' + nname(midi) + ')', short: (dir === 'b' ? 'Blow ' : 'Draw ') + hole }; } if (id[0] === 'y') { const mm = /^y(\d+)x(\d)$/.exec(id), hole = +mm[1], depth = +mm[2], layout = harpLayoutFor(hk), b = layout[hole - 1].bends.find(x => x.semitonesBent === depth), dir = b.action === 'draw' ? 'd' : 'b'; return { kind: 'note', midi: b.pitch, hole: hole, dir: dir, bend: depth, note: nname(b.pitch), label: (dir === 'b' ? 'Blow ' : 'Draw ') + hole + ' bent ' + depth + (depth === 1 ? ' semitone' : ' semitones') + ' (' + nname(b.pitch) + ')', short: (dir === 'b' ? 'Blow ' : 'Draw ') + hole + ' ↓' + depth }; } return _info(m, id, prefs); };
  validId = function (m, id) { if (typeof id === 'string' && id[0] === 'h') return /^h[bd]([1-9]|10)$/.test(id); if (typeof id === 'string' && id[0] === 'y') { const mm = /^y([1-9]|10)x([1-3])$/.exec(id); return !!mm && HARP_BEND_DEPTHS[+mm[1] - 1].indexOf(+mm[2]) >= 0; } return _valid(m, id); };
  const _info2 = info, _valid2 = validId;
  info = function (m, id, prefs) { if (typeof id === 'string' && id[0] === 'j' && handsTogetherById(id)) { const ex0 = handsTogetherById(id), nm = nname(ex0.oldRh ? ex0.oldRh.midi : ex0.rh.midi), ex = Object.assign({}, ex0, { name: nm, label: nm + ex0.label.slice(ex0.name.length), short: nm + ex0.short.slice(ex0.name.length) }); // names follow Settings > Note names; the start note, each exercise keeps its own suffix
    const timed = isTimedPairId(id), stage = handsStageFromId(id); const label = stage === 'held' ? ex.label + ', bass held' : stage === 'split' ? ex.label + ', different rhythms' : stage === 'position' ? ex.label : ex.label + (timed ? ', in time' : ''); const short = stage === 'held' ? ex.name + ' (left hand holds)' : stage === 'split' ? ex.name + ' (different rhythms)' : stage === 'position' ? ex.short : timed ? ex.name + ' (both hands, in time)' : ex.short; return { kind: 'hands-together', ex: ex, label: label, short: short, timed: timed }; } return _info2(m, id, prefs); };
  validId = function (m, id) { if (typeof id === 'string' && id[0] === 'j') return !!handsTogetherById(id); return _valid2(m, id); };
  // Bowed instruments (violin, viola, cello, double-bass) reuse the 's'
  // string+fret item id scheme (stringLevels above) so the fingerings panel
  // and drawFret's dot placement keep working unchanged, but they have no
  // frets: the label the base info() built at :502 ("string 1, fret 3")
  // would be a false claim of a fret the player cannot feel. Rewrites the
  // label/short for any MODS[m].fretless mod's 's' item to name a plain
  // position (semitones above the open string) instead -- see the honest
  // wording in hintFor and the "time's up" text below for the same reason.
  const _info3 = info, _valid3 = validId;
  info = function (m, id, prefs) { const r = _info3(m, id, prefs); if (r && r.kind === 'note' && r.string !== undefined && MODS[m] && MODS[m].fretless) { const pos = r.fret ? r.fret + ' semitone' + (r.fret > 1 ? 's' : '') + ' up' : 'open'; return Object.assign({}, r, { label: nname(r.midi) + ': string ' + r.string + ', ' + pos, short: nname(r.midi) + ' (string ' + r.string + ')' }); } return r; };
  validId = _valid3;
  // turn a heard note into an item this instrument can practise. Delegates
  // to src/ui/songs/mastery.js's itemIdForMidi -- the "capture a melody"
  // path and a song's mastery crediting must credit the identical item id
  // for the same (instrument, midi, prefs), so there is one source of
  // truth for the mapping rather than two hand-typed copies of it (see
  // tests/unit/w-songs-mastery.test.mjs's "customItem agrees with
  // itemIdForMidi" check).
  function customItem(m, midi, prefs) {
    return itemIdForMidi(m, midi, prefs);
  }
  // Whether a captured melody can be practised on mod `m` at all: probes
  // customItem() with a real note from the instrument's own registry range
  // (falling back to 60 for the two pseudo-mods, 'ear' and 'rhy', that have
  // no registry record and no capture scheme) instead of hand-typing a
  // second copy of the ready-instrument id list next to customItem's own.
  // A mod this returns true for gets an id for every note in its range
  // (see tests/unit/w-songs-mastery.test.mjs's "every ready record maps"
  // check) except harp, which is diatonic and still maps plenty of notes.
  function hasMasteryScheme(mod) {
    if (MODS[mod] && MODS[mod].kit) return false; // a captured melody has no drums in it
    const probe = instrumentById[mod] ? instrumentById[mod].range.low : 60;
    return customItem(mod, probe, DB.prefs) !== null;
  }

  // ---------- saved state: one learner model per instrument, shared session log ----------
  const KEY = 'bandcoach.v1';
  // Read once at startup, not on every export: the build (build/build.mjs)
  // stamps the real package.json version into this meta tag's content
  // attribute; an unbuilt dev page leaves it empty, and resolveAppVersion()
  // turns that into DEV_VERSION so an exported progress file never claims a
  // release version it isn't.
  const versionMeta = document.querySelector('meta[name="band-coach-version"]');
  const APP_VERSION = resolveAppVersion(versionMeta && versionMeta.content);
  const BACKUP_AT_KEY = 'bandcoach.v1.backupAt';
  let lastBackupAt = 0; try { lastBackupAt = +localStorage.getItem(BACKUP_AT_KEY) || 0; } catch (e) {}
  let DB, mod = 'kbd', S = null;
  // U5: whether a REAL prior choice exists, sampled from the raw saved
  // prefs in loadDB() before sanitizeDB's 'kbd' default papers over "nothing
  // saved yet" -- sanitizeDB always writes SOME mod, so reading DB.prefs.mod
  // after it runs can never tell a genuine returning learner apart from a
  // brand-new profile. A saved TOOL id (Tuner, Ear training, ...) does not
  // count: this only tracks whether an INSTRUMENT was ever chosen. Drives
  // whether #picker (now the nav Instrument button's chooser sheet, see
  // pickerAsSheet below) starts shut or open.
  // A saved VARIANT id (e.g. 'ukulele-low-g') does not count either: U2
  // already gives a saved variant its own always-open family disclosure so
  // it stays directly reachable, and shutting the whole sheet on top of
  // that would hide it two levels deep behind two different controls.
  let hasSavedMod = false;
  // P2b-1: once true, #picker behaves as a sheet that shuts itself after
  // every instrument pick, not just the always-visible first-run list. It
  // starts equal to hasSavedMod (a returning learner's sheet is already
  // shut) and flips permanently true the moment a first-time visitor makes
  // their first choice -- from then on picking an instrument always closes
  // the sheet again, same as any returning learner reopening it to switch.
  let pickerAsSheet = false;
  // Frozen once per page load (loadDB()) / import, never re-sampled during
  // play: every retrievability/review computation for the life of this tab
  // uses this single value, so choice never depends on how much real wall
  // time a script takes to run (see tests/characterization/determinism.test.mjs).
  // A page that stays open for days only sees fresh decay on its next load,
  // matching the old flat model's forget()-at-load-only behaviour exactly.
  let modelNow = Date.now();
  // Moves modelNow forward to the real current time, WITHOUT re-sanitizing
  // DB (loadDB() already did that once, at boot, and re-running it here
  // would be wasted work every session start). Called at two moments the
  // page can have sat idle since modelNow was last set: the top of
  // startSession(), so pressing Start after the tab has been open a while
  // picks up items that became due meanwhile; and on visibilitychange
  // becoming visible, so a backgrounded-then-resumed tab does not need a
  // reload either. See the comment on modelNow above for why every `now`
  // the SRS sees otherwise stays frozen per page load.
  function refreshModelClock() { modelNow = Date.now(); }
  const num = (x, d, lo, hi) => { x = +x; if (!isFinite(x)) x = d; return clamp(x, lo, hi); };
  const freshModel = () => ({ level: 1, ready: 0.2, item: {}, trans: {}, conf: {}, gain: 0.05, gate: 0.6, offset: 0, acc: {}, cr: {}, tick: 0, judged: 0, promo: { at: -999, level: 0 }, fast: 0, grooveBpm: 80 });
  // Converts a raw stored record (either the OLD flat-mastery shape
  // { m, n, last } or an already-new-shape { stability, difficulty,
  // lastSeen, reps, lapses }) into the new shape, via migrateItem() when it
  // is still the old shape (or corrupt/partial, which migrateItem is
  // already defensive against). `defaultM` lets a transition ('trans')
  // record keep its own old default (0.5) distinct from an item's (0.4)
  // when the stored `.m` itself is missing.
  function toNewItem(raw, defaultM, modelNow) {
    if (raw && typeof raw.stability === 'number') return raw;
    const o = raw || {};
    return migrateItem({ m: typeof o.m === 'number' ? o.m : defaultM, n: o.n, last: o.last }, modelNow);
  }
  function sanitizeModel(m, v, modelNow) {
    const s = freshModel(); if (!v || typeof v !== 'object') return s;
    s.level = Math.floor(num(v.level, 1, 1, 80)); s.ready = num(v.ready, 0.2, 0, 1); s.gain = num(v.gain, 0.05, 0.025, 0.09); s.gate = num(v.gate, 0.6, 0.6, 0.75); s.offset = num(v.offset, 0, -0.15, 0.15);
    s.tick = Math.floor(num(v.tick, 0, 0, 1e9)); s.judged = Math.floor(num(v.judged, 0, 0, 1e9)); s.fast = Math.floor(num(v.fast, 0, 0, 3)); if (v.promo) s.promo = { at: num(v.promo.at, -999, -999, 1e9), level: num(v.promo.level, 0, 0, 99) };
    s.grooveBpm = Math.round(num(v.grooveBpm, 80, 50, 168));
    Object.keys(v.item || {}).forEach(id => { const raw = v.item[id]; if (validId(m, id) && raw) { const base = toNewItem(raw, 0.4, modelNow); s.item[id] = { stability: num(base.stability, DEFAULT_STABILITY_DAYS, MIN_STABILITY_DAYS, MAX_STABILITY_DAYS), difficulty: num(base.difficulty, 0.3, 0, 1), lastSeen: num(base.lastSeen, modelNow, 0, 1e15), reps: Math.floor(num(base.reps, 0, 0, 1e7)), lapses: Math.floor(num(base.lapses, 0, 0, 1e7)), seen: Math.floor(num(raw.seen, 0, 0, 1e9)) }; } });
    Object.keys(v.trans || {}).forEach(k => { const ab = k.split('>'), raw = v.trans[k]; if (ab.length === 2 && validId(m, ab[0]) && validId(m, ab[1]) && raw) { const base = toNewItem(raw, 0.5, modelNow); s.trans[k] = { stability: num(base.stability, DEFAULT_STABILITY_DAYS, MIN_STABILITY_DAYS, MAX_STABILITY_DAYS), difficulty: num(base.difficulty, 0.3, 0, 1), lastSeen: num(base.lastSeen, modelNow, 0, 1e15), reps: Math.floor(num(base.reps, 0, 0, 1e7)), lapses: Math.floor(num(base.lapses, 0, 0, 1e7)) }; } });
    Object.keys(v.conf || {}).forEach(k => { if (k.length < 40) s.conf[k] = Math.floor(num(v.conf[k], 0, 0, 1e6)); });
    Object.keys(v.acc || {}).forEach(k => { s.acc[k] = num(v.acc[k], 0, 0, 3); }); Object.keys(v.cr || {}).forEach(k => { if (validId(m, k)) s.cr[k] = num(v.cr[k], 0, -80, 80); });
    return s;
  }
  // sanitizeDB (src/core/sanitize-db.js, with repairEventClocks): the pure gate between a stored or restored profile and the app; the tables it checks against come in here.
  function sanitizeDB(v, defaultLatencyMs, modelNow) { return sanitizeDBCore(v, defaultLatencyMs, modelNow, { MODS, MOD_IDS, WIND_KINDS, VOICE_KINDS, LOCALES, NOTATE_MOD_IDS, sanitizeModel, sanitizePanelData, skillMap: KBD_SONG_SKILL_MAP }); }
  // The exact string this page last read from or wrote to storage. flushSave()
  // compares against it so a page going away never clobbers a newer write made
  // by someone else in the meantime (another tab, a restored backup).
  let lastStored = null;
  // A missing/never-saved key is safeGet's ok:true, value:null -- migrateDB
  // handles null the same as it always has. `corrupt` (JSON.parse failed on
  // something that WAS there) also falls back to a fresh profile: the raw
  // text safeGet already preserved under KEY+'.corrupt' is this app's only
  // shot at ever recovering it, but that recovery is future work -- today
  // this is no worse than the old behaviour (sanitizeDB always papered over
  // a corrupt record with a fresh one), except the evidence now survives.
  function loadDB() { modelNow = Date.now(); const got = safeGet(localStorage, KEY); lastStored = (got.ok && !got.corrupt && got.value !== null) ? JSON.stringify(got.value) : null; const v = (got.ok && !got.corrupt) ? migrateDB(got.value) : null; hasSavedMod = !!(v && v.prefs && MODS[v.prefs.mod] && TOOL_MOD_IDS.indexOf(v.prefs.mod) < 0); DB = sanitizeDB(v, actx ? (actx.outputLatency || actx.baseLatency || 0) * 1000 : 0, modelNow); mod = DB.prefs.mod; S = DB.mods[mod]; gates = gatesFor(DB.prefs.noiseFloor); setNoteNaming(DB.prefs.noteNaming); }
  let saveTimer = null;
  // Tracks only whether #settingsSay currently shows OUR failed-save
  // message, so a successful save clears exactly that message and never an
  // unrelated one coach() (src/app.js) put there moments earlier (e.g. a
  // "Backup saved" line while Settings happens to be open).
  let saveFailedShown = false;
  // Verified: setItem not throwing is not proof of a save, since a store can
  // also accept the call and silently keep something else -- safeSet reads
  // its own write back before reporting ok:true (see src/core/storage.js).
  // A failure surfaces as a persistent, plain-language line in the existing
  // #settingsSay role="status" region AND in #mainSay, the twin region on
  // the main practice screen (src/index.html) -- Settings is a panel a
  // learner may never open, so #settingsSay alone left anyone practising on
  // the main screen believing an unsaved answer was kept. Both are cleared
  // the moment a later save actually lands. lastStored (flushSave's "did
  // someone else change storage under us" guard) is only advanced on a
  // VERIFIED write -- advancing it on a failed attempt would make flushSave
  // believe a write it never made had already landed, and silently skip
  // every retry after it.
  function writeDB() {
    if (MODS[mod]) DB.mods[mod] = S = sanitizeModel(mod, S, modelNow);
    const candidate = JSON.stringify(DB);
    const result = safeSet(localStorage, KEY, candidate);
    if (result.ok) { lastStored = candidate; if (saveFailedShown) { saveFailedShown = false; $('settingsSay').textContent = ''; $('mainSay').textContent = ''; } }
    else { saveFailedShown = true; $('settingsSay').textContent = t('storage.saveFailed'); $('mainSay').textContent = t('storage.saveFailed'); }
    return result.ok;
  }
  function save() { if (saveTimer) return; saveTimer = setTimeout(() => { saveTimer = null; writeDB(); }, 1200); }
  // Closing or reloading within the 1200ms debounce window used to lose
  // whatever save() just queued -- nothing ever flushed it early. pagehide
  // fires on tab close, navigation and reload alike; visibilitychange with
  // document.hidden also catches a learner switching tabs/apps without
  // closing this one, which pagehide alone would miss.
  // Skipped when storage no longer holds what this page last saw: the newer
  // write wins, exactly as it would have had the debounce been cancelled.
  function flushSave() { if (!saveTimer) return; let cur; try { cur = localStorage.getItem(KEY); } catch (e) { return; } if (cur !== lastStored) return; clearTimeout(saveTimer); saveTimer = null; writeDB(); }
  window.addEventListener('pagehide', flushSave);
  // `now` is always the caller's `modelNow` (frozen per page load/import,
  // never Date.now() read live) — see the comment on `modelNow` above.
  const it = (id, now) => S.item[id] || (S.item[id] = Object.assign(migrateItem({ m: 0.4 }, now), { seen: 0 }));
  const tr = (a, b, now) => { const k = a + '>' + b; return S.trans[k] || (S.trans[k] = migrateItem({ m: 0.5 }, now)); };
  const GRADE_FOR_Q = q => !(q > 0) ? GRADE.LAPSE : q < 0.75 ? GRADE.HARD : q < 0.95 ? GRADE.GOOD : GRADE.EASY;
  const gate = (name, prob) => { const a = (S.acc[name] || 0) + prob; if (a >= 1) { S.acc[name] = a - 1; return true; } S.acc[name] = a; return false; };
  const D = () => levelDef(mod, S.level);
  const inf = id => info(mod, id, DB.prefs);

  // ---------- deterministic choice: smooth weighted round-robin over need scores ----------
  function poolFor(d) { const act = activeItems(mod, S.level); let p = d.pool; if (!p) { if (d.task === 'chord') p = 'c'; } let out = p ? act.filter(id => id[0] === p) : act.filter(id => id[0] !== 'c' && id[0] !== 'p'); if (d.sfx) out = out.filter(id => id.slice(-1) === d.sfx); if (!out.length) out = act; return out; }
  function weight(id, from, now) { const o = it(id, now), r = retrievability(o, now); let w = 0.15 + 0.6 * (1 - r) + 0.3 * Math.min(1, (S.tick - o.seen) / 40); if (from) w += 0.7 * (1 - retrievability(tr(from, id, now), now)); if (id === from) w *= 0.2; return w; }
  function pick(from, pool, now) { let tot = 0, best = null; pool.forEach(id => { const w = weight(id, from, now); tot += w; S.cr[id] = (S.cr[id] || 0) + w; if (best === null || S.cr[id] > S.cr[best] + 1e-9) best = id; }); S.cr[best] -= tot; return best; }
  const byStrength = (pool, now) => pool.slice().sort((a, c) => (retrievability(it(c, now), now) - retrievability(it(a, now), now)) || (a < c ? -1 : 1));

  // ---------- session monitor: fatigue, frustration, breaks ----------
  let sess = null, playing = false, paused = false, pauseInfo = null, task = null, lastItem = null, recent = [], streak = 0, errCount = 0, lastInputAt = 0, nextTaskAt = 0, sessionPlan = [], planProgress = { review: 0, weak: 0, apply: 0, check: 0 };
  const newSession = () => ({ mod: mod, active: 0, sinceBreak: 0, judged: 0, ok: 0, first: [], last: [], w30: [], best30: 0, rts: [], bestRt: null, downs: 0, breaks: 0, failRun: 0, reliefIn: 0, warm: 0, tiredFor: 0, snoozeUntil: 0, from: S.level, bestStreak: 0, F: 0, m0: JSON.parse(JSON.stringify(S.item)), capWarned: false, target: 0, cal: [], idleBars: 0 });
  function fatigue() {
    const acc30 = sess.w30.length >= 24 ? mean(sess.w30) : null; if (acc30 !== null) sess.best30 = Math.max(sess.best30, acc30);
    const rt = sess.rts.length >= 10 ? median(sess.rts) : null; if (rt !== null) sess.bestRt = sess.bestRt === null ? rt : Math.min(sess.bestRt, rt);
    const drop = acc30 === null ? 0 : c01((sess.best30 - acc30) / 0.25), slow = (rt === null || !sess.bestRt) ? 0 : c01((rt / Math.max(0.4, sess.bestRt) - 1.15) / 0.6);
    sess.F = 0.45 * drop + 0.25 * slow + 0.2 * c01((sess.sinceBreak / 60 - 12) / 18) + 0.1 * c01(sess.downs / 3); return sess.F;
  }
  // K2: patches the Hands selector's Both option (and its lock note) open in
  // place, the instant bothUnlocked() actually flips inside credit() below
  // -- never a full renderOpts() rebuild, so a mid-change select never
  // steals its own focus.
  function flipBothUnlockIfNeeded() { const o = document.querySelector('#optKbdHands option[value="both"]'); if (o) o.disabled = false; const lk = $('kbdBothLock'); if (lk) lk.remove(); if (DB.prefs.kbdHands === 'both') $('optKbdHands').value = 'both'; }
  function credit(id, q, from, warm, rt, outcome) {
    // A warm-up task is told "does not count" (see the hint text set at task
    // render: `t.warm ? 'Warm-up, does not count. ' : ''`, and the startSession()
    // coach message "First a short warm-up through what you know; it does not
    // count."), so it must not touch the spaced-repetition model either: no
    // S.item/S.trans write, and no S.judged/S.ready/session counters below.
    if (warm) return;
    const out = outcome || gradeOutcome({ helped: false, assistance: null, q: q });
    // A helped element (Show me) is not a test: no review, no streak, no
    // level move, no judged count -- only the session's help counter moves.
    // See src/core/grade-outcome.js. Neither does it advance bothUnlocked():
    // a Show me pass is not evidence the hand was actually played.
    if (!out.review) { sess.helped = (sess.helped || 0) + 1; return; }
    // K2: capture whether Both is still locked BEFORE this element's review
    // is written below -- bothUnlocked() now reads reps, which review() is
    // what actually sets, so this is the earliest point a level-13 hands
    // element's grading can flip it from locked to unlocked.
    const wasHandsLocked = mod === 'kbd' && D().task === 'hands' && !D().timed && !bothUnlocked(S);
    recent.push(q > 0 ? 1 : 0); if (recent.length > 20) recent.shift(); streak = q > 0 ? streak + 1 : 0;
    const grade = GRADE_FOR_Q(q), before = it(id, modelNow);
    S.item[id] = Object.assign({ seen: before.seen }, review(before, { grade, now: modelNow }));
    if (wasHandsLocked && bothUnlocked(S)) flipBothUnlockIfNeeded();
    if (from && from !== id) S.trans[from + '>' + id] = review(tr(from, id, modelNow), { grade, now: modelNow });
    S.judged++; if (out.level) S.ready = clamp(S.ready + (q > 0 ? S.gain * q : -0.08), 0, 1);
    sess.judged++; if (q > 0) sess.ok++; if (sess.first.length < 30) sess.first.push(q > 0 ? 1 : 0); sess.last.push(q > 0 ? 1 : 0); if (sess.last.length > 30) sess.last.shift();
    sess.w30.push(q > 0 ? 1 : 0); if (sess.w30.length > 30) sess.w30.shift(); sess.bestStreak = Math.max(sess.bestStreak, streak);
    if (q > 0 && rt) { sess.rts.push(rt); if (sess.rts.length > 14) sess.rts.shift(); }
    sess.failRun = q > 0 ? 0 : sess.failRun + 1; if (sess.reliefIn > 0) sess.reliefIn--;
    if (sess.failRun >= 5 && sess.reliefIn === 0) { sess.failRun = 0; sess.reliefIn = 40; sess.warm = 4; coach('Rough patch. The next four are ones you know well, to reset. They do not count against you.'); }
    const F = fatigue(); sess.tiredFor = F >= 0.6 ? sess.tiredFor + 1 : Math.max(0, sess.tiredFor - 1);
    if (F >= 0.6) S.ready = Math.max(S.ready, 0.05);
    evaluate();
    if (sess.tiredFor >= 12 && sess.active > 240 && Date.now() > sess.snoozeUntil) takeBreak('tired');
  }
  function evaluate() {
    if (S.ready >= 1) {
      let hold = null, holdR = 1; poolFor(D()).forEach(id => { const o = it(id, modelNow), r = retrievability(o, modelNow); if ((o.reps < 2 || r < S.gate) && (!hold || r < holdR)) { hold = id; holdR = r; } });
      if (hold) { S.ready = 1; coach('Holding at this level: ' + inf(hold).short + ' is at ' + Math.round(holdR * 100) + '%. It needs ' + Math.round(S.gate * 100) + '% before we move on, so expect more of it.'); }
      else {
        const clean = recent.length >= 12 && mean(recent) >= 0.95; S.fast = clean ? S.fast + 1 : 0; let note = '';
        if (S.fast >= 3) { S.gain = Math.min(0.09, S.gain * 1.15); S.fast = 0; note = ' You keep clearing levels cleanly, so I am speeding up the pace.'; }
        S.promo = { at: S.judged, level: S.level + 1 }; S.level++; S.ready = 0.2; const d = D();
        coach('Level up. Next: ' + d.name + '.' + (d.add ? ' New: ' + d.add.map(id => inf(id).short).join(', ') + '.' : '') + note);
        // B(C11a): a level move can put the kbd hand-off button in or out of
        // view (songFor(S.level) reads the new level), and renderOpts is
        // otherwise only called from setMod/tool buttons -- without this a
        // player who levels up mid-session would not see it until their next
        // instrument switch or reload.
        if (mod === 'kbd') renderOpts();
      }
    } else if (S.ready <= 0 && S.level > 1) {
      const tooSoon = S.promo.level === S.level && S.judged - S.promo.at < 40 && sess.F < 0.5; S.level--; S.ready = 0.5; sess.downs++; S.fast = 0;
      if (tooSoon) { S.gain = Math.max(0.025, S.gain * 0.85); S.gate = Math.min(0.75, S.gate + 0.05); coach('I moved you up too soon, so that is on me. Back to level ' + S.level + ', and from now on I will ask for ' + Math.round(S.gate * 100) + '% on everything before moving up.'); }
      else coach('Stepping back to level ' + S.level + ' to rebuild. That is normal; it comes back faster the second time.');
      if (mod === 'kbd') renderOpts();
    }
  }

  // ---------- building the next exercise ----------
  function mixKind() { const kinds = []; MODS[mod].levels.forEach(l => { const t = l.task || 'one'; if (kinds.indexOf(t) < 0) kinds.push(t); }); S.acc.mix = ((S.acc.mix || 0) + 1) % kinds.length; return kinds[S.acc.mix]; }
  function resolveTaskKind(d) {
    let kind = d.task || 'one', warm = false, pool;
    if (kind === 'mix') { kind = mixKind(); }
    const dd = Object.assign({}, d, { task: kind }); if (d.task === 'mix') { if (kind === 'chord') dd.pool = 'c'; if (kind === 'hands') dd.pool = 'j'; if (kind === 'seq' && !dd.len) dd.len = 3; }
    pool = poolFor(dd);
    // B1(4): for a dedicated 'hands' task, suffix the pool to the current
    // mode ('j1r'/'j1l') so a right/left-only pass credits its own id, never
    // the shared 'j1' both-hands id. (Level 17+'s mixed 'seq'/'one' pools can
    // still hand out a plain 'j<n>' id here -- that element is always graded
    // as both-hands, by id, wherever it is graded; see handsModeFromId.) K2:
    // a dedicated 'hands' task also runs through effectiveHands(), which
    // gates a saved 'both' preference down to 'right' until bothUnlocked()
    // -- each hand alone actually PLAYED (a graded attempt) at least once --
    // says the level 13 drill may run both hands together; the raw
    // preference itself is never rewritten. The live flip itself now lives
    // in credit() (see flipBothUnlockIfNeeded), fired exactly when that
    // grading happens, not here at task-build time.
    // K3: level 14 (d.timed) is its own dedicated 'hands' task, but the
    // Hands selector's lock/gate is scoped to the untimed level-13 drill --
    // a timed pair always requires both hands, whatever the selector reads
    // -- so the gate skips a timed level entirely.
    const handsPref = d.task === 'hands' && !d.timed ? effectiveHands(DB.prefs.kbdHands, bothUnlocked(S)) : DB.prefs.kbdHands;
    // Only a PLAIN 'j<n>' id ever gets a hand suffix appended -- an already-
    // suffixed id (level 14's 'j<n>t', which a level 17+ mixed 'hands' task
    // can also hand out via dd.pool='j' with no sfx filter) must never come
    // out as 'j1tr': that matches no id parseId() recognises at all.
    if (kind === 'hands') { const handsSuf = handsPref === 'right' ? 'r' : handsPref === 'left' ? 'l' : ''; if (handsSuf) pool = pool.map(id => /^j\d+$/.test(id) ? id + handsSuf : id); }
    if (sess.warm > 0) { sess.warm--; warm = true; const base = kind === 'bar' || kind === 'kit' ? kind : kind === 'chord' ? 'chord' : 'one'; kind = base; pool = byStrength(pool, modelNow).slice(0, Math.max(2, Math.ceil(pool.length / 2))); }
    return { kind: kind, warm: warm, pool: pool };
  }
  function applySessionPlan(d, M, warm, kind, pool) {
    // Today's plan (src/core/curriculum.js's planSession, ordered by
    // nextPlanStep) steers an ordinary (non-warm-up) level task through its
    // four blocks in turn -- review what came due, drill the weakest active
    // skill on its own, use it inside a short phrase, then check it blind --
    // before falling back to this level's usual chooser once nextPlanStep()
    // returns null. Warm-up keeps its existing precedence: while `warm` is
    // true above the plan is left untouched, so it resumes exactly where it
    // left off once the warm-up run ends.
    let planKind = null, planBlind = !!d.blind, seqLen = d.len || 2, planApplyId = null;
    // The plan only ever steers a pitched-item drill (one/chord/seq, or a
    // mix level that draws from those) with a real answer to give -- ear
    // training (M.input === 'answer') and the non-pitched level kinds
    // (hands, bar, kit, bar2, run, hold) build their own items/choices from
    // this level's own pool and must come out of buildLevelTask untouched,
    // never forced into a plan-shaped 'one'/'chord'/'seq' task.
    const planEligible = !warm && M.input !== 'answer' && (d.task === 'one' || d.task === 'chord' || d.task === 'seq' || d.task === 'mix' || !d.task);
    if (planEligible && sessionPlan && sessionPlan.length) {
      const step = nextPlanStep(sessionPlan, planProgress);
      if (step) {
        // Every plan step's ids are filtered to this level's OWN current
        // pool (poolFor(dd), computed above), never the wider activeItems
        // list -- an id the level itself would never hand out is not one
        // the plan may force on it either. An empty result after that
        // filter just means this step has nothing this level can use right
        // now: consume it (advance planProgress) and fall through to the
        // level's ordinary chooser for this one task, same as if no plan
        // were active.
        const stepIds = step.ids.filter(id => pool.indexOf(id) >= 0);
        if (!stepIds.length) { planProgress[step.kind] = (planProgress[step.kind] || 0) + 1; }
        else if (step.kind === 'apply') { planKind = step.kind; planBlind = !!step.blind; kind = 'seq'; seqLen = 3; planApplyId = stepIds[0]; }
        else {
          // The plan's very first task of the session landing on a single-id
          // pool that is exactly whatever task (warm-up, or none) just
          // finished would force mk() below to touch that S.item entry
          // twice back to back with no anti-repeat guard possible -- a
          // one-id pool gives pick() no other candidate. That is a
          // coincidence of the warm-up/session-start handoff, not one of
          // the plan's own intentional repeats (review handing straight to
          // weak on the SAME id, or weak's own three-in-a-row, are both
          // fine and left alone here since planProgress is no longer all
          // zero by the time those run). Leave the plan unconsumed just
          // this once; a normal task runs instead and moves lastItem on,
          // so the plan's next call always succeeds.
          const firstPlanTask = !planProgress.review && !planProgress.weak && !planProgress.apply && !planProgress.check;
          if (!(firstPlanTask && stepIds.length === 1 && stepIds[0] === lastItem)) {
            planKind = step.kind; planBlind = !!step.blind;
            pool = stepIds; kind = stepIds.every(id => id[0] === 'c') ? 'chord' : 'one';
          }
        }
      }
    }
    return { kind: kind, pool: pool, planKind: planKind, planBlind: planBlind, seqLen: seqLen, planApplyId: planApplyId };
  }
  function fillTaskItems(t, kind, pool, d, M, seqLen, planApplyId, mk) {
    if (kind === 'one' || kind === 'chord' || kind === 'hold' || kind === 'hands') t.els.push(mk(pick(lastItem, pool, modelNow)));
    else if (kind === 'seq') {
      let from = lastItem; for (let i = 0; i < seqLen; i++) { const id = pick(from, pool, modelNow); t.els.push(mk(id)); from = id; }
      if (planApplyId && !t.els.some(e => e.id === planApplyId)) t.els[t.els.length - 1] = mk(planApplyId);
    }
    else if (kind === 'run') {
      const notes = pool.filter(id => id[0] === 'n' || id[0] === 'w'), start = pick(lastItem, notes, modelNow), pre = start[0], all = notes.map(id => +id.slice(1)).sort((a, b) => a - b), lo = all[0], hi = all[all.length - 1], white = [0, 2, 4, 5, 7, 9, 11];
      let m = +start.slice(1), dir = gate('runDir', 0.5) ? 1 : -1; if (white.indexOf(pc(m)) < 0) m++; const seq = [m];
      for (let i = 0; i < 4; i++) { let nx = m + dir; while (white.indexOf(pc(nx)) < 0) nx += dir; if (nx > hi || nx < lo) { dir = -dir; nx = m + dir; while (white.indexOf(pc(nx)) < 0) nx += dir; } m = nx; seq.push(m); }
      seq.forEach(x => t.els.push(mk(pre + x)));
    }
    else if (kind === 'ear') { /* no items yet: the answer post-step in buildLevelTask draws one */ }
    else if (kind === 'bar') {
      let left = 4, from = lastItem, guard = 0; while (left > 0 && guard++ < 12) { const fit = pool.filter(id => CELLS[id.slice(1)].b <= left); const id = pick(from, fit.length ? fit : ['rq'], modelNow); t.els.push(mk(id)); left -= CELLS[id.slice(1)].b; from = id; }
      if (!t.els.some(e => e.info.on.length)) { t.els[0] = mk('rq'); }
    }
    else if (kind === 'kit') {
      const L = d.bars ? d : M.levels[S.tick % M.levels.length], b = L.bars[S.tick % L.bars.length]; S.tick++;
      t.kit = { metre: L.metre, bpm: d.bars ? L.bpm : L.bpm + 6 * (S.level - M.levels.length), swing: L.swing || 0, bar: b, name: L.name }; t.els = [{ id: 'kit', info: { label: L.name }, failed: false, t0: 0, rt: 0, reveal: false }];
    }
    else if (kind === 'bar2') {
      const variants = d.bars || [[['qr']]], cells = variants[S.tick % variants.length]; S.tick++; t.rCells = cells; t.els = [{ id: 'bar2', info: { label: d.name }, failed: false, t0: 0, rt: 0, reveal: false }];
    }
  }
  function buildLevelTask() {
    const d = D(), M = MODS[mod];
    const rk = resolveTaskKind(d), warm = rk.warm;
    const pl = applySessionPlan(d, M, warm, rk.kind, rk.pool), kind = pl.kind, pool = pl.pool, planKind = pl.planKind, planBlind = pl.planBlind;
    const t = { kind: kind, els: [], idx: 0, warm: warm, limit: d.limit || 8, ref: d.ref || 'none', blind: planBlind, t0: now(), done: false, revealed: false };
    // K3/K4: any element whose id isStagedPairId (a level 14/15/16 j<n>t /
    // j<n>h / j<n>d, however it was reached -- the dedicated level, warm-up,
    // or a level 17+ mix's 'one'/'seq' pool) gets its own e.pair scratchpad:
    // LEARN/CHECK phase, the per-pitch note-on/note-off timestamps
    // gradeTimedPair/gradeHeldBass read, `notes` (level 15's melody
    // note-ons), `rhOns`/`rhOffs` (level 16's right-hand onsets/releases)
    // and `last` (level 16's latest per-hand verdict, which survives a
    // reset -- see onNote's split branch below). Plain objects/arrays, not
    // Maps/Sets, so hook.cur() (a straight object copy across the debug-hook
    // boundary) serialises it whole for a test.
    const mk = id => { S.tick++; it(id, modelNow).seen = S.tick; const e = { id: id, info: inf(id), failed: false, t0: 0, rt: 0, reveal: shouldReveal({ exposures: it(id, modelNow).reps }) && !planBlind }; if (isStagedPairId(id)) e.pair = { phase: 'learn', on: {}, off: {}, learnOn: [], notes: [], rhOns: [], rhOffs: [], last: null }; return e; };
    fillTaskItems(t, kind, pool, d, M, pl.seqLen, pl.planApplyId, mk);
    if (M.input === 'answer') { t.kind = 'ear'; if (!t.els.length) t.els.push(mk(pick(lastItem, pool, modelNow))); const e = t.els[0], fam = pool.filter(id => id[0] === e.id[0] && (e.id[0] !== 'i' || id.slice(-1) === e.id.slice(-1))); t.choices = fam.slice().sort((a, b) => (inf(a).semi || 0) - (inf(b).semi || 0) || (a < b ? -1 : 1)); t.root = 55 + ((S.tick * 5) % 12); }
    if (planKind) planProgress[planKind] = (planProgress[planKind] || 0) + 1;
    return t;
  }

  // ---------- talking to the player ----------
  // #feedback lives inside #mainArea, which is hidden while a panel is open,
  // so a panel's say() would be invisible. Mirror it into the panel's own
  // status line whenever one is open.
  const say = (t, cls) => { const f = $('feedback'); f.textContent = t; f.className = cls || ''; $('feedbackCard').hidden = !t; const p = $('panelSay'); if (p) { p.textContent = panels.current() ? t : ''; p.className = 'panel-say ' + (cls || ''); } };
  const coach = t => { $('coach').textContent = t; if (!$('settingsView').hidden) $('settingsSay').textContent = t; };
  const cur = () => task && task.els[task.idx];
  let pressed = {}, heard = null, held = [], holdFor = 0, holdCents = [], wrongFor = 0, lastFired = -1, stableN = 0, stableMidi = -1, released = true, flashBad = -1e12, flashGood = -1e12;
  let quietFor = 0, quietSeen = false; // Q10d-2: delivered quiet time (dt, not frames) toward releasing a ringing pluck; the first quiet frame starts the clock
  // Field report: a strummed chord on a single-note item clears no gate the
  // app judges (see src/audio/input-diagnosis.js), so onPitch's early
  // returns below used to leave the learner with no note, no message, no
  // explanation. diagInputFrames is a rolling window of recent {rms,
  // clarity} readings fed to diagnoseInput() so the coach line can say WHICH
  // of silent / too-quiet / unclear-chord is actually happening, instead of
  // saying nothing at all. diagLastState tracks the last state a message was
  // shown for so a held state doesn't re-say the same line every frame.
  let diagInputFrames = [], diagLastState = null, diagSince = null, diagShown = null, diagBefore = ''; // diagSince: when this run of listening began; diagShown/diagBefore: the warning on the coach line and the line it replaced
  const DIAG_WINDOW_SEC = 1.5;

  function playRef(t) {
    ensureAudio(); const at = now() + 0.05, e = t.els[0];
    if (t.kind === 'ear') { const i = e.info; if (i.kind === 'interval') { const a = t.root, b = i.dir === 'd' ? a - i.semi : a + i.semi; if (i.dir === 'h') { tone(a, at, 1.4); tone(b, at, 1.4); } else { tone(a, at, 0.8); tone(b, at + 0.75, 1.1); } t.played = [a, b]; } else { t.played = i.pcs.map(x => t.root + x); t.played.forEach(m => tone(m, at, 1.6, 0.16)); } return; }
    if (mod === 'voice') { const tonic = e.info.tonic; if (t.ref === 'target') t.els.forEach((el, k) => tone(el.info.midi, at + k * 0.8, 0.75)); else { tone(tonic, at, 0.9); } }
    else if (MODS[mod].staff && $('optRef') && $('optRef').checked) t.els.forEach((el, k) => tone(el.info.midi, at + k * 0.8, 0.75));
  }
  function present() {
    const t = task, M = MODS[mod], e = cur(); t.t0 = now(); if (e) e.t0 = now(); held = []; holdFor = 0; holdCents = []; wrongFor = 0; if (!(heard && heard.rms >= releaseFloor(gates))) released = true;
    $('choices').hidden = t.kind !== 'ear'; $('replayBtn').hidden = !(t.kind === 'ear' || mod === 'voice'); $('showMeBtn').hidden = t.kind === 'ear' || t.kind === 'bar' || t.kind === 'bar2' || t.kind === 'kit';
    let p = '', h = '';
    if (t.kind === 'ear') { p = e.info.kind === 'interval' ? 'Which <b>interval</b>?' : 'Which <b>chord</b>?'; h = 'Listen, then choose. Number keys work too.'; const box = $('choices'); box.innerHTML = ''; t.choices.forEach((id, k) => { const b = document.createElement('button'); b.type = 'button'; b.id = 'ch-' + id; b.textContent = (k + 1) + '. ' + inf(id).label; b.addEventListener('click', () => { b.blur(); answer(id); }); box.appendChild(b); }); playRef(t); }
    else if (t.kind === 'bar') { p = 'Read it, then <b>tap it</b>'; h = 'Four clicks to get ready, then tap the bar in time.'; startBar(); }
    else if (t.kind === 'bar2') { p = 'Read it, then <b>tap it</b>'; h = 'Listen for the count-in, then tap the bar (or bars) in time.'; startBar2(); }
    else if (t.kind === 'kit') { p = 'Read it, then <b>play it</b>'; h = (t.kit.bar.tip ? t.kit.bar.tip + ' ' : '') + 'Listen for the count-in, then play the bar on the drums it shows.'; startKitBar(); }
    else if (t.kind === 'groove') { p = 'Play ' + t.els.map(el => promptFor(el.info, el.reveal)).join(' → ') + ' — <b>in time</b>'; h = 'Four clicks to count in, then play each note on the beat.'; startGroove(); }
    else { const verb = mod === 'voice' ? 'Sing' : 'Play'; p = verb + ' ' + t.els.map((el, k) => (k === t.idx ? '<b>' : '') + promptFor(el.info, el.reveal) + (k === t.idx ? '</b>' : '')).join(' → '); if (t.kind === 'hold') p = (mod === 'voice' ? 'Hold ' : 'Hold ') + '<b>' + e.info.label + '</b> for two seconds'; h = hintFor(e); playRef(t); }
    $('prompt').innerHTML = p; $('hint').textContent = (t.warm ? 'Warm-up, does not count. ' : '') + h; updateDesc(); updateHowPeek();
  }
  function hintFor(e) {
    const i = e.info;
    if (i.string && MODS[mod].fretless) return (e.reveal ? i.label + '. The dot shows the position.' : 'Find this pitch on the string.') + ' There is no fret to feel for — match the pitch, and the gauge shows sharp or flat.';
    if (i.string) return coreHintFor(i, e.reveal);
    if (i.anywhere) return 'Any string, any octave.';
    if (i.kind === 'chord') return 'All the notes together: ' + i.pcs.map(x => NAMES[x]).join(', ') + '.';
    if (i.kind === 'hands-together') {
      const stage = handsStageFromId(e.id);
      if (stage === 'held') {
        const mel = heldBassMelody(i.ex);
        return 'Left hand: finger ' + i.ex.lh.finger + ', ' + nname(i.ex.lh.midi) + ' -- hold it down. Right hand plays ' + mel.map(n => nname(n.midi) + ' (finger ' + n.finger + ')').join(', ') + ' over it, while the left hand keeps holding. Screen taps: practice only -- held notes need a MIDI keyboard or computer keys.';
      }
      if (stage === 'split') {
        return 'Right hand: two even notes, ' + nname(i.ex.rh.midi) + ' then ' + nname(i.ex.rh.midi) + ' again. Left hand: one long note, ' + nname(i.ex.lh.midi) + ', held under both. Screen taps: practice only -- held notes need a MIDI keyboard or computer keys.';
      }
      if (stage === 'position') {
        return 'Right hand: finger ' + i.ex.oldRh.finger + ', ' + nname(i.ex.oldRh.midi) + '. Left hand: finger ' + i.ex.lh.finger + ', ' + nname(i.ex.lh.midi) + ', held throughout. Partway through, without lifting the left hand, move the right hand up to ' + nname(i.ex.rh.midi) + ' and play the same shape there.';
      }
      if (isTimedPairId(e.id)) return 'Right hand: finger ' + i.ex.rh.finger + ', ' + nname(i.ex.rh.midi) + '. Left hand: finger ' + i.ex.lh.finger + ', ' + nname(i.ex.lh.midi) + '. First play them together at your own pace; then press both at the same moment and let go together. Screen taps: practice only -- held notes need a MIDI keyboard or computer keys.';
      const hMode = handsModeFromId(e.id);
      if (hMode === 'right') return 'Right hand: finger ' + i.ex.rh.finger + ', ' + nname(i.ex.rh.midi) + '. The left hand (' + nname(i.ex.lh.midi) + ') may play along but is not checked. A MIDI keyboard or two hands on the computer keys grades the right-hand note exactly; a microphone grades it approximately.';
      if (hMode === 'left') return 'Left hand: finger ' + i.ex.lh.finger + ', ' + nname(i.ex.lh.midi) + '. The right hand (' + nname(i.ex.rh.midi) + ') may play along but is not checked. A MIDI keyboard or two hands on the computer keys grades the left-hand note exactly; a microphone grades it approximately.';
      return fingeringLabel(i.ex) + ' (' + nname(i.ex.rh.midi) + ' right hand, ' + nname(i.ex.lh.midi) + ' left hand). A MIDI keyboard or two hands on the computer keys grades both notes exactly; a microphone only hears one note at a time, so that grading is approximate.';
    }
    if (mod === 'voice') return task.ref === 'target' ? 'You heard the note. Sing it back in any octave and hold it.' : 'You heard Do. Find ' + i.short + ' from it.';
    if (MODS[mod].staff) return t('hint.staffNote', { label: i.label });
    return e.reveal ? 'New key: it is lit up this time.' : '';
  }
  function refreshPrompt() { if (!task || task.kind === 'ear' || task.kind === 'bar' || task.kind === 'hold') return; const verb = mod === 'voice' ? 'Sing' : 'Play'; $('prompt').innerHTML = verb + ' ' + task.els.map((el, k) => (k === task.idx ? '<b>' : '') + promptFor(el.info, el.reveal) + (k === task.idx ? '</b>' : '')).join(' → '); const e = cur(); if (e) $('hint').textContent = (task.warm ? 'Warm-up, does not count. ' : '') + hintFor(e); updateDesc(); updateHowPeek(); }
  // text mirror of the canvas for the visually-hidden #cvDesc element (unit 7.7 item 1):
  // revealed mirrors the current element's own reveal/failed flag, never invents one.
  function updateDesc() { const el = $('cvDesc'); if (!el) return; if (task && task.kind === 'groove') { el.textContent = 'Play in time: ' + task.els.map(x => promptFor(x.info, x.reveal)).join(', ') + '. Four clicks to count in, then play each note on the beat.'; return; } const e = cur(); const revealed = task && task.kind === 'ear' ? !!task.revealed : !!(e && (e.reveal || e.failed)); el.textContent = task && task.kind === 'kit' ? 'Drum kit, ' + task.kit.name + ': ' + task.kit.bar.hits.map(h => (h.flam ? 'a flam on ' : '') + h.pieces.map(kitName).join(' with ')).join(', then ') + '. Play it after the count-in.' : describeTask(task, { revealed: revealed, fretless: !!MODS[mod].fretless }); }
  // "How to play this" peek (C1a): the SAME Fingerings-panel diagram Songs'
  // own inline expander shows for a lesson step (renderHowInline, src/ui/
  // fingerings.js), dropped beside the active note here instead. Never
  // calls openPanel('fingerings') -- its first line unconditionally ends
  // the running session (see openPanel below) -- so peeking costs nothing:
  // the session and the task both survive. Hidden under the exact same
  // conditions as showMeBtn (ear/bar/bar2/kit have no single active note to
  // draw a fingering for), plus whenever the current element has no plain
  // sounding pitch (a chord or hands-together item) or the mod's instrument
  // has no how diagram at all (renderHowInline returns null for keyboard,
  // today's only such instrument).
  function updateHowPeek() {
    const host = $('howPeekHost'); if (!host) return; host.textContent = '';
    const e = cur(), instrument = instrumentById[mod];
    if (!task || task.done || !e || $('showMeBtn').hidden || !instrument || e.info.midi === undefined) { host.hidden = true; return; }
    const setup = instrumentSetup(instrument, { fingeringsStore: (DB.panels && DB.panels.fingerings) || null, prefs: DB.prefs });
    const rendered = renderHowInline(host, instrument, e.info.midi, setup);
    if (!rendered) { host.hidden = true; return; }
    host.hidden = false;
    // Using the peek marks the SAME element helped as Show me (B3) -- help,
    // not a test: no SRS review, no streak break, no level setback, and (via
    // credit()'s existing assistance: e.helped ? 'shown' : ... line) the
    // same "shown" DB.events row Show me leaves. Deliberately does not
    // re-render this host (no refreshPrompt() call here) -- the host is
    // rebuilt fresh only when the active note itself changes, so the peek
    // the learner just opened does not collapse itself under their cursor.
    rendered.toggle.addEventListener('click', () => { if (rendered.toggle.getAttribute('aria-expanded') === 'true' && !e.failed && !e.helped) { e.helped = true; e.reveal = true; updateDesc(); } });
  }

  // ---------- judging ----------
  const timeQ = (rt, limit) => rt <= 0.4 * limit ? 1 : clamp(1 - 0.4 * (rt - 0.4 * limit) / (0.6 * limit), 0.6, 1);
  function passEl(extraQ, msg, assistance, input) {
    const e = cur(); e.rt = now() - e.t0; e.q = e.failed ? 0 : timeQ(e.rt, task.limit) * (extraQ === undefined ? 1 : extraQ); if (assistance) e.assistance = assistance; if (typeof input === 'string') e.input = input; flashGood = performance.now(); lastInputAt = now();
    if (!e.failed && !e.helped) say(msg || (inf(e.id).short + ': yes, in ' + e.rt.toFixed(1) + ' s.'), 'ok'); else say('That is the one. ' + inf(e.id).short + (e.info.string ? ' lives on string ' + e.info.string + (e.info.fret ? ', fret ' + e.info.fret : ', open') : '') + '.', '');
    task.idx++; held = []; holdFor = 0; holdCents = []; wrongFor = 0;
    if (diagShown && $('coach').textContent === diagShown) { coach(diagBefore); } diagInputFrames = []; diagLastState = null; diagSince = null; diagShown = null; // a pass starts the listening afresh: no warning left beside it
    if (task.idx >= task.els.length) finishTask(); else { cur().t0 = now(); refreshPrompt(); }
  }
  function failEl(msg, confKey) { const e = cur(); if (!e) return; if (!e.failed) { e.failed = true; e.reveal = true; } if (confKey) S.conf[confKey] = (S.conf[confKey] || 0) + 1; flashBad = performance.now(); say(msg, 'no'); updateDesc(); }
  let finishTask = function () {
    task.done = true; let from = lastItem, anyFail = false;
    // One learning-event row per judged element (plan 6.4), warm-up
    // included -- a warm-up still tells a later reader what was practised,
    // it just never touches the SRS model (see credit()'s `warm` early
    // return above). `dims.pitch` is the one dimension a built-in drill
    // ever judges here (q > 0 is the whole pass/fail signal); `input` is
    // the route of the passing note (passEl's 4th argument, threaded down
    // from onNote()'s `source`) and is left off rather than guessed when
    // no route was passed: the debug hook or grooveInject calling onNote
    // with no third argument, and onPitch's own pluck-chord and sustain
    // passEl calls (microphone rows, never a kbd note).
    task.els.forEach(e => { credit(e.id, e.q || 0, from, task.warm, e.rt, gradeOutcome({ helped: !!e.helped, failed: !!e.failed, assistance: e.assistance || null, q: e.q || 0 })); logEvent(makeEvent({ instrument: mod, skill: e.id, source: task.warm ? 'warmup' : 'drill', assistance: e.helped ? 'shown' : (e.assistance || 'none'), dims: { pitch: e.q > 0 ? 'ok' : 'miss' }, unassessed: [], activeMs: Math.round((e.rt || 0) * 1000), bpmTarget: null, bpmActual: null, hands: e.info.kind === 'hands-together' ? handsModeFromId(e.id) : undefined, input: e.input }, { now: modelNow })); from = e.id; if (!(e.q > 0)) anyFail = true; });
    lastItem = from; nextTaskAt = now() + (anyFail ? 1.5 : 0.7); if (task.kind === 'ear') nextTaskAt = now() + (anyFail ? 2.6 : 1.1); save(); showAll();
  };
  // a played note (MIDI key, screen key, or a plucked note the microphone
  // recognised); `source` is 'midi' for a real MIDI note-on, 'computer-key'
  // for the physical-keyboard keydown branch, 'screen' for a canvas tap or
  // canvas Enter/Space, and 'mic' for the microphone path -- left undefined
  // when a caller passes none (the debug hook, grooveInject).
  // A built-in drill/warm-up row now records this route as `input` (passed
  // through passEl to finishTask's logEvent); a song step still only ever
  // gets 'midi' or 'computer-key' forwarded to it (see the comment at the
  // forwardSongNote call below). A canvas tap or a mic note never reaches a
  // song step at all: openPanel() hides #mainArea (so #cv) and clears `task`
  // (so onPitch returns before calling onNote) the moment Songs opens. Besides (a) the plain-text "heard"
  // messages below and (b) hands-together grading using the real MIDI
  // held-note set instead of the note-on timer window, it is now also
  // handed straight through to forwardSongNote() so a song practice
  // attempt can tell a real keyboard from a stand-in the same way
  // (src/ui/songs.js's advance()) -- never anything about credit, mastery or
  // pass/fail, which stay blind to it.
  function onNote(midi, exact, source) {
    // Songs only ever learn a route they already understand (a real
    // keyboard or a stand-in for one). 'screen' and 'mic' cannot arrive here
    // while a song is open (see openPanel()), so this gate only matters if a
    // later UI change makes #cv reachable during songs: such a tap would
    // then reach advance() with no route, and its row keeps `input` off
    // rather than guessed (src/ui/songs.js's advance()).
    forwardSongNote(midi, exact, undefined, (source === 'midi' || source === 'computer-key') ? source : undefined);
    if (MODS[mod] && MODS[mod].kit) { const p = pieceForMidi(midi); if (p === null) coach('MIDI note ' + midi + ' is not one of the drums on this kit' + (playing ? ', so it counts as an extra hit.' : '.')); else if (!playing) coach(kitName(p) + ' heard -- start an exercise to see it judged.'); onHit(p, tapAudioTime(), source); return; }
    // "Calibrate timing" listens for taps, and a MIDI keyboard or drum set
    // is a tap source like the space bar: route the hit to onTap() before
    // the not-judging message below can call it a stray note.
    if (calRun) { onTap(); return; }
    lastInputAt = now(); pressed[midi] = performance.now();
    if (source === 'midi') { const notJudging = !playing || !task || task.done; const outOfView = !notJudging && mod === 'kbd' && (midi < kbdRange()[0] || midi > kbdRange()[1]); if (notJudging) coach(nname(midi) + ' heard' + (playing ? '.' : ' -- start an exercise to see it judged.')); else if (outOfView) coach(nname(midi) + ' heard, but that key is not drawn on screen right now.'); }
    if (!playing || !task || task.done) return; const e = cur(); if (!e) return; const i = e.info;
    if (MODS[mod].input === 'tap') { onTap(); return; }
    if (task.kind === 'groove') { grooveOnset(midi); return; }
    if (i.kind === 'chord') { if (!exact) return; held.push({ p: pc(midi), t: now() }); held = held.filter(x => now() - x.t < 1.5); const got = {}; held.forEach(x => { got[x.p] = 1; }); if (i.pcs.indexOf(pc(midi)) < 0) { failEl(nname(midi) + ' is not in ' + i.label + ' (' + i.pcs.map(x => NAMES[x]).join(', ') + ').', e.id + '>x' + pc(midi)); held = []; return; } if (i.pcs.every(x => got[x])) passEl(undefined, undefined, undefined, source); return; }
    if (i.kind === 'hands-together') { onHandsTogetherNote(e, i, midi, exact, source); return; }
    if (i.kind !== 'note') return;
    const policy = i.anywhere ? 'fold' : (OCTAVE_POLICY[mod] || 'fold');
    const judged = judgePitch({ heardMidi: midi, targetMidi: i.midi, policy });
    if (judged.ok) { passEl(undefined, undefined, undefined, source); return; }
    const where = wrongNoteHint({ heardMidi: midi, targetMidi: i.midi, policy, fretted: !!i.string && !MODS[mod].fretless });
    const wn = (x) => i.written === undefined ? nname(x) : nname(writtenMidi(i, x)); failEl('That was ' + wn(midi) + ', the note is ' + wn(i.midi) + '. ' + where, e.id + '>' + wn(midi)); // transposing winds: both names in the written key the prompt uses
  }
  // onNote's hands-together branch: the stage machine lives in src/core/hands-together-stage.js (pure, table-tested); this applies its verdict to the UI.
  function handsCtx(e) { return { id: e.id, ex: e.info.ex, pair: e.pair, held: held, now: now, perfNow: () => performance.now(), noteState: noteState, realMidiHeld: realMidiHeld, nname: nname }; }
  function applyHandsVerdict(v) { if (v.held) held = v.held; v.acts.forEach(a => { if (a.t === 'fail') failEl(a.msg, a.key); else if (a.t === 'pass') passEl(a.q, a.msg, a.assist, a.input); else if (a.t === 'say') say(a.msg, a.cls); else refreshPrompt(); }); }
  function onHandsTogetherNote(e, i, midi, exact, source) { applyHandsVerdict(stepHandsTogether(handsCtx(e), { type: 'on', midi: midi, exact: exact, source: source })); }
  // K3/K4: the note-off half of levels 14-16's CHECK phase (onNote above
  // handles every note-on). Only a real MIDI or computer-key release
  // reaches here (handleMidiMessage's note-off branch, keyup) -- a screen
  // tap or the debug hook never fires this, so a CHECK-phase pair can only
  // ever pass on real held-note evidence. Ignored outside CHECK (LEARN's
  // note-offs mean nothing) -- that gate sits in the stage machine's stepOff.
  function onNoteOff(midi, source) {
    if (!playing || !task || task.done) return; const e = cur(); if (!e || !e.pair) return;
    applyHandsVerdict(stepHandsTogether(handsCtx(e), { type: 'off', midi: midi, source: source }));
  }
  function answer(id) {
    lastInputAt = now(); if (!playing || !task || task.kind !== 'ear' || task.done) return; const e = cur(), right = id === e.id; e.rt = now() - e.t0; e.q = right ? timeQ(e.rt, task.limit) : 0; task.revealed = true; updateDesc();
    const b = $('ch-' + id); if (b) b.className = right ? 'right' : 'wrong'; const rb = $('ch-' + e.id); if (rb) rb.className = 'right';
    if (right) say(e.info.label + ': yes.', 'ok'); else if (id === 'timeout') { say('Time. That was a ' + e.info.label.toLowerCase() + '. Listen again as it replays.', 'no'); playRef(task); } else { S.conf[e.id + '>' + id] = (S.conf[e.id + '>' + id] || 0) + 1; say('That was a ' + e.info.label.toLowerCase() + ', not a ' + inf(id).label.toLowerCase() + '. Listen again as it replays.', 'no'); playRef(task); }
    task.idx = 1; finishTask();
  }
  // microphone frames: plucked instruments fire note events, voices and winds are judged on a held pitch
  function onPitch(fr, dt) {
    heard = fr; if (deafWindow.isDeaf()) return; const M = MODS[mod]; if (!playing || !task || task.done) return; const e = cur(); if (!e) return;
    // Field-report fix: on a single-note item, tell the learner WHY nothing
    // is being judged instead of leaving them with silence. Skipped on a
    // chord item, where hearing more than one pitch class is the point, not
    // a problem — its own chroma path below already handles it.
    if ((M.input === 'pluck' || M.input === 'sustain') && e.info.kind !== 'chord') {
      diagInputFrames.push({ rms: fr.rms, clarity: fr.clarity, t: now() });
      const cutoff = now() - DIAG_WINDOW_SEC - 0.5;
      while (diagInputFrames.length && diagInputFrames[0].t < cutoff) diagInputFrames.shift();
      // pluck/sustain both judge a note against gates.note (not gates.pitch)
      // below, so the diagnosis must use the same threshold or it could call
      // "too-quiet" a signal onPitch itself would already have judged.
      const diag = diagnoseInput(diagInputFrames, { gates: { pitch: gates.note }, quietRoom: DB.prefs.noiseFloor > 0 && DB.prefs.noiseFloor < ROOM_QUIET_BELOW }); // a measured quiet room that has not been played in is not a dead mic
      // stepDiagnosis() holds back a silent/too-quiet verdict for the first moments of listening, and says when clean notes should take a warning down; the line it replaced is put back.
      if (diagSince === null || diag.state === 'ok') diagSince = now(); // the quiet-room grace counts from the last clean note, so a note that has just rung out is not called silence
      const step = stepDiagnosis(diag, diagLastState, { sinceSec: now() - diagSince }); diagLastState = step.last;
      if (step.say) { if ($('coach').textContent !== diagShown) diagBefore = $('coach').textContent; diagShown = step.say; coach(step.say); }
      else if (step.clear && diagShown && $('coach').textContent === diagShown) { coach(diagBefore); diagShown = null; }
    } else { diagInputFrames = []; diagLastState = null; diagSince = null; diagShown = null; }
    if (M.input === 'pluck') {
      // F8: an onset detector (src/audio/onset.js) catches a re-pluck of the
      // SAME note on a still-ringing string, which the RMS-drop/pitch-change
      // release check below can never see on its own.
      if (fr.onset) { released = true; stableN = 0; }
      if (e.info.kind === 'chord') { if (fr.rms < gates.chord || !fr.chroma) { holdFor = 0; return; } const j = judgeChord({ chroma: fr.chroma, targetPcs: e.info.pcs }); e.score = j.score; if (j.ok) { holdFor += dt; if (holdFor > 0.18) passEl(undefined, e.info.label + ': that rings true.'); } else holdFor = 0; if (fr.rms > 0.02) lastInputAt = now(); return; }
      if (fr.rms < gates.note || !fr.freq) { stableN++; if (fr.rms !== 0) { if (fr.rms < releaseFloor(gates)) { if (quietSeen) quietFor += dt; quietSeen = true; if (quietFor >= QUIET_RELEASE_SEC) released = true; } else { quietSeen = false; quietFor = 0; } } stableMidi = -1; return; } quietSeen = false; quietFor = 0; // an exact-0 rms frame is a capture dropout (with the browser's processing off, a live mic's silence is not 0.0; a device-level gate can still send zeros): it holds the quiet clock
      const m = Math.round(fr.midi); if (m === stableMidi) stableN++; else { stableMidi = m; stableN = 1; }
      if (stableN === 3 && (released || m !== lastFired)) { lastFired = m; released = false; onNote(m, false, 'mic'); }
      return;
    }
    if (M.input === 'sustain') {
      if (!fr.freq || fr.rms < gates.note) { holdFor = Math.max(0, holdFor - dt * 2); wrongFor = 0; return; } lastInputAt = now();
      const octavePolicy = OCTAVE_POLICY[mod] || 'fold'; const octaveOk = octavePolicy !== 'exact' || judgePitch({ heardMidi: Math.round(fr.midi), targetMidi: Math.round(e.info.midi), policy: octavePolicy }).reason !== 'right-pitch-class-wrong-octave';
      let cents = (fr.midi - e.info.midi) * 100; const sameName = pc(fr.midi) === pc(e.info.midi); if (octavePolicy !== 'exact') cents = ((cents + 600) % 1200 + 1200) % 1200 - 600; fr.cents = cents; const tol = 45, need = task.kind === 'hold' ? 2 : 0.5;
      if (octaveOk && Math.abs(cents) <= tol) { holdFor += dt; holdCents.push(cents); wrongFor = 0; if (holdFor >= need) { const mc = mean(holdCents.map(Math.abs)), bias = mean(holdCents), q = clamp(1 - mc / 90, 0.6, 1); passEl(q, e.info.short + ': held it, ' + (Math.abs(bias) < 8 ? 'dead centre' : Math.round(Math.abs(bias)) + ' cents ' + (bias > 0 ? 'sharp' : 'flat')) + '.'); } }
      else { holdFor = 0; holdCents = []; wrongFor += dt; if (wrongFor > 0.9) { wrongFor = 0; const near = octaveOk && Math.abs(cents) < 100; const wn = (x) => e.info.written === undefined ? nname(x) : nname(writtenMidi(e.info, x)); failEl(octavePolicy === 'exact' && sameName && !octaveOk ? 'Right note name, wrong octave. You want ' + e.info.label + ', which is ' + (cents > 0 ? 'lower' : 'higher') + ' on the instrument.' : near ? 'Close: you are ' + Math.round(Math.abs(cents)) + ' cents ' + (cents > 0 ? 'sharp. Relax it down.' : 'flat. Lift it up.') : 'You are on ' + wn(fr.midi) + ', the note is ' + wn(e.info.midi) + '. Go ' + (cents > 0 ? 'lower' : 'higher') + '.', near ? null : e.id + '>' + wn(fr.midi)); } }
    }
  }

  // ---------- rhythm reading: a count-in bar, then the bar you tap ----------
  let bar = null, calRun = null;
  function startBar() { const bpm = D().bpm || 72, spb = 60 / bpm, t0 = now() + 0.15; bar = { spb: spb, t0: t0, playAt: t0 + 4 * spb, end: t0 + 8 * spb, clicks: 0, taps: [], onsets: [], judged: false }; let b = 0; task.els.forEach(e => { e.info.on.forEach(o => bar.onsets.push({ t: bar.playAt + (b + o) * spb, el: e, hit: null })); e.b0 = b; b += e.info.beats; }); }
  const audioNow = () => actx ? actx.currentTime : performance.now() / 1000;
  const tapAudioTime = ev => toAudioTime({ eventTimeStamp: ev && typeof ev.timeStamp === 'number' ? ev.timeStamp : performance.now(), perfNow: performance.now(), audioNow: audioNow() });
  function startCalibrate() {
    if (calRun || !ensureAudio()) return;
    const bpm = 72, spb = 60 / bpm, t0 = now() + 0.15, beats = [];
    for (let i = 0; i < 8; i++) beats.push(t0 + i * spb);
    beats.forEach((at, i) => click(at, i % 4 === 0));
    calRun = { beats: beats };
    calRun.taps = [];
    say('Tap along with the eight clicks.', '');
    renderOpts();
    setTimeout(() => {
      const taps = calRun ? calRun.taps : [];
      if (taps.length >= 4) { DB.latencyMs = medianLatency(taps); say('Timing calibrated: ' + Math.round(DB.latencyMs) + ' ms.', 'ok'); save(); }
      else say('Not enough taps caught. Try again.', 'no');
      calRun = null; renderOpts();
    }, (beats[beats.length - 1] - now() + 0.5) * 1000);
  }
  function onTap(ev) {
    lastInputAt = now(); $('tapPad').classList.add('down'); setTimeout(() => $('tapPad').classList.remove('down'), 90);
    if (calRun) { const raw = tapAudioTime(ev), v = judgeTap({ tapTime: raw, beatTimes: calRun.beats, latencyMs: 0, windowMs: 1e9 }); if (v.errorMs !== null) { calRun.taps.push(v.errorMs); say('Caught ' + calRun.taps.length + ' of 8 taps.', ''); } return; }
    if (!playing || !task || (task.kind !== 'bar' && task.kind !== 'bar2') || !bar || bar.judged) return;
    const latencyMs = DB.latencyMs != null ? DB.latencyMs : (actx ? (actx.outputLatency || actx.baseLatency || 0) * 1000 : 0);
    const win = S.level > MODS.rhy.levels.length ? 0.11 : 0.15;
    const raw = tapAudioTime(ev) - S.offset, verdict = judgeTap({ tapTime: raw, beatTimes: bar.onsets.map(o => o.t), latencyMs: latencyMs, windowMs: win * 1000 }), t = raw - latencyMs / 1000;
    if (t < bar.playAt - 0.25) return;
    bar.taps.push({ t: t, used: false, live: verdict });
  }
  function tickBar() {
    if (!bar || !task || task.kind !== 'bar') return; const t = now();
    while (bar.clicks < 8 && bar.t0 + bar.clicks * bar.spb < t + 0.12) { const at = bar.t0 + bar.clicks * bar.spb; if (at > t - 0.01) click(at, bar.clicks % 4 === 0); bar.clicks++; }
    if (!bar.judged && t > bar.end + 0.2) {
      bar.judged = true; const win = S.level > MODS.rhy.levels.length ? 0.11 : 0.15, deltas = [];
      bar.onsets.forEach(o => { let best = null; bar.taps.forEach(tp => { if (tp.used) return; const d = tp.t - o.t; if (Math.abs(d) <= win && (!best || Math.abs(d) < Math.abs(best.t - o.t))) best = tp; }); if (best) { best.used = true; o.hit = best.t - o.t; deltas.push(o.hit); } });
      const extra = bar.taps.filter(tp => !tp.used); let misses = 0;
      task.els.forEach(e => { const mine = bar.onsets.filter(o => o.el === e), ext = extra.filter(tp => tp.t >= bar.playAt + e.b0 * bar.spb - 0.05 && tp.t < bar.playAt + (e.b0 + e.info.beats) * bar.spb - 0.05).length, miss = mine.filter(o => o.hit === null).length; misses += miss; e.rt = 1; if (miss || ext) { e.q = 0; e.failed = true; } else e.q = mine.length ? clamp(1 - 0.4 * mean(mine.map(o => Math.abs(o.hit))) / win, 0.6, 1) : 1; });
      if (!bar.taps.length) sess.idleBars++; else sess.idleBars = 0;
      if (deltas.length) { sess.cal = sess.cal.concat(deltas); if (sess.cal.length >= 12) { const med = median(sess.cal); sess.cal = []; if (Math.abs(med) > 0.02) S.offset = clamp(S.offset + med * 0.5, -0.15, 0.15); } }
      const bias = deltas.length ? mean(deltas) : 0; say(misses === 0 && !extra.length ? 'Clean bar. Average ' + Math.round(Math.abs(bias) * 1000) + ' ms ' + (bias < 0 ? 'early' : 'late') + '.' : (misses ? misses + ' missed' : '') + (misses && extra.length ? ', ' : '') + (extra.length ? extra.length + ' extra tap' + (extra.length > 1 ? 's' : '') : '') + '. Trouble spot: ' + (task.els.filter(e => e.failed)[0] || task.els[0]).info.label + '.', misses === 0 && !extra.length ? 'ok' : 'no');
      if (sess.idleBars >= 2) { sess.idleBars = 0; task.done = true; takeBreak('away'); return; }
      task.idx = task.els.length; finishTask(); nextTaskAt = now() + 0.4;
    }
  }

  // ---------- rhythm vocabulary bars: rests, ties, triplets, 3/4, 6/8, swing, two-bar phrases ----------
  function startBar2() {
    const d = D(), bpm = d.bpm || 72, metre = d.metre || '4/4', M = RHY.METRES[metre];
    const phrase = RHY.buildPhrase({ metre: metre, cells: task.rCells });
    const beatSec = (60 / bpm) * (M.beatUnit / RHY.TPQ);
    const totalSec = RHY.totalTicks(phrase.events) * (60 / bpm) / RHY.TPQ;
    const t0 = now() + 0.15, playAt = t0 + M.beats * beatSec;
    const onsets = RHY.onsetsOf(phrase.events, { bpm: bpm, swing: d.swing || 0 }).map(t => ({ t: playAt + t, hit: null }));
    bar = { spb: beatSec, t0: t0, playAt: playAt, end: playAt + totalSec + 0.3, clicks: 0, countBeats: M.beats, metre: metre, phrase: phrase, onsets: onsets, taps: [], judged: false };
  }
  function tickBar2() {
    if (!bar || !task || task.kind !== 'bar2') return; const t = now();
    while (bar.clicks < bar.countBeats && bar.t0 + bar.clicks * bar.spb < t + 0.12) { const at = bar.t0 + bar.clicks * bar.spb; if (at > t - 0.01) click(at, bar.clicks === 0); bar.clicks++; }
    if (!bar.judged && t > bar.end) {
      bar.judged = true; const win = 0.15, deltas = [];
      bar.onsets.forEach(o => { let best = null; bar.taps.forEach(tp => { if (tp.used) return; const dd = tp.t - o.t; if (Math.abs(dd) <= win && (!best || Math.abs(dd) < Math.abs(best.t - o.t))) best = tp; }); if (best) { best.used = true; o.hit = best.t - o.t; deltas.push(o.hit); } });
      const extra = bar.taps.filter(tp => !tp.used), misses = bar.onsets.filter(o => o.hit === null).length, e = cur();
      e.rt = 1; e.q = misses || extra.length ? 0 : 1; e.failed = !!(misses || extra.length);
      const bias = deltas.length ? mean(deltas) : 0;
      say(misses === 0 && !extra.length ? 'Clean bar. Average ' + Math.round(Math.abs(bias) * 1000) + ' ms ' + (bias < 0 ? 'early' : 'late') + '.' : (misses ? misses + ' missed' : '') + (misses && extra.length ? ', ' : '') + (extra.length ? extra.length + ' extra tap' + (extra.length > 1 ? 's' : '') : '') + '.', misses === 0 && !extra.length ? 'ok' : 'no');
      if (!bar.taps.length) sess.idleBars++; else sess.idleBars = 0;
      if (sess.idleBars >= 2) { sess.idleBars = 0; task.done = true; takeBreak('away'); return; }
      task.idx = task.els.length; finishTask(); nextTaskAt = now() + 0.4;
    }
  }

  // ---------- drum kit: a count-in, then one bar where every note names a drum ----------
  // bar.onsets: one per sounding note, { t, beat (quarter beats into the bar), pieces, flam }.
  // A MIDI note, a kit key and a click on the drawn kit all land in onHit() as one tap { t, piece }.
  const KIT = instrumentById['drum-kit'].kit, KIT_KEYS = {}; KIT.forEach(p => { KIT_KEYS[p.key] = p.id; });
  const kitName = id => { const p = KIT.find(k => k.id === id); return p ? p.name : 'a note off the kit'; };
  let kitFlash = { piece: null, at: -1e12 }, kitBox = null, kitLabels = [];
  function startKitBar() {
    const k = task.kit, M = RHY.METRES[k.metre], phrase = RHY.buildPhrase({ metre: k.metre, cells: k.bar.cells }), beatSec = (60 / k.bpm) * (M.beatUnit / RHY.TPQ), t0 = now() + 0.15, playAt = t0 + M.beats * beatSec, times = RHY.onsetsOf(phrase.events, { bpm: k.bpm, swing: k.swing });
    let tick = 0; const beats = [], mt = k.metre.split('/').map(Number); phrase.events.forEach(ev => { if (!ev.rest && !ev.tied) beats.push(tick / RHY.TPQ); tick += ev.dur; });
    const onsets = times.map((t, i) => ({ t: playAt + t, beat: beats[i], pieces: k.bar.hits[i].pieces, flam: k.bar.hits[i].flam }));
    // laid out in quarter beats (a 6/8 bar is three), then the time signature shows the real metre
    const staff = layoutPercussionMeasure({ hits: [].concat(...onsets.map(o => o.pieces.map(p => ({ piece: p, start: o.beat })))), time: [tick / RHY.TPQ, 4], width: 400 }).primitives; staff.forEach(q => { if (q.type === 'timeSig') { q.top = mt[0]; q.bottom = mt[1]; } });
    bar = { spb: beatSec, t0: t0, playAt: playAt, end: playAt + tick * (60 / k.bpm) / RHY.TPQ + 0.3, clicks: 0, countBeats: M.beats, metre: k.metre, onsets: onsets, staff: staff, noteX: [...new Set(staff.filter(q => q.type === 'notehead').map(q => q.x))].sort((a, b) => a - b), taps: [], judged: false };
  }
  // A drum-name a mic hit cannot give (toms, crash, ride -- drum-classify.js
  // only tells kick/snare/hihat apart) is judged leniently rather than
  // pretending the mic can name it: an unnamed mic hit (piece null, source
  // 'mic') stands in for ANY of these when the bar wants one of them. Timing
  // is still judged normally; only the drum name is not held against you.
  const KIT_MIC_UNNAMED = new Set(['tom-floor', 'tom-mid', 'tom-high', 'crash', 'ride']);
  // src/audio/drum-classify.js's three classes, named to this kit's piece ids.
  const DRUM_KIND_TO_PIECE = { kick: 'kick', snare: 'snare', hihat: 'hihat-closed' };
  function onHit(piece, t, source) {
    // A real mic hit already made its own sound; only a silent input (key,
    // click, or an e-kit's own MIDI voice) needs the app's synthesized one.
    lastInputAt = now(); if (piece) { kitFlash = { piece: piece, at: performance.now() }; if (source !== 'midi' && source !== 'mic') drumHit(piece, now() + 0.005); }
    if (!playing || !task || task.kind !== 'kit' || !bar || bar.judged) return;
    const latencyMs = DB.latencyMs != null ? DB.latencyMs : (actx ? (actx.outputLatency || actx.baseLatency || 0) * 1000 : 0), at = t - S.offset - latencyMs / 1000;
    if (at >= bar.playAt - 0.25) bar.taps.push({ t: at, piece: piece, used: false, source: source });
  }
  function tickKitBar() {
    if (!bar || !task || task.kind !== 'kit') return; const t = now();
    while (bar.clicks < bar.countBeats && bar.t0 + bar.clicks * bar.spb < t + 0.12) { const at = bar.t0 + bar.clicks * bar.spb; if (at > t - 0.01) click(at, bar.clicks === 0); bar.clicks++; }
    if (bar.judged || t <= bar.end) return;
    bar.judged = true; const win = S.level > MODS[mod].levels.length ? 0.11 : 0.15, deltas = [];
    const near = (o, ok) => { let best = null; bar.taps.forEach(tp => { if (!tp.used && ok(tp) && Math.abs(tp.t - o.t) <= win && (!best || Math.abs(tp.t - o.t) < Math.abs(best.t - o.t))) best = tp; }); if (best) best.used = true; return best; };
    // A mic hit the classifier could not name (piece null, source 'mic') still counts for a tom/crash/ride onset -- the mic can only tell kick, snare and hi-hat apart.
    const tapMatches = (tp, p) => tp.piece === p || (tp.piece === null && tp.source === 'mic' && KIT_MIC_UNNAMED.has(p));
    // right drum first (a flam wants a second snare hit within 40 ms), then an on-time hit on another drum is "wrong drum"; what is left over is extra
    bar.onsets.forEach(o => { o.res = o.pieces.map(p => { const hit = near(o, tp => tapMatches(tp, p)); if (!hit) return { p: p, miss: true }; deltas.push(hit.t - o.t); if (!o.flam) return { p: p, dt: hit.t - o.t }; const two = near(o, tp => tapMatches(tp, p)), gap = two ? Math.abs(two.t - hit.t) : null; return gap !== null && gap <= 0.04 ? { p: p, dt: hit.t - o.t } : { p: p, flam: gap }; }); });
    bar.onsets.forEach(o => o.res.forEach(r => { if (!r.miss) return; const other = near(o, tp => tp.piece && tp.piece !== r.p); if (other) { r.miss = false; r.wrong = other.piece; } }));
    const all = [].concat(...bar.onsets.map(o => o.res)), misses = all.filter(r => r.miss).length, wrong = all.filter(r => r.wrong), flams = all.filter(r => r.flam !== undefined), extra = bar.taps.filter(tp => !tp.used), e = cur(), bad = misses + wrong.length + flams.length + extra.length, parts = [];
    if (misses) parts.push(misses + ' missed');
    if (wrong.length) parts.push(wrong.length + ' on the wrong drum (' + wrong.map(r => 'wanted ' + kitName(r.p) + ', heard ' + kitName(r.wrong)).filter((x, i, a) => a.indexOf(x) === i).join('; ') + ')');
    if (flams.length) parts.push(flams.length + ' flam' + (flams.length > 1 ? 's' : '') + (flams[0].flam === null ? ' with one hit, not two' : ' ' + Math.round(flams[0].flam * 1000) + ' ms apart; keep the two snare hits within 40 ms'));
    if (extra.length) parts.push(extra.length + ' extra hit' + (extra.length > 1 ? 's' : ''));
    e.rt = 1; e.q = bad ? 0 : 1; e.failed = !!bad; const bias = deltas.length ? mean(deltas) : 0;
    say(bad ? parts.join(', ') + '.' : 'Clean bar. Average ' + Math.round(Math.abs(bias) * 1000) + ' ms ' + (bias < 0 ? 'early' : 'late') + '.', bad ? 'no' : 'ok');
    if (!bar.taps.length) sess.idleBars++; else sess.idleBars = 0;
    if (sess.idleBars >= 2) { sess.idleBars = 0; task.done = true; takeBreak('away'); return; }
    task.idx = task.els.length; finishTask(); nextTaskAt = now() + 0.4;
  }

  // ---------- play in time: a count-in, then the shown notes played on the beat (F7) ----------
  // Only instruments whose note events surface through onNote() (MIDI/keys,
  // or a mic pluck once its pitch is stable) can be judged this way; voice,
  // wind and harp are held-pitch ('sustain') with no discrete attack to time.
  let grooveOn = false, groove = null, grooveLast = null;
  function groovable(m) { const M = MODS[m]; return !!M && !M.kit && (M.input === 'midi' || M.input === 'pluck'); }
  // A metronome tick for a groove exercise deliberately does NOT open the
  // shared deaf window (compare click(), which does): a click that blinds
  // the mic for its usual 60ms + 250ms tail would make playing ON the beat
  // unjudgeable for pluck instruments (F7's own bug, moved one level up).
  // This click is under 35ms, and onPitch's own onset gate already needs
  // three consecutive 50ms analyser frames of matching pitch (150ms) before
  // it credits a note, so the transient cannot be mistaken for one; nothing
  // in onPitch or the shared deaf window needs to change.
  function grooveClick(at, accent) {
    if (!actx) return; const o = actx.createOscillator(), v = actx.createGain();
    o.type = 'square'; o.frequency.value = accent ? 1500 : 1000;
    v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(0.12, at + 0.002); v.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    o.connect(v); v.connect(actx.destination); o.start(at); o.stop(at + 0.035);
  }
  function buildGrooveTask() {
    const pool = poolFor(D()), len = 4; let from = lastItem; const els = [];
    for (let i = 0; i < len; i++) { const id = pick(from, pool, modelNow); S.tick++; it(id, modelNow).seen = S.tick; els.push({ id: id, info: inf(id), failed: false, t0: 0, rt: 0, reveal: it(id, modelNow).reps < 2 }); from = id; }
    return { kind: 'groove', els: els, idx: 0, warm: false, limit: 8, ref: 'none', blind: false, t0: now(), done: false };
  }
  function startGroove() {
    const bpm = S.grooveBpm || 80, spb = 60 / bpm, t0 = now() + 0.15, beatsPerBar = task.els.length;
    const grid = makeGrid({ bpm: bpm, beatsPerBar: beatsPerBar, bars: 1, subdivision: 1, startTime: t0 + beatsPerBar * spb });
    groove = { bpm: bpm, spb: spb, t0: t0, grid: grid, clicks: 0, onsets: [], judged: false, end: grid[grid.length - 1] + spb * 0.6 };
  }
  function grooveOnset(midi) {
    if (!groove || groove.judged) return; const t = now();
    if (t < groove.grid[0] - groove.spb * 0.6) return; // before the count-in has handed off, ignore
    groove.onsets.push({ t: t, midi: midi });
  }
  function tickGroove() {
    if (!groove || !task || task.kind !== 'groove') return; const t = now(), total = task.els.length * 2;
    while (groove.clicks < total && groove.t0 + groove.clicks * groove.spb < t + 0.12) { const at = groove.t0 + groove.clicks * groove.spb; if (at > t - 0.01) grooveClick(at, groove.clicks % task.els.length === 0); groove.clicks++; }
    if (!groove.judged && t > groove.end) {
      groove.judged = true;
      // Every fretted instrument is mic-only: the mic hears a pitch but not
      // which string produced it, so a groove/rhythm take is scored by
      // pitch class regardless of octave. Derived from the registry's
      // `fretted` flag (src/instruments/*.js) rather than a hand-typed
      // instrument-id list, same reasoning as itemIdForMidi's fretted
      // branch (src/ui/songs/mastery.js) -- otherwise a newly-added fretted
      // instrument silently scores a correct take as wrong.
      const fold = (instrumentById[mod] && instrumentById[mod].fretted) || task.els.some(e => e.info.anywhere);
      const expected = task.els.map((e, i) => ({ beat: i, midi: fold ? pc(e.info.midi) : e.info.midi }));
      const onsets = groove.onsets.map(o => ({ t: o.t, midi: fold ? pc(o.midi) : o.midi }));
      const latencyMs = DB.latencyMs != null ? DB.latencyMs : (actx ? (actx.outputLatency || actx.baseLatency || 0) * 1000 : 0);
      const result = grooveLast = scoreTake({ onsets: onsets, grid: groove.grid, expected: expected, latencyMs: latencyMs, windowMs: 150 });
      result.notes.forEach((r, i) => { const e = task.els[i]; e.rt = 1; if (r.ok) e.q = clamp(1 - Math.abs(r.errorMs || 0) / 150, 0.6, 1); else { e.q = 0; e.failed = true; } });
      const passed = result.summary.hitRate >= 0.75 && result.summary.tendency === 'steady' && task.els.every(e => e.q > 0);
      S.grooveBpm = tempoLadder({ bpm: groove.bpm, passed: passed });
      const tend = result.summary.tendency;
      const feel = tend === 'steady' ? 'right on it' : tend === 'rushing' ? 'a little early overall' : tend === 'dragging' ? 'a little late overall' : 'not enough to tell';
      say(passed ? 'Clean take at ' + groove.bpm + ' bpm, ' + feel + '. Next: ' + S.grooveBpm + ' bpm.' : (tend === 'rushing' ? 'You are rushing it — coming in early.' : tend === 'dragging' ? 'You are dragging — coming in late.' : 'Not quite on the beat yet.') + ' Staying at ' + S.grooveBpm + ' bpm.', passed ? 'ok' : 'no');
      task.idx = task.els.length; finishTask(); nextTaskAt = now() + 0.4; save();
    }
  }

  // ---------- the loop ----------
  function tick(dt) {
    sess.active += dt; sess.sinceBreak += dt;
    if (!task || (task.done && now() >= nextTaskAt)) { task = buildTask(); present(); }
    if (task.kind === 'bar') tickBar();
    else if (task.kind === 'bar2') tickBar2();
    else if (task.kind === 'kit') tickKitBar();
    else if (task.kind === 'groove') tickGroove();
    else if (!task.done) {
      const e = cur(), el = now() - e.t0, lim = task.limit * (task.kind === 'hold' ? 1.4 : 1);
      $('timeFill').style.width = Math.round(100 * c01(1 - el / lim)) + '%';
      if (el > lim && !e.failed) { failEl(task.kind === 'ear' ? '' : 'Time. ' + (e.info.string ? 'It is on string ' + e.info.string + (MODS[mod].fretless ? (e.info.fret ? ', ' + e.info.fret + ' semitone' + (e.info.fret > 1 ? 's' : '') + ' up' : ', open') : (e.info.fret ? ', fret ' + e.info.fret : ', open')) + '. ' : '') + 'It is shown now: play it to move on.', null); if (task.kind === 'ear') { answer('timeout'); } else if (mod === 'voice') tone(e.info.midi, now() + 0.05, 0.9); }
      if (now() - lastInputAt > 30 && el > lim + 8) { if (e.failed && !task.warm) { /* this one does not count: nobody was there */ e.failed = false; } task.done = true; task = null; takeBreak('away'); return; }
    }
    if (sess.sinceBreak > 25 * 60 && Date.now() > sess.snoozeUntil) { takeBreak('long'); return; }
    if (sess.target && sess.active > sess.target * 60) { const mins = sess.target; sess.target = 0; takeBreak('target', mins); return; }
    if (!sess.capWarned && todayMinutes() >= 45) { sess.capWarned = true; coach('That is 45 minutes of practice today across your instruments. Skill settles in while you rest, so more today buys little. Finish this level bar and call it.'); }
  }
  let lastFrame = 0, lastPitchAt = 0, listenOnsetDetector = null;
  // Drum-kit mic path: a persistent onset detector and classifier (both
  // stateful, so they live here rather than being rebuilt every tick) plus a
  // small rolling raw-sample ring the classifier reads its one analysis frame
  // from. drumMicHits is a short debug trail (see the __DEBUG_HOOK__ below),
  // not used for judging -- onHit()/tickKitBar() are the source of truth.
  let drumOnsetDetector = null, drumClassifier = null, drumRing = null, drumMicHits = [];
  const DRUM_FRAME = 2048, DRUM_HOP = 512;
  function listen() {
    // A drum kit has no pitch for the worklet's YIN tracker to lock onto, so
    // it is checked first and returns either way: it must run even once
    // openMic() has built a pitch worklet (kit's ioBtn click opens the mic
    // for a real e-kit/room mic alongside MIDI -- see the ioBtn handler),
    // and it must NEVER fall through into the YIN path below.
    const km = MODS[mod]; if (km && km.kit && km.input === 'mic+midi') { listenDrums(); return; }
    if (pitchWorkletNode) return; // the worklet's own onmessage handler is feeding onPitch instead
    const M = MODS[mod]; if (!M || !micReady || !anTime || !(M.input === 'pluck' || M.input === 'sustain')) return; const t = now(), dt = Math.min(0.2, t - (lastPitchAt || t)); lastPitchAt = t;
    const buf = new Float32Array(anTime.fftSize); anTime.getFloatTimeDomainData(buf); const r = yin(buf, actx.sampleRate, M.fmin, M.fmax, gates.pitch);
    // F8 fallback parity: the worklet path has always fed onPitch an onset
    // flag (src/audio/pitch-worklet.js); this setInterval path never did, so
    // fr.onset at src/app.js's pluck branch was permanently false whenever
    // the worklet failed to load, silently killing the F8 re-pluck detector.
    // The worklet feeds the SAME detector a true continuous stream in small
    // 512-sample hops (~11.6ms @44.1kHz), so one loud attack is only ever a
    // sliver of its ~500ms adaptive-threshold history. getFloatTimeDomainData
    // instead hands this setInterval the analyser's current ROLLING window
    // (its newest fftSize samples ending now) once every ~50ms: pushing that
    // whole window as one "frame" would smear an attack across several
    // mostly-identical overlapping reads, and even pushing just the newest
    // ~50ms slice makes each attack a much larger fraction of a shorter
    // history, inflating the adaptive threshold right when the SAME attack's
    // own flux spike is still in it. Splitting the newest audio into the
    // worklet's own 512-sample hops and pushing each one separately (oldest
    // first) keeps the detector's timing assumptions the same on both paths.
    const HOP = 512;
    if (!listenOnsetDetector) listenOnsetDetector = createOnsetDetector({ sampleRate: actx.sampleRate, frameSize: HOP, hop: HOP });
    const newSamples = Math.max(0, Math.min(anTime.fftSize, Math.round((dt || 0.05) * actx.sampleRate)));
    const nHops = Math.floor(newSamples / HOP);
    let onset = false;
    for (let c = nHops - 1; c >= 0; c--) {
      const end = buf.length - c * HOP;
      const chunk = buf.subarray(end - HOP, end);
      if (listenOnsetDetector.push(chunk).onset) onset = true;
    }
    const fr = { rms: r.rms, freq: r.freq && r.clarity > 0.8 ? r.freq : 0, clarity: r.clarity, onset: onset }; if (fr.freq) fr.midi = fmidi(fr.freq);
    if (task && cur() && cur().info.kind === 'chord') { const db = new Float32Array(anFreq.frequencyBinCount); anFreq.getFloatFrequencyData(db); fr.chroma = chroma(db, actx.sampleRate); }
    meterUpdate(fr.rms);
    try { onPitch(fr, dt); } catch (e) { errCount++; recordError('onPitch', e); }
  }
  // Drum-kit mic path: same "split the analyser's newest audio into small
  // hops and push each one, oldest first" technique as listen()'s pluck
  // path above, but feeding src/audio/drum-classify.js instead of YIN -- a
  // kit has no pitch to lock onto, only onsets and their band-energy shape.
  //
  // classify() expects a frame that STARTS just before the attack (only a
  // small preroll, mostly looking forward): classifyHits() can do that
  // because it already has the whole recording. Live, at the moment an
  // onset is detected there IS no "forward" yet -- those samples have not
  // been captured. So classification is deliberately held for
  // (DRUM_FRAME - preroll) worth of audio (~41 ms) after the attack, queued
  // in drumPending, and only then read out of the analyser's rolling
  // window, which by then safely covers it. Confirmed by measurement: a
  // synthesized kick classified with the frame ending AT the attack (no
  // wait) came back kind: null half the time -- the attack sat in the last
  // Hann-windowed hop, exactly where the window weights it away.
  const DRUM_PREROLL = DRUM_FRAME >> 3;
  let drumPending = [];
  function listenDrums() {
    if (!micReady || !anTime) return; const t = now(), dt = Math.min(0.2, t - (lastPitchAt || t)); lastPitchAt = t;
    const buf = new Float32Array(anTime.fftSize); anTime.getFloatTimeDomainData(buf);
    const wait = (DRUM_FRAME - DRUM_PREROLL) / actx.sampleRate;
    // Tuning mirrors src/audio/drum-classify.js's own classifyHits() (that
    // file is not this unit's to change, so its two overrides on onset.js's
    // defaults -- ~100ms of flux history instead of ~1s, and a 0.0005 RMS
    // minFlux floor instead of 0.02 -- are repeated here, not imported: it
    // has no exported streaming entry point, only the whole-buffer driver.
    if (!drumOnsetDetector) drumOnsetDetector = createOnsetDetector({ sampleRate: actx.sampleRate, frameSize: DRUM_HOP, hop: DRUM_HOP, historyFrames: Math.max(4, Math.round(0.1 * actx.sampleRate / DRUM_HOP)), minFlux: 0.0005 });
    if (!drumClassifier) drumClassifier = createDrumClassifier({ sampleRate: actx.sampleRate, frameSize: DRUM_FRAME });
    const newSamples = Math.max(0, Math.min(anTime.fftSize, Math.round((dt || 0.05) * actx.sampleRate)));
    const nHops = Math.floor(newSamples / DRUM_HOP);
    let lastRms = 0;
    for (let c = nHops - 1; c >= 0; c--) {
      const end = buf.length - c * DRUM_HOP, chunk = buf.subarray(end - DRUM_HOP, end);
      let ss = 0; for (let i = 0; i < chunk.length; i++) ss += chunk[i] * chunk[i]; lastRms = Math.sqrt(ss / chunk.length);
      const o = drumOnsetDetector.push(chunk);
      if (!o.onset) continue;
      const attackT = t - c * (DRUM_HOP / actx.sampleRate);
      // classifyHits()'s REL_JUMP guard, repeated here for the same reason: the
      // tiny 0.0005 minFlux floor above (needed to keep hearing a quiet real
      // kit) also lets a STEADY tone or hum wobble over threshold; requiring
      // the flux spike to be a real jump relative to the samples around it
      // is what rejects that (measured in drum-classify.js: 0-2 false hits on
      // steady noise with this check, 2-13 without it). frameE is read from
      // whatever of the frame this hop's snapshot already covers -- close
      // enough for a relative-jump check, not the classifier's own input.
      let frameE = 0; const fs = buf.subarray(Math.max(0, end - DRUM_FRAME), end); for (let i = 0; i < fs.length; i++) frameE += fs[i] * fs[i];
      if (o.strength < 0.1 * Math.sqrt(frameE / DRUM_FRAME)) continue;
      drumPending.push({ attackT: attackT, dueT: attackT + wait });
    }
    meterUpdate(lastRms);
    // Drain whatever pending onsets have now waited long enough to classify.
    drumPending = drumPending.filter(p => {
      if (t < p.dueT) return true;
      const offset = Math.max(0, Math.round((t - p.dueT) * actx.sampleRate)), from = Math.max(0, buf.length - offset - DRUM_FRAME), fend = from + DRUM_FRAME;
      const r = drumClassifier.classify(buf.subarray(from, Math.min(buf.length, fend)));
      handleDrumHit(r.kind, r.confidence, p.attackT);
      return false;
    });
  }
  // A mic hit names kick, snare or hi-hat (kind non-null, confidence always
  // >= 0.5 by drum-classify.js's construction) or comes back kind null
  // ("a hit, could not tell which drum") -- either way it is still a real
  // hit at a real time, so it always reaches onHit(); tickKitBar()'s
  // tapMatches() is what judges an unnamed hit leniently against a
  // tom/crash/ride onset rather than as a miss.
  function handleDrumHit(kind, confidence, t) {
    const piece = kind ? DRUM_KIND_TO_PIECE[kind] || null : null;
    drumMicHits.push({ piece: piece, confidence: confidence, t: t }); if (drumMicHits.length > 50) drumMicHits.shift();
    onHit(piece, t, 'mic');
  }
  setInterval(listen, 50);
  function frame() {
    const t = performance.now(), dt = Math.min(0.1, (t - (lastFrame || t)) / 1000); lastFrame = t;
    try { if (playing) tick(dt); draw(); }
    catch (e) { errCount++; recordError('frame', e); task = null; try { S = DB.mods[mod] = sanitizeModel(mod, S, modelNow); } catch (e2) {} if (errCount > 4 && playing) { errCount = 0; takeBreak('error'); } }
    if (paused) tickBreak(); requestAnimationFrame(frame);
  }

  // ---------- drawing ----------
  const cv = $('cv'), g = cv.getContext('2d'); let keyRects = [], rowRects = [], playRects = [], lastStaff = null, kbdOverviewRect = null;
  cv.tabIndex = 0; // item 3 (Wave W, w-fixes): keyboard-reachable so a keyboard-only learner can play the on-screen piano
  // item 3 (Wave W, w-fixes): a keyboard-driven focus cursor over the current keyRects, sorted left to right.
  let kbdFocusIdx = 0;
  // item B2 (Wave kbd): once the octave below is unlocked, keyRects holds two
  // stacked rows (row 0 the left-hand octave, row 1 the right-hand octave --
  // see kbdRange()/the kbd branch of draw() below); order.row is undefined
  // on the single-octave layout, so `(a.row || 0)` leaves that case sorted by
  // x exactly as before. Two rows traverse left row low-to-high, then right
  // row low-to-high, never interleaved by x across rows.
  const kbdOrder = () => keyRects.slice().sort((a, b) => (a.row || 0) - (b.row || 0) || a.x - b.x);
  function kbdKeyName(k, idx, total) { return DB.prefs.names ? nname(k.m) + (pc(k.m) === 0 ? (Math.floor(k.m / 12) - 1) : '') : (k.black ? 'black' : 'white') + ' key ' + (idx + 1) + ' of ' + total; }
  function kbdFocusInfo() { if (mod !== 'kbd') return null; const order = kbdOrder(); if (!order.length) return null; if (kbdFocusIdx >= order.length) kbdFocusIdx = 0; const k = order[kbdFocusIdx]; return { idx: kbdFocusIdx, total: order.length, m: k.m, black: k.black, x: k.x, y: k.y, w: k.w, h: k.h, name: kbdKeyName(k, kbdFocusIdx, order.length) }; }
  function size() { const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(r.width * d), h = Math.round(r.height * d); if (w && h && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; } }
  function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // canvas pixels per CSS pixel (2 on a phone, 1 on a plain desktop): a size floor in canvas pixels is half as big on screen at 2, so floors are written in CSS pixels times this
  const cssK = () => cv.width / (cv.getBoundingClientRect().width || cv.width);
  const font = (px, w) => { g.font = (w || 700) + ' ' + Math.round(px) + 'px "Barlow Condensed", Arial, sans-serif'; };
  const accent = () => (MODS[mod] || TOOLS[mod]).color;
  const recentPress = m => pressed[m] && performance.now() - pressed[m] < 220;
  // The [lo, hi] MIDI range the on-screen keyboard is currently drawing (used
  // both by draw() below and by onNote()'s "heard but not shown" message --
  // a note outside this range never lights up no matter how it arrived).
  const kbdRange = () => [48, 72]; // always two octaves (C3-C5) so a beginner sees both hands' zones from level 1; judged notes/levels/hand gates are unchanged
  // `o.row`/`o.hand` ('lh'/'rh') tag every keyRect this call produces -- unset
  // on the single-octave layout, 0/'lh' or 1/'rh' when draw()'s kbd branch
  // calls this twice for the two labelled rows below. Callers reset keyRects
  // once per frame (draw()'s own `keyRects = []`), so two calls in the same
  // frame accumulate both rows rather than the second overwriting the first.
  // `o.rhMidi`/`o.lhMidi` (a hands-together task's two revealed/failed
  // targets) get an "R"/"L" mark drawn on the key itself, so which hand a lit
  // target belongs to is never colour alone.
  function drawKeys(x0, y0, w, h, lo, hi, o) {
    const isW = m => [0, 2, 4, 5, 7, 9, 11].indexOf(pc(m)) >= 0; let nW = 0; for (let m = lo; m <= hi; m++) if (isW(m)) nW++; const kw = w / nW; let i = 0; const xs = {};
    for (let m = lo; m <= hi; m++) if (isW(m)) { xs[m] = x0 + i * kw; i++; }
    const fill = (m, base) => o.target.indexOf(m) >= 0 ? accent() : o.good.indexOf(m) >= 0 ? '#5be08a' : recentPress(m) ? '#9fb4d8' : base;
    const markFor = m => o.rhMidi === m ? 'R' : o.lhMidi === m ? 'L' : null;
    for (let m = lo; m <= hi; m++) if (isW(m)) { rr(xs[m] + 1, y0, kw - 2, h, 4); g.fillStyle = fill(m, '#e9edf6'); g.fill(); const mk = markFor(m); if (mk) { g.fillStyle = '#06101d'; font(kw * 0.4, 800); g.textAlign = 'center'; g.fillText(mk, xs[m] + kw / 2, y0 + kw * 0.46); } keyRects.push({ m: m, x: xs[m], y: y0, w: kw, h: h, black: false, row: o.row, hand: o.hand, mark: mk }); if (o.names) { g.fillStyle = '#3a4363'; font(kw * 0.34, 600); g.textAlign = 'center'; g.fillText(nname(m) + (pc(m) === 0 ? (Math.floor(m / 12) - 1) : ''), xs[m] + kw / 2, y0 + h - kw * 0.2); } }
    for (let m = lo; m <= hi; m++) if (!isW(m) && xs[m - 1] !== undefined) { const bx = xs[m - 1] + kw * 0.68; rr(bx, y0, kw * 0.64, h * 0.62, 3); g.fillStyle = fill(m, '#10131c'); g.fill(); g.strokeStyle = '#05070c'; g.lineWidth = 1; g.stroke(); const mk = markFor(m); if (mk) { g.fillStyle = '#e9edf6'; font(kw * 0.32, 800); g.textAlign = 'center'; g.fillText(mk, bx + kw * 0.32, y0 + h * 0.62 * 0.52); } keyRects.unshift({ m: m, x: bx, y: y0, w: kw * 0.64, h: h * 0.62, black: true, row: o.row, hand: o.hand, mark: mk }); }
  }
  // item D2 (Wave kbd): a full 88-key (A0-C8, MIDI 21-108) strip, drawn once
  // per frame under the rows, marking the [lo, hi] window the rows above are
  // currently showing -- so a learner sees where those one or two octaves
  // sit inside the whole keyboard, not just their names. Purely decorative:
  // it pushes nothing into keyRects, so it adds no hit rects and no new
  // arrow-key focus stop. The marked window is set off by both a brighter
  // fill and a stroked outline, never colour alone.
  function drawKbdOverview(x0, y0, w, h, lo, hi) {
    const isW = m => [0, 2, 4, 5, 7, 9, 11].indexOf(pc(m)) >= 0; let nW = 0; for (let m = 21; m <= 108; m++) if (isW(m)) nW++; const kw = w / nW; let i = 0; const xs = {};
    for (let m = 21; m <= 108; m++) if (isW(m)) { xs[m] = x0 + i * kw; i++; }
    const loW = isW(lo) ? lo : lo - 1, hiW = isW(hi) ? hi : hi + 1;
    g.fillStyle = '#1b2130'; g.fillRect(x0, y0, w, h);
    g.fillStyle = accent(); g.fillRect(xs[loW], y0, xs[hiW] + kw - xs[loW], h);
    g.strokeStyle = '#e9edf6'; g.lineWidth = 2; g.strokeRect(xs[loW] + 1, y0 + 1, xs[hiW] + kw - xs[loW] - 2, h - 2);
    kbdOverviewRect = { x: x0, y: y0, w: w, h: h, lo: 21, hi: 108, win: { lo: lo, hi: hi, x: xs[loW], y: y0, w: xs[hiW] + kw - xs[loW], h: h } };
  }
  function drawFret(M, e, W, H) {
    const ns = M.tuning.length, nf = M.frets, x0 = W * 0.15, x1 = W * 0.97, y0 = H * 0.16, y1 = H * 0.84, fx = f => f === 0 ? x0 - W * 0.035 : x0 + (x1 - x0) * ((f - 0.5) / nf), sy = s => y0 + (y1 - y0) * ((s - 1) / (ns - 1));
    rr(x0, y0 - H * 0.05, x1 - x0, y1 - y0 + H * 0.1, 6); g.fillStyle = '#2a1c12'; g.fill();
    [3, 5, 7, 9, 12].forEach(f => { if (f > nf) return; g.fillStyle = '#ffffff22'; g.beginPath(); g.arc(fx(f), (y0 + y1) / 2 + (f === 12 ? -H * 0.12 : 0), H * 0.022, 0, 7); g.fill(); if (f === 12) { g.beginPath(); g.arc(fx(f), (y0 + y1) / 2 + H * 0.12, H * 0.022, 0, 7); g.fill(); } });
    // Fretless (bowed) fingerboards draw only the nut, not a grid of fret
    // wires that do not exist: the dot() calls below still place notes at
    // the same fx(f) x-coordinates (f is a semitone position, not a real
    // fret), just with nothing drawn under them to claim a fret is there.
    if (M.fretless) { const x = x0; g.strokeStyle = '#e9edf6'; g.lineWidth = 6; g.beginPath(); g.moveTo(x, y0 - H * 0.05); g.lineTo(x, y1 + H * 0.05); g.stroke(); }
    else for (let f = 0; f <= nf; f++) { const x = x0 + (x1 - x0) * f / nf; g.strokeStyle = f === 0 ? '#e9edf6' : '#8a8f99'; g.lineWidth = f === 0 ? 6 : 2; g.beginPath(); g.moveTo(x, y0 - H * 0.05); g.lineTo(x, y1 + H * 0.05); g.stroke(); if (f > 0) { g.fillStyle = '#93a0bd'; font(H * 0.05, 600); g.textAlign = 'center'; g.fillText(String(f), fx(f), H * 0.97); } }
    for (let s = 1; s <= ns; s++) { g.strokeStyle = '#c9ced9'; g.lineWidth = 1 + (s / ns) * 3; g.beginPath(); g.moveTo(x0 - W * 0.06, sy(s)); g.lineTo(x1, sy(s)); g.stroke(); g.fillStyle = '#93a0bd'; font(H * 0.055, 600); g.textAlign = 'right'; g.fillText(s + (DB.prefs.names ? '  ' + nname(M.tuning[ns - s]) : ''), x0 - W * 0.07, sy(s) + H * 0.02); }
    const dot = (s, f, col, txt, a) => { g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.arc(fx(f), sy(s), H * 0.05, 0, 7); g.fill(); g.globalAlpha = 1; if (txt) { g.fillStyle = '#06101d'; font(H * 0.05); g.textAlign = 'center'; g.fillText(txt, fx(f), sy(s) + H * 0.018); } };
    if (heard && heard.freq && MODS[mod].input === 'pluck') { const p = pc(heard.midi); for (let s = 1; s <= ns; s++) for (let f = 0; f <= nf; f++) if (pc(M.tuning[ns - s] + f) === p) dot(s, f, '#9fb4d8', '', 0.25); }
    if (e && e.info.kind === 'note' && (e.reveal || e.failed)) { if (e.info.string) dot(e.info.string, e.info.fret, accent(), DB.prefs.names ? nname(e.info.midi) : '', 1); else for (let s = 1; s <= ns; s++) for (let f = 0; f <= nf; f++) if (pc(M.tuning[ns - s] + f) === pc(e.info.midi)) dot(s, f, accent(), '', 0.85); }
    if (e && e.info.kind === 'chord') { g.fillStyle = '#e9edf6'; font(H * 0.2); g.textAlign = 'center'; g.fillText(e.info.sym, W * 0.5, H * 0.56); if (typeof e.score === 'number') { g.fillStyle = '#05070c'; rr(W * 0.3, H * 0.66, W * 0.4, H * 0.04, 4); g.fill(); g.fillStyle = e.score > 0.5 ? '#5be08a' : accent(); rr(W * 0.3, H * 0.66, W * 0.4 * c01(e.score), H * 0.04, 4); g.fill(); } }
  }
  // `offScale` (a reading beyond +-50 cents) draws a triangle pointing off
  // the edge instead of the round dot -- shape, not just colour, marks it,
  // since the dot would otherwise just clamp silently to the rail.
  function gauge(x, y, w, cents, label, offScale) { g.fillStyle = '#05070c'; rr(x, y, w, 16, 8); g.fill(); g.fillStyle = '#5be08a55'; g.fillRect(x + w * 0.5 - w * 0.06, y, w * 0.12, 16); g.strokeStyle = '#e9edf6'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + w / 2, y - 5); g.lineTo(x + w / 2, y + 21); g.stroke(); if (cents !== null) { const px = x + w / 2 + clamp(cents / 50, -1, 1) * w / 2; g.fillStyle = Math.abs(cents) < 10 ? '#5be08a' : Math.abs(cents) < 30 ? '#f3c52f' : '#ff6b5e'; if (offScale) { const dir = cents > 0 ? 1 : -1; g.beginPath(); g.moveTo(px, y + 8 - 10); g.lineTo(px + dir * 13, y + 8); g.lineTo(px, y + 8 + 10); g.closePath(); g.fill(); } else { g.beginPath(); g.arc(px, y + 8, 11, 0, 7); g.fill(); } } const fs = Math.max(13 * cssK(), cv.width * 0.017); g.fillStyle = '#93a0bd'; font(fs, 600); g.textAlign = 'left'; g.fillText('flat', x, y + 22 + fs); g.textAlign = 'right'; g.fillText('sharp', x + w, y + 22 + fs); g.textAlign = 'center'; g.fillStyle = '#e9edf6'; font(fs * 1.25, 700); const maxW = 2 * Math.min(x + w / 2, cv.width - x - w / 2) - 8; let lines = [label || '']; if (g.measureText(lines[0]).width > maxW && lines[0].includes(' ')) { const wd = lines[0].split(' '); let best = null; for (let i = 1; i < wd.length; i++) { const two = [wd.slice(0, i).join(' '), wd.slice(i).join(' ')], m = Math.max(g.measureText(two[0]).width, g.measureText(two[1]).width); if (!best || m < best.m) best = { two, m }; } lines = best.two; } const lw = Math.max(...lines.map(l => g.measureText(l).width)); if (lw > maxW) font(fs * 1.25 * maxW / lw, 700); lines.forEach((l, i) => g.fillText(l, x + w / 2, y - 14 - (lines.length - 1 - i) * fs * 1.45)); }
  function liveCents(target, exact) { if (!heard || !heard.freq) return null; let c = (heard.midi - target) * 100; if (!exact) c = ((c + 600) % 1200 + 1200) % 1200 - 600; return c; }
  function drawVoice(e, W, H) {
    const VKd = Object.assign({}, VOICE_KINDS, DB.prefs.voiceRange ? { mine: ['My range (found by test)', tonicFromRange(exerciseRangeFor(DB.prefs.voiceRange)).tonic] } : {}), base = (VKd[DB.prefs.voice] || VKd.low)[1], rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], y = d => H * 0.9 - (H * 0.8) * d / 12;
    rows.forEach(d => { const dia = SOLFA[d] !== undefined, tgt = e && e.info.degree === d; g.fillStyle = tgt ? accent() + '55' : dia ? '#ffffff0d' : '#00000000'; g.fillRect(W * 0.16, y(d) - H * 0.03, W * 0.8, H * 0.06); if (dia || tgt) { g.fillStyle = tgt ? accent() : '#93a0bd'; font(H * 0.055, tgt ? 700 : 600); g.textAlign = 'right'; g.fillText((SOLFA[d] || '') + (DB.prefs.names ? ' ' + nname(base + d) : ''), W * 0.15, y(d) + H * 0.02, W * 0.14); } });
    if (heard && heard.freq) { let dd = heard.midi - base; dd = ((dd % 12) + 12) % 12; if (e && e.info.degree === 12 && dd < 1) dd += 12; g.fillStyle = '#e9edf6'; g.beginPath(); g.arc(W * 0.56, y(dd), H * 0.03, 0, 7); g.fill(); g.strokeStyle = '#e9edf6'; g.lineWidth = 2; g.beginPath(); g.moveTo(W * 0.16, y(dd)); g.lineTo(W * 0.96, y(dd)); g.stroke(); }
    if (e) { const need = task.kind === 'hold' ? 2 : 0.5; g.fillStyle = '#5be08a'; g.fillRect(W * 0.16, H * 0.965, W * 0.8 * c01(holdFor / need), H * 0.02); }
    // "Find my range" runs entirely through this per-frame draw call (its
    // only hook into the real per-frame `heard` signal) rather than a
    // polling loop: handleRangeTest('tick', ...) records held-note samples,
    // and the learner sees exactly what the mic is hearing right now, never
    // a state that just says "connected" with nothing behind it.
    if (rangeTest) { handleRangeTest('tick', heard); const heldS = rangeTest.curMidi !== null ? Math.round((performance.now() - rangeTest.curSince) / 100) / 10 : 0; const label = heard && heard.freq ? 'Hearing ' + nname(Math.round(heard.midi)) + (heldS >= 0.4 ? ', held ' + heldS + 's' : '') : 'Listening for your voice...'; g.fillStyle = '#e9edf6'; font(H * 0.05, 600); g.textAlign = 'center'; g.fillText((rangeTest.stage === 'low' ? 'Sing your lowest note -- ' : 'Sing your highest note -- ') + label, W * 0.5, H * 0.06); }
  }
  // M: the current mod's MODS[mod] record. Reads M.writtenOffset for items
  // whose info() has no `written`/`clef` of its own (plain 'n' ids -- see
  // the R3 recorder/tin-whistle contract in this function's caller): such an
  // item is written at info.midi + (M.writtenOffset || 0) on the treble
  // staff, same as a staff mod with real `written`/`clef` data (the 'w' ids
  // this trio and MODS.wind use).
  function drawStaff(M, e, W, H) {
    const clef = (e && e.info.clef) || 'treble', sp = H * 0.075, yb = H * 0.62, x0 = W * 0.08, x1 = W * 0.6, bottomStep = clef === 'bass' ? 18 : 30;
    g.strokeStyle = '#c9ced9'; g.lineWidth = 2; for (let l = 0; l < 5; l++) { g.beginPath(); g.moveTo(x0, yb - l * sp); g.lineTo(x1, yb - l * sp); g.stroke(); }
    g.fillStyle = '#e9edf6'; g.textAlign = 'left'; g.save(); g.translate(x0 + sp * 1.2, yb); g.scale(sp / 10, sp / 10); g.strokeStyle = '#e9edf6'; g.lineWidth = 2; g.stroke(new Path2D(CLEF_PATHS[clef])); g.restore(); // vector clef: a Unicode music symbol is an empty box on a device with no music font
    const els = task ? task.els : []; els.forEach((el, k) => { const m = el.info.written !== undefined ? el.info.written : el.info.midi + (M.writtenOffset || 0), nm = NAMES[pc(m)], letter = 'CDEFGAB'.indexOf(nm[0]), oct = Math.floor(m / 12) - 1, step = oct * 7 + letter, y = yb - (step - bottomStep) * sp / 2, x = x0 + (x1 - x0) * (0.32 + 0.6 * (k + 0.5) / els.length), isCur = k === task.idx;
      g.strokeStyle = '#c9ced9'; for (let s2 = bottomStep - 2; s2 >= step; s2 -= 2) { g.beginPath(); g.moveTo(x - sp * 0.95, yb - (s2 - bottomStep) * sp / 2); g.lineTo(x + sp * 0.95, yb - (s2 - bottomStep) * sp / 2); g.stroke(); } for (let s3 = bottomStep + 10; s3 <= step; s3 += 2) { g.beginPath(); g.moveTo(x - sp * 0.95, yb - (s3 - bottomStep) * sp / 2); g.lineTo(x + sp * 0.95, yb - (s3 - bottomStep) * sp / 2); g.stroke(); }
      g.fillStyle = k < task.idx ? '#5be08a' : isCur ? accent() : '#e9edf6'; g.beginPath(); g.ellipse(x, y, sp * 0.62, sp * 0.45, -0.35, 0, 7); g.fill(); g.strokeStyle = g.fillStyle; g.lineWidth = 3; g.beginPath(); if (step < bottomStep + 4) { g.moveTo(x + sp * 0.58, y); g.lineTo(x + sp * 0.58, y - sp * 3.2); } else { g.moveTo(x - sp * 0.58, y); g.lineTo(x - sp * 0.58, y + sp * 3.2); } g.stroke();
      if (nm.length > 1) { font(sp * 1.5, 600); g.textAlign = 'right'; g.fillText(nm[1], x - sp * 0.85, y + sp * 0.45); } if (DB.prefs.names) { font(sp * 0.9, 600); g.textAlign = 'center'; g.fillStyle = '#93a0bd'; g.fillText(nname(m, true), x, Math.min(H * 0.985, Math.max(yb + sp * 3.2, y + sp * 1.5))); } }); // label baseline drops below a low notehead (G3 on clarinet/horn) instead of sitting on it
    if (e) { const c = liveCents(e.info.midi, false); gauge(W * 0.66, H * 0.42, W * 0.3, c, c === null ? 'play a note' : Math.abs(c) < 10 ? 'in tune' : Math.round(Math.abs(c)) + ' cents ' + (c > 0 ? 'sharp' : 'flat')); const need = task.kind === 'hold' ? 2 : 0.5; g.fillStyle = '#5be08a'; g.fillRect(W * 0.66, H * 0.3, W * 0.3 * c01(holdFor / need), H * 0.025); }
  }
  function drawHarp(e, W, H) {
    const hk = (Number.isInteger(DB.prefs.harpKey) && DB.prefs.harpKey >= 0 && DB.prefs.harpKey <= 11) ? DB.prefs.harpKey : 0, layout = harpLayoutFor(hk);
    const x0 = W * 0.06, w = W * 0.88, hw = w / 10, y0 = H * 0.36, hh = H * 0.3; rr(x0 - 10, y0 - 14, w + 20, hh + 28, 14); g.fillStyle = '#8f96a3'; g.fill(); rr(x0 - 2, y0, w + 4, hh, 6); g.fillStyle = '#1b1e26'; g.fill();
    for (let h = 1; h <= 10; h++) { const x = x0 + (h - 1) * hw, tb = e && e.info.hole === h && (e.reveal || e.failed); rr(x + hw * 0.16, y0 + hh * 0.2, hw * 0.68, hh * 0.6, 4); g.fillStyle = tb ? accent() : '#05070c'; g.fill(); g.fillStyle = '#e9edf6'; font(H * 0.07); g.textAlign = 'center'; g.fillText(String(h), x + hw / 2, y0 - H * 0.06);
      if (DB.prefs.names) { g.fillStyle = '#93a0bd'; font(H * 0.042, 600); g.fillText('↑ ' + nname(layout[h - 1].blow), x + hw / 2, y0 + hh + H * 0.1); g.fillText('↓ ' + nname(layout[h - 1].draw), x + hw / 2, y0 + hh + H * 0.17); } }
    if (e) { const x = x0 + (e.info.hole - 0.5) * hw, up = e.info.dir === 'b'; g.fillStyle = accent(); font(H * 0.2); g.textAlign = 'center'; g.fillText(up ? '↑' : '↓', x, up ? y0 - H * 0.13 : y0 - H * 0.13); font(H * 0.06); g.fillStyle = '#e9edf6'; g.fillText(up ? 'BLOW' : 'DRAW', x + hw * 1.3, y0 - H * 0.17); const c = liveCents(e.info.midi, true); g.fillStyle = '#5be08a'; g.fillRect(x0, H * 0.95, w * c01(holdFor / (task.kind === 'hold' ? 2 : 0.5)), H * 0.025); if (heard && heard.freq) { font(H * 0.05, 600); g.fillStyle = '#93a0bd'; g.textAlign = 'left'; g.fillText('Hearing ' + nname(heard.midi, true) + (c !== null && Math.abs(c) < 100 ? ', ' + Math.round(Math.abs(c)) + ' cents ' + (c > 0 ? 'sharp' : 'flat') : ''), x0, H * 0.1); } }
  }
  function drawEar(W, H) { const t = task; if (t && t.revealed && t.played) { drawKeys(W * 0.05, H * 0.3, W * 0.9, H * 0.5, 48, 84, { target: t.played, good: [], names: DB.prefs.names }); g.fillStyle = '#e9edf6'; font(H * 0.09); g.textAlign = 'center'; g.fillText(t.played.map(m => nname(m)).join('  →  '), W / 2, H * 0.18); } else { g.fillStyle = accent(); font(H * 0.5); g.textAlign = 'center'; g.fillText('?', W / 2, H * 0.66); g.strokeStyle = accent(); g.lineWidth = 4; if (reducedMotion) { g.beginPath(); g.arc(W / 2, H * 0.5, H * 0.35, 0, 7); g.stroke(); } else { const k = (performance.now() / 600) % 1; g.globalAlpha = 1 - k; g.beginPath(); g.arc(W / 2, H * 0.5, H * (0.3 + 0.15 * k), 0, 7); g.stroke(); g.globalAlpha = 1; } } }
  function drawBar(W, H) {
    if (!bar || !task) return; const x0 = W * 0.08, x1 = W * 0.94, bw = (x1 - x0) / 4, y = H * 0.48, t = now(), stem = H * 0.26, nh = H * 0.045;
    g.strokeStyle = '#c9ced9'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 - 10, y); g.lineTo(x1 + 10, y); g.stroke(); g.lineWidth = 4; g.beginPath(); g.moveTo(x0 - 10, y - H * 0.2); g.lineTo(x0 - 10, y + H * 0.2); g.moveTo(x1 + 10, y - H * 0.2); g.lineTo(x1 + 10, y + H * 0.2); g.stroke();
    for (let b = 0; b < 4; b++) { g.fillStyle = '#93a0bd'; font(H * 0.07, 600); g.textAlign = 'center'; g.fillText(String(b + 1), x0 + (b + 0.12) * bw, H * 0.93); }
    const X = beat => x0 + (beat + 0.12) * bw; g.fillStyle = '#e9edf6'; g.strokeStyle = '#e9edf6';
    task.els.forEach(e => { const c = e.info.cell, b0 = e.b0, col = bar.judged ? (e.failed ? '#ff6b5e' : '#5be08a') : '#e9edf6'; g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 3;
      const head = (beat, hollow) => { g.beginPath(); g.ellipse(X(beat), y, nh * 1.35, nh, -0.35, 0, 7); if (hollow) { g.lineWidth = 4; g.stroke(); g.lineWidth = 3; } else g.fill(); g.beginPath(); g.moveTo(X(beat) + nh * 1.25, y); g.lineTo(X(beat) + nh * 1.25, y - stem); g.stroke(); };
      const beam = (a, b2, lvl) => { g.lineWidth = H * 0.028; g.beginPath(); g.moveTo(X(a) + nh * 1.25, y - stem + lvl * H * 0.05); g.lineTo(X(b2) + nh * 1.25, y - stem + lvl * H * 0.05); g.stroke(); g.lineWidth = 3; };
      const flag = beat => { g.beginPath(); g.moveTo(X(beat) + nh * 1.25, y - stem); g.quadraticCurveTo(X(beat) + nh * 3.4, y - stem * 0.7, X(beat) + nh * 2.4, y - stem * 0.35); g.stroke(); };
      const rest8 = beat => { font(H * 0.16, 600); g.textAlign = 'center'; g.fillText('•', X(beat), y - H * 0.02); g.beginPath(); g.moveTo(X(beat) + 3, y - H * 0.05); g.lineTo(X(beat) - nh, y + H * 0.1); g.stroke(); };
      if (c === 'q') head(b0); else if (c === 'h') head(b0, true); else if (c === 'qr') { g.beginPath(); g.moveTo(X(b0) - nh, y - H * 0.1); g.lineTo(X(b0) + nh, y - H * 0.03); g.lineTo(X(b0) - nh, y + H * 0.03); g.lineTo(X(b0) + nh, y + H * 0.1); g.stroke(); }
      else if (c === 'ee') { head(b0); head(b0 + 0.5); beam(b0, b0 + 0.5, 0); } else if (c === 'ssss') { [0, 0.25, 0.5, 0.75].forEach(o => head(b0 + o)); beam(b0, b0 + 0.75, 0); beam(b0, b0 + 0.75, 1); }
      else if (c === 'dqe') { head(b0); g.beginPath(); g.arc(X(b0) + nh * 2.6, y, nh * 0.4, 0, 7); g.fill(); head(b0 + 1.5); flag(b0 + 1.5); } else if (c === 'ree') { rest8(b0); head(b0 + 0.5); flag(b0 + 0.5); }
      else if (c === 'ess') { head(b0); head(b0 + 0.5); head(b0 + 0.75); beam(b0, b0 + 0.75, 0); beam(b0 + 0.5, b0 + 0.75, 1); } else if (c === 'sse') { head(b0); head(b0 + 0.25); head(b0 + 0.5); beam(b0, b0 + 0.5, 0); beam(b0, b0 + 0.25, 1); }
      else if (c === 'eqe') { head(b0); flag(b0); head(b0 + 0.5); head(b0 + 1.5); flag(b0 + 1.5); } });
    if (bar.judged) { bar.onsets.forEach(o => { const beat = (o.t - bar.playAt) / bar.spb, onTime = o.hit !== null && Math.abs(o.hit) < 0.06, mark = o.hit === null ? '✗' : onTime ? '✓' : (o.hit < 0 ? 'early' : 'late'); g.fillStyle = o.hit === null ? '#ff6b5e' : onTime ? '#5be08a' : '#f3c52f'; const mx = X(beat) - 3 + (o.hit || 0) / bar.spb * bw; g.fillRect(mx, y + H * 0.2, 6, H * 0.08); font(H * 0.032, 700); g.textAlign = 'center'; g.fillText(mark, mx + 3, y + H * 0.2 - 4); }); bar.taps.filter(tp => !tp.used).forEach(tp => { g.fillStyle = '#ff6b5e'; font(H * 0.07); g.textAlign = 'center'; g.fillText('×', X((tp.t - bar.playAt) / bar.spb), y + H * 0.28); }); }
    if (t < bar.playAt) { const left = Math.ceil((bar.playAt - t) / bar.spb); g.fillStyle = accent(); font(H * 0.22); g.textAlign = 'center'; g.fillText(String(clamp(left, 1, 4)), W * 0.5, H * 0.22); } else if (t < bar.end) { const px = X((t - bar.playAt) / bar.spb - 0); g.strokeStyle = accent(); g.lineWidth = 3; g.beginPath(); g.moveTo(px, y - H * 0.34); g.lineTo(px, y + H * 0.2); g.stroke(); bar.taps.forEach(tp => { g.fillStyle = '#93a0bd'; g.fillRect(X((tp.t - bar.playAt) / bar.spb) - 2, y + H * 0.2, 4, H * 0.06); }); }
  }
  // rests, ties, triplet brackets, dots and the time signature, for the rhythm-vocabulary bars
  // The bar on a percussion staff (top), the kit from above (bottom): the bar's drums outlined, filled
  // while the count-in runs, the piece just hit flashing; after judging, a mark under each note.
  // what each drawn piece is called on the kit (a beginner reads the name; the key letter is only a hint)
  const KIT_DRAW_NAMES = { kick: ['Kick'], snare: ['Snare'], 'hihat-closed': ['Hi-hat', 'closed'], 'hihat-pedal': ['Hi-hat', 'pedal'], 'hihat-open': ['Hi-hat', 'open'], 'tom-floor': ['Floor tom', '', 'l'], 'tom-mid': ['Mid tom'], 'tom-high': ['High tom', '', 'l'], crash: ['Crash'], ride: ['Ride'] };
  function drawKit(W, H) {
    const on = bar && task && task.kind === 'kit' && bar.staff, t = now(), pre = on && t < bar.playAt, want = {}, bw = W * 0.94, bh = on ? H * 0.62 : H * 0.9, box = { x: (W - bw) / 2, y: on ? H * 0.37 : (H - bh) / 2, w: bw, h: bh, s: bh }, m = Math.min(bw, bh);
    kitBox = box; kitLabels = []; if (on) { bar.kitBox = box; bar.onsets.forEach(o => o.pieces.forEach(p => { want[p] = 1; }));
      const sc = Math.min(W * 0.9 / 400, H * 0.33 / 130), x0 = (W - 400 * sc) / 2, y0 = H * 0.02;
      g.save(); g.translate(x0, y0); g.scale(sc, sc); g.strokeStyle = '#c9ced9'; g.fillStyle = '#e9edf6'; g.lineWidth = 1.5 / sc; drawPrimitives(g, bar.staff, {}); g.restore();
      bar.onsets.forEach((o, i) => { const x = x0 + (bar.noteX[i] || 0) * sc; if (o.flam) { g.fillStyle = '#93a0bd'; font(11 * sc, 700); g.textAlign = 'center'; g.fillText('flam', x, y0 + 10 * sc); } if (!bar.judged || !o.res) return; const bad = o.res.some(r => r.dt === undefined), off = Math.max(...o.res.map(r => Math.abs(r.dt || 0))); g.fillStyle = bad ? '#ff6b5e' : off > 0.05 ? '#f3c52f' : '#5be08a'; g.beginPath(); g.arc(x, y0 + 122 * sc, 5 * sc, 0, 7); g.fill(); }); }
    // the layout is a unit square stretched to the box (x by width, y by height); circles stay round, sized by the shorter side
    kitLayout().forEach(p => { const x = box.x + spreadX(p.x) * bw, y = box.y + p.y * bh, rr = p.r * m, flash = kitFlash.piece === p.id && performance.now() - kitFlash.at < 160, lit = flash || (pre && want[p.id]);
      g.beginPath(); g.arc(x, y, rr, 0, 7); g.fillStyle = flash ? '#f3c52f' : lit ? '#f08a4b' : p.shape === 'cymbal' ? '#2a3140' : '#1b2130'; g.fill(); g.strokeStyle = want[p.id] ? '#f08a4b' : '#93a0bd'; g.lineWidth = want[p.id] ? 3 : 1.5; g.stroke();
      const nm = KIT_DRAW_NAMES[p.id], fs = Math.max(13, m * 0.05), key = KIT.find(k => k.id === p.id).key.toUpperCase(); font(fs, 700); const tw = g.measureText(nm[0]).width, inside = tw + 6 <= rr * 2 && !nm[1] && !nm[2], left = nm[2] === 'l';
      // a name that does not fit in its circle is written beside it (to the right), never squeezed or overlapping its neighbours
      g.fillStyle = inside && lit ? '#05070c' : '#e9edf6'; if (inside) { g.textAlign = 'center'; g.fillText(nm[0], x, y - fs * 0.05); kitLabels.push({ id: p.id, x: x - tw / 2, y: y - fs * 1.05, w: tw, h: fs * 1.2 }); } else { const lx = left ? x - rr - 5 : x + rr + 5; g.textAlign = left ? 'right' : 'left'; g.fillText(nm[0], lx, y - (nm[1] ? 1 : -fs * 0.35)); let lw = tw; if (nm[1]) { font(Math.max(11, fs * 0.85), 400); g.fillText(nm[1], lx, y + fs * 0.95); lw = Math.max(tw, g.measureText(nm[1]).width); } kitLabels.push({ id: p.id, x: left ? lx - lw : lx, y: y - fs * 1.05, w: lw, h: nm[1] ? fs * 2.2 : fs * 1.2 }); }
      font(Math.max(11, m * 0.034), 700); g.textAlign = 'center'; g.fillStyle = lit ? '#05070c' : '#f3c52f'; g.fillText(key, x, inside ? y + rr - Math.max(4, m * 0.012) : y + 4); });
  }
  function drawBar2(W, H) {
    if (!bar || !task) return; const x0 = W * 0.1, x1 = W * 0.94, y = H * 0.48, t = now(), stem = H * 0.26, nh = H * 0.045;
    const total = RHY.totalTicks(bar.phrase.events) || 1, X = tick => x0 + (tick / total) * (x1 - x0);
    g.strokeStyle = '#c9ced9'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 - 10, y); g.lineTo(x1 + 10, y); g.stroke();
    bar.phrase.bars.forEach((b, i) => { const bx = i === 0 ? x0 - 10 : X(RHY.totalTicks(bar.phrase.events.slice(0, b.start))); g.lineWidth = i === 0 || i === bar.phrase.bars.length - 1 ? 4 : 2; g.beginPath(); g.moveTo(bx, y - H * 0.2); g.lineTo(bx, y + H * 0.2); g.stroke(); });
    g.lineWidth = 4; g.beginPath(); g.moveTo(x1 + 10, y - H * 0.2); g.lineTo(x1 + 10, y + H * 0.2); g.stroke();
    g.fillStyle = '#93a0bd'; font(H * 0.09, 700); g.textAlign = 'center'; g.fillText(bar.metre.split('/')[0], x0 - 25, y - H * 0.06); g.fillText(bar.metre.split('/')[1], x0 - 25, y + H * 0.11);
    let cursor = 0; const tripletGroups = [];
    bar.phrase.events.forEach((ev, i) => {
      const startTick = cursor, col = bar.judged ? (task.els[0].failed ? '#ff6b5e' : '#5be08a') : '#e9edf6'; g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 3;
      const dotted = ev.dur === 720 || ev.dur === 360 || ev.dur === 1440;
      if (ev.rest) {
        if (ev.dur >= 960) { g.fillRect(X(startTick), ev.dur >= 1920 ? y + H * 0.03 : y - H * 0.06, nh * 1.6, H * 0.045); }
        else { font(H * 0.16, 600); g.textAlign = 'center'; g.fillText('•', X(startTick) + nh, y - H * 0.02); g.beginPath(); g.moveTo(X(startTick) + nh + 3, y - H * 0.05); g.lineTo(X(startTick), y + H * 0.1); g.stroke(); }
      } else if (!ev.tied) {
        const hollow = ev.dur >= 960; g.beginPath(); g.ellipse(X(startTick), y, nh * 1.35, nh, -0.35, 0, 7); if (hollow) { g.lineWidth = 4; g.stroke(); g.lineWidth = 3; } else g.fill();
        if (ev.dur < 1920) { g.beginPath(); g.moveTo(X(startTick) + nh * 1.25, y); g.lineTo(X(startTick) + nh * 1.25, y - stem); g.stroke(); }
        if (ev.dur <= 240) { g.beginPath(); g.moveTo(X(startTick) + nh * 1.25, y - stem); g.quadraticCurveTo(X(startTick) + nh * 3.4, y - stem * 0.7, X(startTick) + nh * 2.4, y - stem * 0.35); g.stroke(); }
      }
      if (dotted) { g.beginPath(); g.arc(X(startTick) + nh * 2.6, ev.rest ? y - H * 0.06 : y, nh * 0.4, 0, 7); g.fill(); }
      if (ev.triplet) { if (!tripletGroups.length || tripletGroups[tripletGroups.length - 1].last !== i - 1) tripletGroups.push({ first: i, firstTick: startTick, last: i }); else tripletGroups[tripletGroups.length - 1].last = i, tripletGroups[tripletGroups.length - 1].lastTick = startTick; }
      // a tied event draws a curve from the previous sounding head to here, showing the note continues
      if (ev.tied) { const px = X(startTick) - (total / 40); g.beginPath(); g.moveTo(px, y - nh * 1.6); g.quadraticCurveTo((px + X(startTick)) / 2, y - nh * 2.6, X(startTick) + nh, y - nh * 1.6); g.stroke(); }
      cursor += ev.dur;
    });
    tripletGroups.forEach(grp => { const x2 = X(grp.lastTick != null ? grp.lastTick : grp.firstTick) + nh * 1.3, x1t = X(grp.firstTick); g.strokeStyle = '#93a0bd'; g.lineWidth = 2; g.beginPath(); g.moveTo(x1t, y - stem * 1.15); g.lineTo(x2, y - stem * 1.15); g.stroke(); g.fillStyle = '#93a0bd'; font(H * 0.06, 700); g.textAlign = 'center'; g.fillText('3', (x1t + x2) / 2, y - stem * 1.25); });
    if (bar.judged) { bar.onsets.forEach(o => { const tick = Math.round(((o.t - bar.playAt) / (bar.end - 0.3 - bar.playAt)) * total); g.fillStyle = o.hit === null ? '#ff6b5e' : Math.abs(o.hit) < 0.06 ? '#5be08a' : '#f3c52f'; g.fillRect(X(tick) - 3, y + H * 0.2, 6, H * 0.08); }); bar.taps.filter(tp => !tp.used).forEach(tp => { g.fillStyle = '#ff6b5e'; font(H * 0.07); g.textAlign = 'center'; g.fillText('×', X(((tp.t - bar.playAt) / (bar.end - 0.3 - bar.playAt)) * total), y + H * 0.28); }); }
    if (t < bar.playAt) { const left = Math.ceil((bar.playAt - t) / bar.spb); g.fillStyle = accent(); font(H * 0.22); g.textAlign = 'center'; g.fillText(String(clamp(left, 1, bar.countBeats)), W * 0.5, H * 0.22); }
    else if (t < bar.end) { const tick = ((t - bar.playAt) / (bar.end - 0.3 - bar.playAt)) * total; g.strokeStyle = accent(); g.lineWidth = 3; g.beginPath(); g.moveTo(X(tick), y - H * 0.34); g.lineTo(X(tick), y + H * 0.2); g.stroke(); }
  }
  // Overlay staff for the five wired instruments (NOTATE_MOD_IDS), additive
  // to each instrument's existing drawing so today's display is unchanged
  // when the preference is left at 'names'. Never prints the letter name
  // unless the app's own reveal flag says so.
  // True when the staff overlay is on for any wired instrument, so draw()
  // gives the staff its own top band (0..0.42H) and the instrument the rest.
  // The keyboard's grand staff is twice as tall, so it gets 0.55H, the rest 0.42H.
  // The keyboard's band also leaves its keys >= 24 CSS px tall (the tap floor): 90 CSS px of key area, since the two rows are 0.27 of it.
  const staffBandH = (m, H) => m === 'kbd' ? Math.min(0.55, 1 - 90 * (cv.width / (cv.getBoundingClientRect().width || cv.width)) / H) : 0.42;
  const staffBand = m => NOTATE_MOD_IDS.indexOf(m) >= 0 && (DB.prefs.notate[m] || 'names') !== 'names';
  function drawNotation(e, W, H) {
    lastStaff = null;
    if (!e || e.info.kind !== 'note' || e.info.midi === null || e.info.midi === undefined) return;
    const notate = DB.prefs.notate[mod] || 'names';
    if (notate === 'names') return;
    const rec = instrumentById[mod];
    if (!rec) return;
    const out = forInstrument(rec, e.info.midi, { item: e.info, width: 280 });
    if (!out) return;
    const nameShown = notate === 'both' && DB.prefs.names && !!(e.reveal || e.failed);
    lastStaff = Object.assign({ nameShown: nameShown }, out);
    // The instrument's own drawing is moved down out of the way (draw()),
    // so its staff takes the top band: -20..115 staff units tall, never
    // wider than the canvas. Everything else keeps the original origin.
    const band = staffBand(mod), scale = band ? Math.min(H * (mod === 'kbd' ? 0.0023 : 0.0027), W * 0.9 / 280) : H * 0.0075, x0 = W * 0.05, y0 = band ? H * 0.02 + 20 * scale : H * 0.06;
    g.save();
    g.translate(x0, y0); g.scale(scale, scale);
    g.strokeStyle = '#c9ced9'; g.fillStyle = '#e9edf6'; g.lineWidth = 1.5 / scale;
    drawPrimitives(g, out.primitives, {});
    if (out.tab) drawPrimitives(g, out.tab.primitives, {});
    g.restore();
    if (nameShown) {
      g.fillStyle = '#93a0bd'; font(H * 0.05, 600); g.textAlign = 'left';
      g.fillText(nname(e.info.midi), x0, band ? H * (staffBandH(mod, H) - 0.02) : y0 + H * 0.34);
    }
  }
  let kbdTargetDbg = []; // last keyboard target list drawn (debug hook only)
  function draw() {
    cv.classList.toggle('staffkbd', staffBand('kbd') && mod === 'kbd'); size(); const W = cv.width, H = cv.height; g.clearRect(0, 0, W, H); rowRects = []; keyRects = []; kbdOverviewRect = null;
    if (TOOLS[mod]) { if (mod === 'tuner') drawTuner(W, H); else drawCapture(W, H); return; }
    const M = MODS[mod], e = playing && task && !task.done ? cur() : null, showE = e || (task && task.done ? task.els[task.els.length - 1] : null);
    if (mod === 'kbd') { const kr = kbdRange(), sb = staffBand('kbd'), oy = sb ? H * staffBandH('kbd', H) : 0, Hk = sb ? H * (1 - staffBandH('kbd', H)) : H; const tg = []; let rhMidi = null, lhMidi = null; if (e && !(task.kind === 'groove')) { if (e.info.kind === 'chord') { if (e.reveal || e.failed) e.info.pcs.forEach(x => tg.push(60 + x)); } else if (e.info.kind === 'hands-together') { if (e.reveal || e.failed) { tg.push(e.info.ex.rh.midi, e.info.ex.lh.midi); rhMidi = e.info.ex.rh.midi; lhMidi = e.info.ex.lh.midi; } } else if (e.reveal || e.failed) tg.push(e.info.midi); } if (task && task.kind === 'groove' && !task.done) task.els.forEach(x => { if (x.info.midi && (x.reveal || x.failed)) tg.push(x.info.midi); }); kbdTargetDbg = tg; const good = performance.now() - flashGood < 300 && task ? task.els.slice(0, task.idx).map(x => x.info.midi).filter(x => x) : []; const kOpts = { target: tg, good: good, names: DB.prefs.names, rhMidi: rhMidi, lhMidi: lhMidi };
      if (kr[0] === 48) {
        // item B2 (Wave kbd): once the octave below is unlocked (level 8+, or
        // a custom captured melody below middle C) a single 15-white-key strip
        // put ~21px between white keys on a 340px-wide phone canvas -- under
        // the 24px WCAG 2.5.8 (2.2 AA) tap-target floor #283 already holds
        // every other control in the app to (see "## On-screen keyboard" in
        // README.md). Two always-drawn, always-labelled rows of at most 8
        // white keys each keep every key at or above that floor by
        // construction, and name which hand's octave each row is -- the
        // layout depends only on kr (kbdRange()), never on task/task.idx, so
        // neither row ever moves mid-phrase. item D2 (Wave kbd): a phone
        // canvas still left the narrowest key just under a 40px floor at
        // W*0.03/W*0.94 -- W*0.02/W*0.96 clears it (340*0.96/8 = 40.8px).
        const x0 = W * 0.02, rowW = W * 0.96, labelH = Hk * 0.07, gap = Hk * 0.02, rowH = (Hk * 0.7 - 2 * labelH - gap) / 2;
        const label = (text, ly) => { g.fillStyle = '#93a0bd'; font(labelH * 0.55, 600); g.textAlign = 'left'; g.fillText(text, x0, ly + labelH * 0.72); };
        const y0 = oy + Hk * 0.18, y1 = y0 + labelH, y2 = y1 + rowH + gap, y3 = y2 + labelH;
        label('Left hand · ' + nname(48, true) + '–' + nname(59, true), y0);
        drawKeys(x0, y1, rowW, rowH, 48, 59, Object.assign({}, kOpts, { row: 0, hand: 'lh' }));
        label('Right hand · ' + nname(60, true) + ' · middle C – ' + nname(72, true), y2);
        drawKeys(x0, y3, rowW, rowH, 60, 72, Object.assign({}, kOpts, { row: 1, hand: 'rh' }));
      } else drawKeys(W * 0.02, oy + Hk * 0.18, W * 0.96, Hk * 0.7, kr[0], kr[1], kOpts);
      drawKbdOverview(W * 0.02, oy + Hk * 0.905, W * 0.96, Hk * 0.07, kr[0], kr[1]);
      if (e && e.info.kind === 'chord') { g.fillStyle = '#e9edf6'; font(Hk * 0.11); g.textAlign = 'center'; g.fillText(e.info.sym, W / 2, oy + Hk * 0.13); } if (document.activeElement === cv) { const fi = kbdFocusInfo(); if (fi) { g.strokeStyle = '#ffd23f'; g.lineWidth = 4; g.strokeRect(fi.x + 2, fi.y + 2, fi.w - 4, fi.h - 4); } } }
    else if (M.tuning) { if (staffBand(mod)) { g.save(); g.translate(0, H * 0.42); drawFret(M, e, W, H * 0.58); g.restore(); } else drawFret(M, e, W, H); } else if (mod === 'voice') { if (staffBand(mod)) { g.save(); g.translate(0, H * 0.42); drawVoice(e, W, H * 0.58); g.restore(); } else drawVoice(e, W, H); } else if (M.staff) drawStaff(M, e, W, H); else if (mod === 'harp') drawHarp(e, W, H);
    else if (mod === 'mallet-percussion') { const rec = instrumentById['mallet-percussion'], tg = e && e.info.kind === 'note' && (e.reveal || e.failed) ? [e.info.midi] : []; drawKeys(W * 0.03, H * 0.18, W * 0.94, H * 0.7, rec.range.low, rec.range.high, { target: tg, good: [], names: DB.prefs.names }); }
    else if (M.kit) drawKit(W, H);
    else if (mod === 'ear') drawEar(W, H); else if (mod === 'rhy') { if (task && task.kind === 'bar2') drawBar2(W, H); else drawBar(W, H); }
    if (NOTATE_MOD_IDS.indexOf(mod) >= 0) drawNotation(e, W, H); else lastStaff = null;
    if (!reducedMotion && performance.now() - flashBad < 220) { g.strokeStyle = '#ff6b5e'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8); g.fillStyle = '#ff6b5e'; font(H * 0.06, 700); g.textAlign = 'left'; g.fillText('✗', 14, H * 0.09); } else if (!reducedMotion && performance.now() - flashGood < 220) { g.strokeStyle = '#5be08a'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8); g.fillStyle = '#5be08a'; font(H * 0.06, 700); g.textAlign = 'left'; g.fillText('✓', 14, H * 0.09); }
    if (!playing && !(rangeTest && mod === 'voice')) { g.fillStyle = '#93a0bd'; font(H * 0.08); g.textAlign = 'right'; g.fillText(sess ? 'PAUSED' : 'PRESS START', W * 0.97, H * 0.1); }
  }

  // ---------- tools: tuner and melody capture ----------
  let tunerKind = 'gtr', tuned = {}, tunerState = null, tunerLock = null, cap = { on: false, notes: [], curM: -1, curN: 0, t0: 0, start: 0 }, customOn = false, chunk = 0;
  // dt is seconds (see the tuner's setInterval poll below), stepTuner wants ms.
  function toolPitch(fr, dt) {
    heard = fr;
    if (mod === 'tuner') {
      if (deafWindow.isDeaf()) return; // F5: never let the tap-a-row reference tone re-tune itself
      const tg = TUNINGS[tunerKind][1];
      tunerState = stepTuner(tunerState, fr.freq ? fr : null, dt * 1000, { targets: tg, lockedIdx: tunerLock, confirmMs: 600, toleranceCents: 5, holdWindowMs: 1500 });
      if (tunerState.phase === 'holding') { if (tg.length) { if (tunerState.selIdx !== null) tuned[tunerKind + tunerState.selIdx] = true; } else tuned[tunerKind] = true; }
      return;
    }
    if (mod === 'capture' && cap.on) {
      const t = now(), m = fr.freq ? Math.round(fr.midi) : -1;
      if (m === cap.curM) cap.curN++; else { if (cap.curM >= 0 && cap.curN >= 2 && cap.notes.length < 300) cap.notes.push({ m: cap.curM, t: cap.t0 - cap.start, d: t - cap.t0 }); cap.curM = m; cap.curN = 1; cap.t0 = t; }
      capCount();
    }
  }
  // The 'N notes.' label beside the Practise-on menu, kept live while listening (counts the note being held).
  function capCount() { const l = $('capTo') && $('capTo').parentElement; if (l && l.firstChild) l.firstChild.textContent = (cap.notes.length + (cap.on && cap.curM >= 0 && cap.curN >= 2 ? 1 : 0)) + ' notes. Practise on '; }
  function capStop() { if (cap.on && cap.curM >= 0 && cap.curN >= 2) cap.notes.push({ m: cap.curM, t: cap.t0 - cap.start, d: now() - cap.t0 }); cap.on = false; cap.curM = -1; const merged = []; cap.notes.forEach(n => { const l = merged[merged.length - 1]; if (l && l.m === n.m && n.t - (l.t + l.d) < 0.12) l.d = n.t + n.d - l.t; else if (n.d >= 0.09) merged.push(n); }); cap.notes = merged; renderOpts(); }
  // A tap on the row's name area toggles LOCK to that string (tap again to
  // unlock); a tap on the separate note-icon target plays the reference
  // tone -- kept apart so the mic hearing that tone back can never re-lock
  // or re-tune the reading it is itself about to hear (see deafWindow above).
  function drawTuner(W, H) {
    const tg = TUNINGS[tunerKind][1], n = tg.length, st = tunerState || {}; rowRects = []; playRects = [];
    const activeIdx = tunerLock !== null ? tunerLock : st.selIdx;
    if (n) tg.forEach((m, i) => { const y = H * 0.1 + i * (H * 0.8 / n), h = H * 0.8 / n - 8, ok = tuned[tunerKind + i], sel = i === activeIdx && st.phase && st.phase !== 'idle'; const playW = Math.min(Math.max(W * 0.05, 22 * cssK()), h); const rowW = W * 0.38 - playW - 10; rr(W * 0.05, y, W * 0.38, h, 8); g.fillStyle = ok ? '#5be08a' : sel ? '#2a3350' : '#121726'; g.fill(); g.fillStyle = ok ? '#04130a' : '#e9edf6'; let rowTxt = 'String ' + (n - i) + '   ' + nname(m, true) + (ok ? '   in tune' : '') + (tunerLock === i ? '   LOCKED' : ''), rfs = Math.min(H * 0.08, H * 0.34 / n); font(rfs); g.textAlign = 'left'; const rmax = W * 0.05 + rowW - W * 0.07 - 4; let rtw = g.measureText(rowTxt).width; if (ok && rtw > rmax && rfs * rmax / rtw < 9 * cssK()) { rowTxt = rowTxt.replace('   in tune', '   \u2713'); rtw = g.measureText(rowTxt).width; } if (rtw > rmax) font(rfs * rmax / rtw); g.fillText(rowTxt, W * 0.07, y + h * 0.62); g.fillStyle = '#93a0bd44'; rr(W * 0.05 + rowW + 8, y + 2, playW, h - 4, 6); g.fill(); g.fillStyle = '#e9edf6'; g.textAlign = 'center'; font(Math.min(H * 0.06, H * 0.28 / n)); g.fillText('♪', W * 0.05 + rowW + 8 + playW / 2, y + h * 0.6); rowRects.push({ x: W * 0.05, y: y, w: rowW, h: h, m: m, idx: i }); playRects.push({ x: W * 0.05 + rowW + 8, y: y + 2, w: playW, h: h - 4, m: m }); });
    if (st.phase === 'idle' || st.midi === null || !micReady) { gauge(W * 0.45, H * 0.62, W * 0.5, null, !micReady ? 'press Set up input, then Connect microphone' : tunerLock !== null && n ? 'locked: play ' + nname(tg[tunerLock], true) : 'play one string'); return; }
    const target = st.targetMidi, c = st.cents, offScale = Math.abs(c) > 50;
    const label = (Math.abs(c) <= 5 ? 'in tune' : Math.round(Math.abs(c)) + ' cents ' + (c > 0 ? 'sharp, loosen it' : 'flat, tighten it')) + (offScale ? ' (off scale)' : '');
    // Age (ms since the last confident reading) fades the readout instead of
    // blanking it outright -- a dropped poll used to wipe the whole tuner.
    g.globalAlpha = clamp(1 - (st.ageMs || 0) / 1500, 0.25, 1);
    g.fillStyle = '#e9edf6'; font(H * 0.3); g.textAlign = 'center'; g.fillText(nname(target), W * 0.7, H * 0.45);
    gauge(W * 0.45, H * 0.62, W * 0.5, clamp(c, -50, 50), label, offScale);
    const progress = clamp((st.holdMs || 0) / 600, 0, 1), barY = H * 0.85, barW = W * 0.5;
    g.fillStyle = '#05070c'; rr(W * 0.45, barY, barW, 10, 5); g.fill();
    g.fillStyle = st.phase === 'holding' ? '#5be08a' : '#7c8db5'; if (progress > 0) { rr(W * 0.45, barY, Math.max(10, barW * progress), 10, 5); g.fill(); }
    g.fillStyle = '#93a0bd'; font(Math.max(11 * cssK(), H * 0.03), 600); g.textAlign = 'left'; g.fillText(st.phase === 'holding' ? 'tuned, holding' : Math.round(progress * 100) + '% to confirm', W * 0.45, barY + 10 + H * 0.035);
    g.globalAlpha = 1;
  }
  function drawCapture(W, H) {
    const ns = cap.notes; g.fillStyle = '#93a0bd'; font(H * 0.06, 600); g.textAlign = 'left';
    if (!ns.length && !cap.on) { g.fillText(micReady ? 'Press Listen, then play or sing a tune, one note at a time.' : 'Press Set up input, then Connect microphone, then Listen.', W * 0.05, H * 0.5); return; }
    let lo = 127, hi = 0; ns.forEach(x => { lo = Math.min(lo, x.m); hi = Math.max(hi, x.m); }); if (!ns.length) { lo = 55; hi = 72; } lo -= 2; hi += 2; const T = Math.max(6, ns.length ? ns[ns.length - 1].t + ns[ns.length - 1].d : 0, cap.on ? now() - cap.start : 0), X = t => W * 0.08 + (W * 0.9) * t / T, Y = m => H * 0.9 - (H * 0.78) * (m - lo) / (hi - lo);
    for (let m = lo; m <= hi; m++) if (pc(m) === 0) { g.strokeStyle = '#252d47'; g.beginPath(); g.moveTo(W * 0.08, Y(m)); g.lineTo(W * 0.98, Y(m)); g.stroke(); g.fillText(nname(m, true), W * 0.01, Y(m) + 6); }
    ns.forEach(x => { rr(X(x.t), Y(x.m) - H * 0.02, Math.max(6, X(x.t + x.d) - X(x.t)), H * 0.04, 4); g.fillStyle = '#35c9c0'; g.fill(); if (DB.prefs.names && ns.length < 60) { g.fillStyle = '#e9edf6'; font(H * 0.04, 600); g.fillText(nname(x.m), X(x.t), Y(x.m) - H * 0.03); } });
    if (cap.on) { g.strokeStyle = '#ff6b5e'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(now() - cap.start), H * 0.08); g.lineTo(X(now() - cap.start), H * 0.94); g.stroke(); if (heard && heard.freq) { g.fillStyle = '#e9edf6'; g.beginPath(); g.arc(X(now() - cap.start), Y(clamp(heard.midi, lo, hi)), 6, 0, 7); g.fill(); } }
  }
  function buildTask() {
    if (grooveOn && groovable(mod)) return buildGrooveTask();
    if (customOn && DB.custom && DB.custom.length) {
      const ids = DB.custom.map(m => customItem(mod, m, DB.prefs)).filter(x => x), n = ids.length; if (n) { if (chunk * 4 >= n) { chunk = 0; coach('That was the whole tune. Back to the top.'); } const part = ids.slice(chunk * 4, chunk * 4 + 4), t = { kind: 'seq', els: [], idx: 0, warm: true, custom: true, limit: 10, ref: 'target', blind: false, t0: now(), done: false };
        part.forEach(id => { S.tick++; it(id, modelNow).seen = S.tick; t.els.push({ id: id, info: inf(id), failed: false, t0: 0, rt: 0, reveal: true }); }); t.onDone = () => { if (!t.els.some(e => e.failed)) chunk++; else say('Same four notes again until they are clean.', ''); }; return t; }
    }
    return buildLevelTask();
  }
  const _finish = finishTask; finishTask = function () { const t = task; _finish(); if (t && t.onDone) t.onDone(); };

  // ---------- sessions, pauses and breaks ----------
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  const dayKey = d => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  function todayMinutes() { const t = today(); let m = 0; DB.sessions.forEach(x => { if (x.d === t) m += x.min; }); return m + (sess ? sess.active / 60 : 0); }
  function dayStreak() { const days = {}; DB.sessions.forEach(x => { days[x.d] = 1; }); if (sess) days[today()] = 1; let n = 0; const d = new Date(); while (days[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); } return n; }
  const tiredPattern = () => { const l = DB.sessions.slice(-3); return l.length === 3 && l.every(x => x.min >= 20 && x.a2 < x.a1 - 0.1); };
  // pathwayLineShown: has this page load already shown the keyboard pathway's
  // "Welcome back" line? Set once startSession() shows it, so a learner who
  // pauses/resumes or ends and restarts a session mid-visit is not told the
  // same "next step" line over and over -- see the returning-learner test.
  let pathwayLineShown = false;
  function startSession() {
    refreshModelClock(); ensureAudio(); sess = newSession(); recent = []; streak = 0; errCount = 0; task = null; lastItem = null; lastInputAt = now(); chunk = 0; say('');
    // Session length E7c: the learner's own choice (DB.prefs.sessionMinutes,
    // 0 meaning no limit) sets today's target before the tired check below,
    // so tiredPattern()'s 15-minute cap only tightens it, never loosens it.
    sess.target = DB.prefs.sessionMinutes || 0;
    let msg = customOn ? 'Your captured melody: ' + DB.custom.length + ' notes, four at a time. Warm-up, does not count.' : 'Level ' + S.level + ': ' + D().name + '.'; if (tiredPattern()) { sess.target = sess.target ? Math.min(sess.target, 15) : 15; msg = 'Your last three sessions each ended weaker than they started, which is what tired practice looks like. Today is capped at ' + sess.target + ' minutes. ' + msg; } else if (todayMinutes() >= 45) msg = 'You already have ' + Math.round(todayMinutes()) + ' minutes in today. Keep this one short. ' + msg;
    if (S.judged > 5 && !customOn) { sess.warm = 4; msg += ' First a short warm-up through what you know; it does not count.'; }
    // A returning keyboard learner (a prior kbd session logged on an earlier
    // day) is told, once per page load, which keyboard-path step comes next
    // (src/core/pathway.js's pathwayState) -- plain English literals plus
    // the one existing t('review.unreviewed') key, so no new i18n key is
    // needed for this.
    if (mod === 'kbd' && !pathwayLineShown && DB.sessions.some(r => r && r.mod === 'kbd' && r.d < today())) {
      const ps = pathwayState({ events: DB.events, sessions: DB.sessions, midiProof: midiPortInputs.some(i => midiHeard.has(i)), level: S.level, now: modelNow });
      const outcome = kbdPathwayOutcomes().find(o => o.value.step === ps.step);
      if (outcome) msg = 'Welcome back. Next on your keyboard path: ' + outcome.value.text + (outcomeReviewed(outcome.id) ? '' : ' ' + t('review.unreviewed')) + ' ' + msg;
      pathwayLineShown = true;
    }
    // Plan this sitting (review what's due, the weakest active skill, apply it, check it,
    // and, on keyboard, a suggested starter song) -- pure, so it only needs today's active
    // ids/items/events/sessions, not anything DOM/task-shaped.
    sessionPlan = planSession({ instrumentId: mod, level: S.level, activeIds: activeItems(mod, S.level), items: S.item, now: modelNow, due: due, sessions: DB.sessions, today: today(), songFor: mod === 'kbd' ? (lvl => { const e = songFor(lvl); if (!e) return null; const s = starterSongs.find(x => x.id === e.songId); return { songId: e.songId, title: s ? s.title : e.songId }; }) : undefined });
    planProgress = { review: 0, weak: 0, apply: 0, check: 0 };
    // `seen`: has this learner any item record at this level yet? A fresh
    // profile's empty plan is a first sitting, not a day off (curriculum.js).
    if (!customOn) msg += ' ' + describePlan(sessionPlan, id => inf(id).short, { seen: activeItems(mod, S.level).some(id => !!S.item[id]) });
    const why = describeWhy(sessionPlan, id => inf(id).short); if (why && !customOn) msg += ' ' + why;
    // The song block's own unreviewed label, matching the same test the
    // hand-off button's own note uses (renderOpts, app.js:2109 as of this
    // writing) -- the suggestion is teaching content no player has checked,
    // so it is never claimed reviewed just because it appears in the plan.
    if (!customOn && mod === 'kbd' && sessionPlan.some(b => b.kind === 'song')) { const entry = songFor(S.level); if (entry && !isReviewCurrent(itemReview(entry.id, contentRev(entry)))) { const s = starterSongs.find(x => x.id === entry.songId); msg += ' ' + (s ? s.title : entry.songId) + ': ' + t('review.unreviewed'); } }
    // Start is a choice of the instrument on screen: shut the sheet and own the label, so the exercise is on screen.
    pickerAsSheet = true; setInstrumentSheetOpen(false); updateNavInstrumentLabel();
    diagInputFrames = []; diagLastState = null; diagSince = null; diagShown = null; // a new sitting starts the mic diagnosis afresh
    playing = true; paused = false; $('playBtn').textContent = 'Pause'; $('endBtn').hidden = false; coach(msg); showAll(); wakeLock.acquire();
  }
  // logSession(): a panel (e.g. a song lesson) logs its own practice as a
  // DB.sessions row the same way endSession() below logs a built-in drill's
  // -- a1/a2 both get the panel's own single accuracy number (a panel has
  // no separate "first 30" vs "last 30" split to report), from/to both get
  // that instrument's CURRENT level (a song lesson does not move S.level),
  // and breaks is always 0 (no break tracking runs while a panel is open).
  // `source`/`songId` ride along for a reader that wants to tell a song
  // session from a drill session apart.
  function logSession(rec) {
    const modState = DB.mods[rec.mod], level = modState ? modState.level : 1, acc = num(rec.acc, 0, 0, 1);
    DB.sessions.push({ d: today(), mod: rec.mod, min: Math.round(num(rec.minutes, 0, 0, 600) * 10) / 10, acc: acc, a1: acc, a2: acc, from: level, to: level, breaks: 0, source: rec.source || 'song', songId: rec.songId || null });
    DB.sessions = DB.sessions.slice(-60); save();
  }
  // logEvent(ev): the one versioned learning-event record (plan 6.4,
  // src/core/learning-events.js) for a single judged attempt -- a built-in
  // drill's finishTask() and a song panel's judged step (see
  // src/ui/songs.js's `api.logEvent` call) both push through here. A row
  // that fails validateEvent() is dropped, not thrown, same as a bad
  // DB.sessions row -- a caller bug must never crash a practice session.
  function logEvent(ev) {
    const check = validateEvent(ev); if (!check.ok) { recordError('logEvent', new Error('dropped invalid event -- ' + check.errors.join('; '))); return; }
    DB.events.push(ev); DB.events = boundEvents(DB.events, { skillMap: KBD_SONG_SKILL_MAP, skillMapInstrument: 'kbd' }); save();
  }
  function endSession() {
    if (!sess) return; const min = sess.active / 60; let line = 'Session ended. Too short to log.';
    if (sess.judged >= 8) { DB.sessions.push({ d: today(), mod: mod, min: Math.round(min * 10) / 10, acc: sess.ok / sess.judged, a1: mean(sess.first), a2: mean(sess.last), from: sess.from, to: S.level, breaks: sess.breaks }); DB.sessions = DB.sessions.slice(-60);
      let up = null, low = null, lowR = 1; Object.keys(S.item).forEach(id => { const cur = S.item[id], r1 = retrievability(cur, modelNow), r0 = retrievability(sess.m0[id] || cur, modelNow), g0 = r1 - r0; if (up === null || g0 > up.g) up = { id: id, g: g0 }; if (cur.reps >= 3 && (low === null || r1 < lowR)) { low = id; lowR = r1; } });
      line = 'Session done: ' + Math.round(min * 10) / 10 + ' min, ' + Math.round(100 * sess.ok / sess.judged) + '% right, best streak ' + sess.bestStreak + ', level ' + sess.from + ' to ' + S.level + '.' + (up && up.g > 0.05 ? ' Most improved: ' + inf(up.id).short + '.' : '') + (low ? ' Next time starts with extra ' + inf(low).short + '.' : ''); }
    if (sess.judged >= 8 && Date.now() - lastBackupAt > 7 * 86400000) showBackupNudge('You have been practising a while. Save a backup, just in case.');
    sess = null; playing = false; paused = false; task = null; bar = null; breakTrap.deactivate(); $('breakCard').hidden = true; $('playBtn').textContent = 'Start'; $('endBtn').hidden = true; $('choices').hidden = true; $('prompt').textContent = ''; $('hint').textContent = ''; say(''); $('timeFill').style.width = '0%'; $('showMeBtn').hidden = true; $('howPeekHost').hidden = true; coach(line); save(); showAll(); wakeLock.release();
  }
  const BREAKS = {
    user: ['Paused', 'Take your time. A pause of 90 seconds or more counts as a break and resets your energy.', 0], away: ['You stepped away', 'Nothing came in for a while, so I paused. The exercise you left does not count against you.', 0], hidden: ['Paused', 'The page was hidden, so I stopped the clock. Nothing was counted while you were gone.', 0],
    error: ['Paused to recover', 'Something went wrong inside the trainer. It repaired its state and your progress is safe.', 0], tired: ['Break time: 2 minutes', '', 120], long: ['Break time: 5 minutes', '25 minutes without a break. Stand up, shake out your hands, get water. Practice past this point mostly rehearses mistakes.', 300], target: ['That is today\'s practice', 'Short and fresh beats long and tired. End here, or take a break and do one more block.', 300]
  };
  const breakTrap = createFocusTrap({ container: $('breakCard'), onEscape: () => resume() });
  function takeBreak(kind, mins) {
    if (!sess || paused) return; const b = BREAKS[kind]; playing = false; paused = true; pauseInfo = { at: Date.now(), secs: b[2] }; let why = b[1];
    if (kind === 'tired') why = 'Your accuracy slid from ' + Math.round(100 * sess.best30) + '% at your best today to ' + Math.round(100 * mean(sess.w30)) + '%' + (sess.bestRt && sess.rts.length >= 10 && median(sess.rts) > sess.bestRt * 1.3 ? ', and you are getting slower to answer' : '') + '. That pattern is fatigue, not lack of skill. Two minutes away fixes more than two more minutes of pushing.';
    if (kind === 'error') { const last = getErrors().slice(-1)[0]; if (last) why += ' Last error: ' + last.message; }
    // Session length E7c: the title names the real minute count the learner
    // chose (sess.target, captured by the caller above before it is zeroed)
    // instead of BREAKS.target's generic fallback string.
    let title = b[0]; if (kind === 'target' && mins) title = 'That is today\'s ' + mins + ' minutes';
    $('breakTitle').textContent = title; $('breakWhy').textContent = why; $('breakClock').hidden = !b[2]; $('snoozeBtn').hidden = !(kind === 'tired' || kind === 'long'); $('breakCard').hidden = false; $('playBtn').textContent = 'Resume'; task = null; bar = null; save(); showAll(); breakTrap.activate($('playBtn'));
  }
  function tickBreak() { if (!pauseInfo || !pauseInfo.secs) return; const left = Math.max(0, pauseInfo.secs - (Date.now() - pauseInfo.at) / 1000); $('breakClock').textContent = left > 0 ? Math.floor(left / 60) + ':' + ('0' + Math.floor(left % 60)).slice(-2) : 'Ready when you are'; }
  function resume() {
    const gone = pauseInfo ? (Date.now() - pauseInfo.at) / 1000 : 0; paused = false; playing = true; breakTrap.deactivate(); $('breakCard').hidden = true; $('playBtn').textContent = 'Pause'; ensureAudio(); task = null; lastInputAt = now();
    if (gone >= 90) { sess.breaks++; sess.sinceBreak = 0; sess.w30 = []; sess.best30 = 0; sess.rts = []; sess.bestRt = null; sess.tiredFor = 0; sess.failRun = 0; sess.warm = 3; coach('Welcome back after ' + (Math.round(gone / 6) / 10) + ' minutes. That counts as a real break, so your energy is reset. Three easy ones to warm back up.'); } else coach('Resuming level ' + S.level + '.');
    if (MODS[mod] && (MODS[mod].input === 'pluck' || MODS[mod].input === 'sustain') && !micReady && micHideReleased) coach($('coach').textContent + ' Your microphone was released while the page was hidden. Press Connect microphone to let me hear you again.'); // README: hiding the tab releases the mic; coming back does not reopen it
    pauseInfo = null; showAll();
  }

  // ---------- panels ----------
  // Theme J1: each instrument re-tints the page with its own brand colour
  // via --accent (below) -- a colour only ever picked to sit on the dark
  // stage as either a button BACKGROUND (with fixed dark text on top, so its
  // own contrast need doesn't depend on page theme) or as plain foreground
  // TEXT on the page ground (which does: the same colour that reads on a
  // near-black ground can fail 4.5:1 on the light palette's near-white one).
  // --accent-ink is the second reading of that same brand colour for the
  // text case only -- darkened (WCAG relative-luminance contrast, same
  // formula as tests/unit/theme-contrast.test.mjs) only when needed, so
  // --accent itself stays the raw brand colour everywhere buttons/fills use
  // it as a background. See src/styles.css for which selectors read which.
  function themeIsLight() { return DB.prefs.theme === 'light' || (DB.prefs.theme !== 'dark' && matchMedia('(prefers-color-scheme: light)').matches); }
  function accentInkFor(hex) { if (!themeIsLight()) return hex; const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255, lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }, lum = (rr, gg, bb) => 0.2126 * lin(rr) + 0.7152 * lin(gg) + 0.0722 * lin(bb), gl = 0.929, l = lum(r, g, b); return (Math.max(l, gl) + 0.05) / (Math.min(l, gl) + 0.05) >= 4.5 ? hex : '#' + [r, g, b].map(c => Math.round(c * 0.45).toString(16).padStart(2, '0')).join(''); }
  // --accent-display is the same brand colour for the 44px wordmark, which is
  // WCAG large text (3:1, not 4.5:1). It is darkened only as far as it takes
  // to reach 3:1, so COACH stays a near match for the Start button instead of
  // dropping to --accent-ink's navy (R10 P1).
  function accentDisplayFor(hex) { if (!themeIsLight()) return hex; const n = parseInt(hex.slice(1), 16), c0 = [(n >> 16) & 255, (n >> 8) & 255, n & 255], lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }, lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b), gl = 0.929; for (let k = 1; k > 0; k -= 0.02) { const c = c0.map(v => Math.round(v * k)); if ((gl + 0.05) / (lum(c) + 0.05) >= 3) return '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); } return '#000000'; }
  // The three accent properties on <html>; also re-run by the Theme control, since the light theme darkens the ink and a switch must not keep the old one.
  function applyAccent() { const accentRaw = (MODS[mod] || TOOLS[mod]).color === '#e9edf6' ? '#9fb4d8' : (MODS[mod] || TOOLS[mod]).color, st = document.documentElement.style; st.setProperty('--accent', accentRaw); st.setProperty('--accent-ink', accentInkFor(accentRaw)); st.setProperty('--accent-display', accentDisplayFor(accentRaw)); }
  function showAll() {
    const tool = !!TOOLS[mod];
    applyAccent();
    $('helpText').innerHTML = ''; const st = document.createElement('strong'); st.textContent = 'How this one works: '; $('helpText').appendChild(st); $('helpText').appendChild(document.createTextNode((MODS[mod] || TOOLS[mod]).help));
    document.querySelectorAll('.side .card, .side .stats, #playBtn, #resetBtn').forEach(el => { el.style.display = tool && !(mod === 'capture' && el.id === 'feedbackCard') ? 'none' : ''; }); $('tapPad').hidden = mod !== 'rhy'; $('timeFill').parentElement.style.visibility = tool || mod === 'rhy' || (MODS[mod] && MODS[mod].kit) ? 'hidden' : 'visible'; // capture's own messages ('Nothing captured yet.') need the feedback card; .hidden still hides it while empty
    if (tool) { $('prompt').textContent = ''; $('hint').textContent = mod === 'tuner' ? 'One open string at a time.' : 'One note at a time.'; $('choices').hidden = true; $('replayBtn').hidden = true; $('showMeBtn').hidden = true; $('howPeekHost').hidden = true; return; }
    const d = D(); $('levelNum').textContent = 'Level ' + S.level; $('levelName').textContent = customOn ? 'Your captured melody' : d.name; $('limitOut').textContent = d.task === 'bar' || mod === 'rhy' || MODS[mod].kit ? (d.bpm || 72) + ' bpm' : (d.limit || 8) + ' s per answer';
    const pct = Math.round(S.ready * 100); $('readyFill').style.width = pct + '%'; $('readyFill').style.background = S.ready < 0.25 ? 'var(--bad)' : S.ready < 0.6 ? 'var(--warn)' : 'var(--good)'; $('readyBar').setAttribute('aria-valuenow', pct);
    const e = sess ? 1 - sess.F : 1, ep = Math.round(e * 100); $('energyFill').style.width = ep + '%'; $('energyFill').style.background = e < 0.4 ? 'var(--bad)' : e < 0.65 ? 'var(--warn)' : 'var(--good)'; $('energyBar').setAttribute('aria-valuenow', ep);
    const ds = dayStreak(), lastS = DB.sessions.filter(x => x.mod === mod).slice(-1)[0];
    // R10 P7: a full green bar read as "done" before a single minute was
    // practised today -- full means the OPPOSITE, so a full bar gets its own
    // word ahead of the minutes, never just the colour, to say so.
    $('sessLine').textContent = (ep === 100 ? t('energy.full') + ' · ' : '') + (sess ? Math.floor(sess.active / 60) + ' min this session, ' + sess.breaks + ' break' + (sess.breaks === 1 ? '' : 's') + ' · ' : '') + Math.round(todayMinutes()) + ' min today' + (ds > 1 ? ' · ' + ds + ' days in a row' : '') + (lastS ? ' · last ' + MODS[mod].name.toLowerCase() + ' session ' + Math.round(100 * lastS.acc) + '%' : '');
    $('sAcc').textContent = recent.length ? Math.round(100 * mean(recent)) + '%' : '0%'; $('sStreak').textContent = streak; $('sRt').textContent = sess && sess.rts.length ? median(sess.rts).toFixed(1) : '-'; $('statsBlock').hidden = !recent.length;
    const act = activeItems(mod, S.level), weakEntries = []; act.forEach(id => { const o = S.item[id]; if (o && o.reps >= 2) weakEntries.push(Object.assign({}, o, { id: 'i:' + id, label: inf(id).short })); });
    Object.keys(S.trans).forEach(k => { const o = S.trans[k], ab = k.split('>'); if (o.reps >= 2 && act.indexOf(ab[0]) >= 0 && act.indexOf(ab[1]) >= 0) weakEntries.push(Object.assign({}, o, { id: 't:' + k, label: inf(ab[0]).short + ' → ' + inf(ab[1]).short })); });
    const rows = due(weakEntries, modelNow).filter(e => e.r < 0.7);
    const ul = $('weakList'); ul.innerHTML = ''; const li = (a, b, cls) => { const l = document.createElement('li'), s1 = document.createElement('span'), s2 = document.createElement('span'); if (cls) l.className = cls; s1.textContent = a; s2.textContent = b; l.appendChild(s1); l.appendChild(s2); ul.appendChild(l); };
    rows.slice(0, 4).forEach(r => li(r.label, Math.round(r.r * 100) + '%')); let top = null; Object.keys(S.conf).forEach(k => { if (S.conf[k] >= 3 && k.indexOf('>x') < 0 && (!top || S.conf[k] > S.conf[top])) top = k; });
    if (top) { const ab = top.split('>'); li('Mix-up: ' + (validId(mod, ab[0]) ? inf(ab[0]).short : ab[0]) + ' answered as ' + (validId(mod, ab[1]) ? inf(ab[1]).short : ab[1]), S.conf[top] + ' times'); }
    // The card itself, not a placeholder row, is the "nothing weak yet"
    // signal now -- an empty rail box says more than a row reading "nothing
    // weak yet" ever did (band-coach-ui-declutter-plan, U4).
    $('weakCard').hidden = !ul.children.length;
  }
  // "Find my range": a guided low-then-high sing-and-hold through the REAL
  // pitch detector, driven entirely through actions rather than a scatter of
  // small handlers, so the whole flow is the one new function this unit adds
  // (drawVoice above only calls it, on 'tick'). `rangeTest` is the flow's
  // state (null when idle); it has to live outside renderOpts, which rebuilds
  // its DOM box from scratch on every call and remembers nothing itself.
  // Samples are collected once, across both halves of the slide, as
  // `{ midi, ms, stage }` -- how long each held note lasted before the pitch
  // moved to a new one, and which half it was sung in -- and handed to
  // voice-range.js's estimateRange() a single time at the end; its own
  // per-stage IQR trim is what guards against one bad frame, so this code
  // does not try to filter samples itself.
  let rangeTest = null;
  // The coach line a mod shows before Start; Cancel puts it back so a stopped test never leaves its "Sing your..." instruction behind.
  const idleCoachLine = () => S.judged ? 'Welcome back. You are on level ' + S.level + ': ' + D().name + '. Press Start.' : 'Press Start. Level ' + S.level + ': ' + D().name + '.';
  function handleRangeTest(action, fr) {
    if (action === 'start') { rangeTest = { stage: 'low', samples: [], curMidi: null, curSince: 0 }; coach('Sing your lowest comfortable note and hold it, then press "Got it -- now the highest".'); return; }
    if (!rangeTest) return;
    if (action === 'tick') { if (!fr || !fr.freq) return; const m = Math.round(fr.midi), t = performance.now(); if (rangeTest.curMidi === null) { rangeTest.curMidi = m; rangeTest.curSince = t; } else if (m !== rangeTest.curMidi) { rangeTest.samples.push({ midi: rangeTest.curMidi, ms: t - rangeTest.curSince, stage: rangeTest.stage }); rangeTest.curMidi = m; rangeTest.curSince = t; } return; }
    if (action === 'flush') { if (rangeTest.curMidi !== null) rangeTest.samples.push({ midi: rangeTest.curMidi, ms: performance.now() - rangeTest.curSince, stage: rangeTest.stage }); rangeTest.curMidi = null; return; }
    if (action === 'next') { handleRangeTest('flush'); rangeTest.stage = 'high'; coach('Now sing your highest comfortable note and hold it, then press "Got it -- done".'); return; }
    if (action === 'cancel') { rangeTest = null; coach(idleCoachLine()); return; }
    if (action === 'finish') { handleRangeTest('flush'); const range = estimateRange(rangeTest.samples); rangeTest = null; if (!range) { coach("I didn't catch a held note either time -- make sure the mic is connected, sing clearly and hold each note for at least half a second, then try again."); return; } const clamped = { low: clamp(range.low, 24, 96), high: clamp(range.high, 24, 96) }; DB.prefs.voiceRange = clamped; DB.prefs.voice = 'mine'; task = null; save(); const t = tonicFromRange(exerciseRangeFor(clamped)), hint = classify(clamped); coach(hint.wording + (t.stretch ? ' That is a little under an octave, so the exercises will stretch a bit past what you just sang.' : ' Exercises are set from your range now.')); return; }
  }
  function renderOpts() {
    const box = $('modOpts'); box.innerHTML = ''; const sel = (id, label, opts, val, on) => { const l = document.createElement('label'); l.htmlFor = id; l.textContent = label + ' '; const s = document.createElement('select'); s.id = id; (Array.isArray(opts) ? opts : Object.keys(opts).map(k => [k, opts[k]])).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v[0]; s.appendChild(o); }); s.value = val; s.addEventListener('change', () => on(s.value)); l.appendChild(s); box.appendChild(l); };
    const btn = (id, text, on, primary) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'small' + (primary ? ' primary' : ''); b.textContent = text; b.addEventListener('click', () => { b.blur(); on(); }); box.appendChild(b); return b; };
    const chk = (id, text, val, on) => { const l = document.createElement('label'); l.htmlFor = id; const c = document.createElement('input'); c.type = 'checkbox'; c.id = id; c.checked = val; c.addEventListener('change', () => on(c.checked)); l.appendChild(c); l.appendChild(document.createTextNode(' ' + text)); box.appendChild(l); };
    const noteWithReview = (id, text, reviewId, reviewKey, revValue) => { const note = document.createElement('span'); note.id = id; note.className = 'small'; note.textContent = text; box.appendChild(note); if (!isReviewCurrent(itemReview(reviewKey, contentRev(revValue)))) { const review = document.createElement('span'); review.id = reviewId; review.setAttribute('role', 'note'); review.className = 'small'; review.textContent = t('review.unreviewed'); box.appendChild(review); } };
    // Session length E7c: 5/10/15 minutes or no limit, per DB.prefs.sessionMinutes
    // -- a change takes effect at the next Start, never a running session's
    // sess.target, so it cannot fire a surprise break or cancel one mid-session.
    if (!TOOLS[mod]) sel('optSessionMinutes', 'Session length', [['none', ['No limit']], ['5', ['5 minutes']], ['10', ['10 minutes']], ['15', ['15 minutes']]] /* pairs: integer-like object keys would sort first */, DB.prefs.sessionMinutes ? String(DB.prefs.sessionMinutes) : 'none', v => { DB.prefs.sessionMinutes = v === 'none' ? null : +v; save(); });
    if (NOTATE_MOD_IDS.indexOf(mod) >= 0) sel('optNotate', 'Show', { names: [DB.prefs.names ? 'Note names (today)' : 'Note names (off in Settings)'], staff: ['Staff'], both: [DB.prefs.names ? 'Staff and names' : 'Staff (names off in Settings)'] }, DB.prefs.notate[mod], v => { DB.prefs.notate[mod] = v; save(); });
    if (mod === 'wind') { sel('optWind', 'My instrument', WIND_KINDS, DB.prefs.wind, v => { DB.prefs.wind = v; task = null; save(); }); chk('optRef', 'Play me the note first', false, () => {}); }
    if (mod === 'voice') sel('optVoice', 'My range', Object.assign({}, VOICE_KINDS, DB.prefs.voiceRange ? { mine: ['My range (found by test)', tonicFromRange(exerciseRangeFor(DB.prefs.voiceRange)).tonic] } : {}), DB.prefs.voice, v => { DB.prefs.voice = v; task = null; save(); });
    if (mod === 'voice' && !rangeTest) btn('optRangeStart', DB.prefs.voiceRange ? 'Find my range again' : 'Find my range', () => { handleRangeTest('start'); renderOpts(); });
    if (mod === 'voice' && rangeTest && rangeTest.stage === 'low') { btn('optRangeNext', 'Got it -- now the highest', () => { handleRangeTest('next'); renderOpts(); }, true); btn('optRangeCancel', 'Cancel', () => { handleRangeTest('cancel'); renderOpts(); }); }
    if (mod === 'voice' && rangeTest && rangeTest.stage === 'high') { btn('optRangeDone', 'Got it -- done', () => { handleRangeTest('finish'); renderOpts(); }, true); btn('optRangeCancel2', 'Cancel', () => { handleRangeTest('cancel'); renderOpts(); }); }
    if (mod === 'tuner') { sel('optTune', 'Instrument', TUNINGS, tunerKind, v => { tunerKind = v; tunerState = null; tunerLock = null; }); btn('tuneReset', 'Start over', () => { tuned = {}; tunerLock = null; }); }
    if (mod === 'harp') sel('optHarpKey', 'My harmonica is in the key of', HARP_KEY_OPTS, DB.prefs.harpKey, v => { DB.prefs.harpKey = +v; task = null; if (pitchWorkletNode) { lastWorkletRangeSent = { fmin: MODS.harp.fmin, fmax: MODS.harp.fmax }; pitchWorkletNode.port.postMessage({ type: 'range', fmin: MODS.harp.fmin, fmax: MODS.harp.fmax }); } save(); });
    // B1(3): Both/Right only/Left only for the hands-together drill (level
    // 13). Changing it clears the in-progress task so the next one is built
    // fresh under the new mode (buildLevelTask's frame loop rebuilds
    // automatically once task is null and playing), never a half-graded one.
    // K2: at level 13, Both stays disabled and the shown value reads
    // effectiveHands() (never the raw, unrewritten preference) until
    // bothUnlocked() -- each hand alone actually PLAYED (a graded attempt,
    // not merely offered) at least once, or an earlier both-hands record
    // grandfathering it open. A lock note and a "before you start" prep line
    // for each hand ride along beside it.
    if (mod === 'kbd') sel('optKbdHands', 'Hands', { both: ['Both'], right: ['Right only'], left: ['Left only'] }, mod === 'kbd' && D().task === 'hands' && !D().timed ? effectiveHands(DB.prefs.kbdHands, bothUnlocked(S)) : DB.prefs.kbdHands, v => { DB.prefs.kbdHands = v; task = null; save(); });
    if (mod === 'kbd' && D().task === 'hands' && !D().timed) {
      if (!bothUnlocked(S)) {
        const o = document.querySelector('#optKbdHands option[value="both"]'); if (o) o.disabled = true;
        const lock = document.createElement('span'); lock.id = 'kbdBothLock'; lock.className = 'small'; lock.setAttribute('role', 'note');
        lock.textContent = 'Both unlocks after you have played the right hand alone and the left hand alone.'; box.appendChild(lock);
      }
      noteWithReview('kbdHandsPrep', prepLine(HANDS_TOGETHER_EXERCISES[0], m => nname(m, true)), 'kbdHandsPrepReview', 'kbd.handsTogether.prep', prepLine(HANDS_TOGETHER_EXERCISES[0]));
    }
    // K3: level 14 ("matching rhythms") keeps the Hands selector visible (it
    // is still the same global preference the mix levels read), but it has
    // no effect on a j<n>t element -- both hands are always required, in
    // time -- so the lock/prep block above is skipped and this note takes
    // its place instead.
    if (mod === 'kbd' && D().timed && !D().stage) {
      const rhythmText = 'Both hands, in time: press together, let go together. Screen taps are practice only: held notes need a MIDI keyboard or computer keys.';
      noteWithReview('kbdRhythmNote', rhythmText, 'kbdRhythmReview', 'kbd.handsTogether.rhythm', { text: rhythmText, onsetMs: PAIR_ONSET_TOL_MS, releaseMs: PAIR_RELEASE_TOL_MS });
    }
    // K4: level 15 ("held bass") and level 16 ("split rhythm") are each
    // their own D().stage, so the level-14 note above is skipped for them
    // and one of these takes its place instead -- same "Not yet checked by
    // a player" review-ledger pattern, keyed on its own content string so a
    // wording change on one level never silently reuses a stale review.
    if (mod === 'kbd' && D().stage === 'held') {
      const heldText = 'Left hand: press and hold the bass note. Right hand: play the three-note melody over it, still holding the bass. Letting go of the bass too soon fails the exercise. Screen taps are practice only: held notes need a MIDI keyboard or computer keys.';
      noteWithReview('kbdHeldNote', heldText, 'kbdHeldReview', 'kbd.handsTogether.held', { text: heldText });
    }
    if (mod === 'kbd' && D().stage === 'split') {
      const splitText = 'Right hand: two even notes. Left hand: one long note, held under both. Each hand is judged on its own. Screen taps are practice only: held notes need a MIDI keyboard or computer keys.';
      noteWithReview('kbdSplitNote', splitText, 'kbdSplitReview', 'kbd.handsTogether.split', { text: splitText, onsetMs: PAIR_ONSET_TOL_MS, releaseMs: PAIR_RELEASE_TOL_MS, midTolRatio: SPLIT_MID_TOL_RATIO });
    }
    // K5: level 17 ("hand position change") is its own D().stage too, same
    // "Not yet checked by a player" review-ledger pattern as held/split.
    if (mod === 'kbd' && D().stage === 'position') {
      const positionText = 'Right hand: play the five-finger position, then move up to the new position partway through and play the same shape there. Left hand: holds its note throughout. Playing the old position after the move fails, naming it. Screen taps are graded the same as a computer key here.';
      noteWithReview('kbdPositionNote', positionText, 'kbdPositionReview', 'kbd.handsTogether.position', { text: positionText, shiftSemitones: POSITION_SHIFT_SEMITONES });
      // Named ahead of time, same as level 13's "before you start" line --
      // the shift is not a surprise the player only discovers mid-exercise.
      noteWithReview('kbdPositionPrep', positionPrepLine(HANDS_POSITION_EXERCISES[0], m => nname(m, true)), 'kbdPositionPrepReview', 'kbd.handsTogether.positionPrep', positionPrepLine(HANDS_POSITION_EXERCISES[0]));
    }
    // B(C11a) 'Play a song with these notes': songFor(S.level) names the
    // most advanced starter song whose notes are all already taught (see
    // src/instruments/kbd-songs.js -- null until level 2, since a song is
    // only suggested once the level teaching its notes is behind the
    // player, not the moment those notes unlock). The 'Make it a lesson'
    // pattern above is the precedent this hand-off follows: requestOpenSong
    // + openPanel('songs'), except this one also names a returnTo so Songs
    // can offer a way back (src/ui/songs.js's renderPractice, 'Back to
    // practice'). The map is teaching content no player has checked yet, so
    // the review label sits right beside the button rather than only in a
    // tooltip -- never claim it is reviewed when isReviewCurrent says no.
    if (mod === 'kbd') { const song = songFor(S.level); if (song) { btn('kbdSongHandoff', t('kbd.songHandoff.button'), () => { requestOpenSong(panelApi, song.songId, undefined, 'kbd', 'kbd'); openPanel('songs'); }); if (!isReviewCurrent(itemReview(song.id, contentRev(song)))) { const note = document.createElement('span'); note.setAttribute('role', 'note'); note.className = 'small'; note.textContent = t('review.unreviewed'); box.appendChild(note); } } }
    // P2: "Your keyboard path" opens a panel naming all five
    // src/core/pathway.js steps and the one action for whichever is current
    // -- shown at every kbd level (unlike the song hand-off above, which
    // needs a suggested song), since 'setup'/'lesson' come before any song
    // is suggested at all.
    if (mod === 'kbd') btn('kbdPathwayBtn', t('pathway.open'), () => openPanel('pathway'));
    if (mod === 'rhy') btn('calBtn', calRun ? 'Listening for 8 taps…' : 'Calibrate timing (' + Math.round(DB.latencyMs || 0) + ' ms)', startCalibrate, false);
    if (mod === 'capture') { btn('capGo', cap.on ? 'Stop' : 'Listen', () => { if (cap.on) capStop(); else { if (!micReady) { say('Connect your microphone first (open "Set up input", press Connect), then press Listen.', 'no'); return; } ensureAudio(); cap.on = true; cap.notes = []; cap.savedId = null; cap.start = now(); cap.curM = -1; say(''); renderOpts(); } }, true); btn('capPlay', 'Play it back', () => { if (!cap.notes.length) { say('Nothing captured yet.', 'no'); return; } ensureAudio(); const t0 = now() + 0.1; cap.notes.forEach(n => tone(n.m, t0 + n.t - (cap.notes[0] ? cap.notes[0].t : 0), Math.max(0.2, n.d))); }); const lessons = {}; MOD_IDS.filter(m => hasMasteryScheme(m)).forEach(m => { lessons[m] = [MODS[m].name]; }); sel('capTo', cap.notes.length + ' notes. Practise on', lessons, 'kbd', () => {});
      // 'Make it a lesson': the captured tune becomes a draft Song (src/song/
      // capture.js), added to the same library the Songs panel reads, then
      // opened there -- requestOpenSong() + openPanel() is the same
      // request+switch pattern src/ui/learn.js's "Practise this" uses, but
      // this file IS the app shell (not a sandboxed panel module) so it can
      // call panelApi/openPanel directly instead of clicking a button.
      btn('capUse', 'Make it a lesson', async () => {
        if (!cap.notes.length) { say('Nothing captured yet.', 'no'); return; }
        try {
          // One capture is saved once: pressing again re-opens that song instead of adding an identically titled copy.
          const song = captureToSong(cap.notes, { now: Date.now() });
          const id = cap.savedId || await backupLibrary().add(song, { now: Date.now() }); cap.savedId = id;
          // The 'Practise on' select (capTo) is the only place this tool
          // asks which instrument the captured tune is for -- Songs' own
          // checkOpenRequest() otherwise falls back to api.mod(), which at
          // this point is still 'capture' (a tool, not an instrument) and
          // would leave the learner staring at "pick an instrument first".
          const to = $('capTo').value;
          requestOpenSong(panelApi, id, undefined, to);
          openPanel('songs');
          coach('Your captured tune, "' + song.title + '", is now a song in your library with a full lesson ready.');
        } catch (e) { recordError('capture:makeLesson', e); say('That capture could not be turned into a song: ' + e.message, 'no'); }
      }, true);
      // 'Drill the notes': today's four-note-at-a-time drill, unchanged --
      // pitch only, no timing, loaded into DB.custom.
      btn('capDrill', 'Drill the notes', () => { if (!cap.notes.length) { say('Nothing captured yet.', 'no'); return; } DB.custom = cap.notes.map(n => n.m).slice(0, 300); save(); const to = $('capTo').value; setMod(to); customOn = true; renderOpts(); showAll(); coach('Your captured tune is loaded: ' + DB.custom.length + ' notes, four at a time. Each group repeats until it is clean. Press Start.'); });
    }
    if (MODS[mod] && DB.custom && DB.custom.length && hasMasteryScheme(mod)) chk('optCustom', 'Practise my captured melody (' + DB.custom.length + ' notes)', customOn, v => { customOn = v; chunk = 0; task = null; showAll(); });
    if (groovable(mod)) chk('optGroove', 'Play in time (metronome, ' + (S.grooveBpm || 80) + ' bpm)', grooveOn, v => { grooveOn = v; task = null; groove = null; showAll(); });
  }

  // ---------- inputs ----------
  function ioState(cls, text) { $('ioDot').className = 'dot ' + cls; $('ioText').textContent = text; }
  let midiOn = false; const needsMic = () => TOOLS[mod] || MODS[mod].input === 'pluck' || MODS[mod].input === 'sustain';
  // "Connected" is earned, not assumed (field reports: status said connected
  // while the keyboard sent nothing). But earning it governs what the app
  // SAYS, never what it listens to -- see the ioBtn handler below. midiPorts
  // holds every state==='connected' port with what open() reported about it;
  // midiHeard holds the ports that have actually delivered a byte, which is
  // better proof than open() and can promote a port open() gave up on. Proof
  // that a keyboard works is scoped to the CURRENT route, never sticky
  // across a device change: "is working" below reads midiHeard against
  // midiPortInputs (the ports wire() just reported), so a never-heard device
  // connected after a proven one is unplugged reports only "found", not the
  // previous device's proof (field report: device B showed "is working"
  // with no note from B ever heard, because a session-wide flag never reset
  // on a route change). midiLog and realMidiHeld back the "MIDI details"
  // readout and hands-together grading. noteState (src/core/note-state.js)
  // is the ground truth for "which port+channel+pitch is down right now" --
  // realMidiHeld stays a flat Set of pitches (line 1198's hands-together
  // grading reads it directly, and that call site is out of this unit's
  // reach) but is only ever cleared of a pitch once noteState says NO port
  // is holding it any more, so one port's note-off (or a blur/unplug
  // releasing that port) can never cancel the SAME pitch held on another
  // port.
  let midiPorts = [], midiPortInputs = [], midiHeard = new Set(), midiLog = [], realMidiHeld = new Set(), midiParsers = new Map(), midiBlinkTimer = null, noteState = createNoteState();
  // midiPortInputs is kept parallel to midiPorts rather than held on the port
  // objects themselves: midiPorts is handed to the debug hook and crosses the
  // page boundary by value, and a live MIDIInput does not survive that trip.
  function midiWorks(i) { return midiPorts[i].ok || midiHeard.has(midiPortInputs[i]); }
  // Drops every note noteState says the given port is holding (with no
  // argument, every port) -- a note-off that is never going to arrive
  // because the port vanished (unplugged, or another program took it back)
  // or the page itself stopped listening (window blur, tab hidden). Only
  // drops a pitch from realMidiHeld once noteState confirms no OTHER port
  // still holds it, same rule handleMidiMessage's own note-off follows.
  function releaseNotes(port) { noteState.releaseAll(port).forEach(p => { if (!noteState.isHeld(p)) realMidiHeld.delete(p); }); }
  // Per-port wording: "working" is earned by bytes from THAT port, so a keyboard that has only opened stays "found" even when another one has played.
  function midiStatus() {
    const live = midiPorts.map((p, i) => ({ name: p.name, heard: midiHeard.has(midiPortInputs[i]), works: midiWorks(i) })).filter(p => p.works), join = a => a.join(' and '), heard = live.filter(p => p.heard).map(p => p.name), quiet = live.filter(p => !p.heard).map(p => p.name);
    const foundTxt = quiet.length ? join(quiet) + ' found. Press any key on ' + (live.length > 1 ? 'one' : 'it') + '.' : '';
    if (!heard.length) return foundTxt;
    return join(heard) + (heard.length > 1 ? ' are working.' : ' is working.') + (quiet.length ? ' ' + join(quiet) + ' found. Press any key on ' + (quiet.length > 1 ? 'one' : 'it') + '.' : '');
  }
  function ioRefresh() {
    const b = $('ioBtn'), detailsBtn = $('midiDetailsBtn');
    if (needsMic()) { b.hidden = micReady; b.textContent = 'Connect microphone'; detailsBtn.hidden = true; ioState(micReady ? 'on' : '', micReady ? 'Listening through your microphone.' : 'This one listens through a microphone or audio interface.'); }
    else if (mod === 'ear') { b.hidden = true; detailsBtn.hidden = true; ioState('on', 'Nothing to connect. Turn your sound up.'); }
    else {
      b.hidden = midiOn; b.textContent = 'Connect MIDI'; detailsBtn.hidden = false;
      if (midiOn) { ioState('on', midiStatus()); }
      else ioState('', mod === 'rhy' ? 'Space bar or the pad works. MIDI is optional.' : 'Screen keys and computer keys work. MIDI is optional.');
    }
    if (!$('midiDetails').hidden) renderMidiDetails();
  }
  // Blinks #midiActDot on ANY MIDI byte -- exercise running or not -- so a
  // learner whose note is not being judged (nothing running, or heard
  // outside the drawn octave, see onNote() above) still gets visible proof
  // the keyboard itself is reaching the page.
  function midiBlink() { const dot = $('midiActDot'); dot.hidden = false; dot.classList.add('on'); clearTimeout(midiBlinkTimer); midiBlinkTimer = setTimeout(() => dot.classList.remove('on'), 150); }
  function renderMidiDetails() {
    const lines = midiPorts.length ? [] : ['No MIDI input has been seen yet.'];  // midiLog is cleared with the last port (wire()), so old bytes never sit under this line
    midiPorts.forEach((p, i) => lines.push(p.name + ' -- state: ' + p.state + ', connection: ' + p.connection + (p.ok ? ', opened.' : ', open failed: ' + (p.error || 'unknown reason') + (midiHeard.has(midiPortInputs[i]) ? ', but it is sending messages anyway.' : '.'))));
    if (midiLog.length) { lines.push(''); lines.push('Last messages heard (hex):'); midiLog.forEach(h => lines.push(h)); }
    $('midiDetailsText').textContent = lines.join('\n');
  }
  $('midiDetailsBtn').addEventListener('click', function () { this.blur(); const el = $('midiDetails'); el.hidden = !el.hidden; if (!el.hidden) renderMidiDetails(); });
  // ---------- MIDI out: "Play it for me" ----------
  // midiOutPorts: the live MIDIAccess.outputs that are connected; midiOutId: the one the learner picked in
  // #midiOutSelect ('' = none, and then no Play it for me button is offered -- nothing to play to). midiOutBusy
  // is true from the first scheduled note until the last one ends (or Stop): handleMidiMessage drops input
  // while it is, since a keyboard that plays itself also reports those notes back as if the learner pressed them.
  let midiOutPorts = [], midiOutId = '', midiOutBusy = false, midiOutTimer = null, midiOutActive = null, midiOutOnEnd = null;
  function midiOutSelected() { return midiOutPorts.find(p => p.id === midiOutId) || null; }
  function midiOutRefresh(access) {
    const all = []; if (access && access.outputs && access.outputs.forEach) access.outputs.forEach(p => all.push(p));
    midiOutPorts = all.filter(p => p.state === 'connected');
    if (midiOutId && !midiOutSelected()) { midiOutStop(); midiOutId = ''; }
    const sel = $('midiOutSelect'), lab = $('midiOutLabel'); if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    midiOutPorts.forEach((p, i) => { const o = document.createElement('option'); o.value = p.id; o.textContent = describeOutputs([p]).names[0]; sel.appendChild(o); });
    sel.value = midiOutId; sel.hidden = lab.hidden = !midiOutPorts.length;
  }
  function midiOutStop() {
    clearTimeout(midiOutTimer); midiOutTimer = null;
    const out = midiOutActive, done = midiOutOnEnd; midiOutActive = null; midiOutOnEnd = null; midiOutBusy = false;
    if (out) { try { stopAll(out, 0); } catch (e) {} }
    if (done) done();
  }
  // Schedules one part of `song` on the picked output on the performance.now() timeline (Web MIDI's own
  // timestamp clock), following song.tempoMap. onEnd fires once, on natural end or Stop.
  function midiOutPlay(song, partIndex, onEnd) {
    const out = midiOutSelected(); if (!out) return false;
    midiOutStop();
    const startMs = performance.now() + 150;
    let msgs; try { msgs = scheduleSong(song, { partIndex: partIndex || 0, startMs, channel: 0 }); } catch (e) { return false; }
    if (!msgs.length) return false;
    playOnOutput(out, msgs);
    midiOutActive = out; midiOutOnEnd = onEnd || null; midiOutBusy = true;
    midiOutTimer = setTimeout(midiOutStop, Math.max(0, msgs[msgs.length - 1].atMs - performance.now()) + 250);
    return true;
  }
  $('midiOutSelect').addEventListener('change', function () { midiOutStop(); midiOutId = this.value || ''; });
  // One raw MIDI message from an opened port: blink, log it for the details
  // readout, parse it (createMidiParser keeps running status per port), and
  // feed note-on/off into onNote()/the real held-note set.
  function handleMidiMessage(input, ev) {
    const d = ev.data; if (!d || !d.length) return;
    midiBlink();
    // A byte arriving is the ground truth open() was only ever a proxy for.
    // Whatever open() reported, this port is demonstrably delivering, so stop
    // warning about a program that plainly is not in the way.
    midiHeard.add(input); if (midiPortInputs.indexOf(input) !== -1) midiOn = true;
    midiLog.unshift(Array.from(d).map(b => b.toString(16).padStart(2, '0')).join(' ')); if (midiLog.length > 8) midiLog.length = 8;
    ioRefresh();
    if (midiOutBusy) return; // the keyboard is playing a song back for the learner and echoes its own notes as input -- not the learner playing, so not judged
    let parser = midiParsers.get(input); if (!parser) { parser = createMidiParser(); midiParsers.set(input, parser); }
    parser.feed(d).forEach(evt => { if (evt.type === 'on') { noteState.noteOn(input, evt.channel, evt.note); realMidiHeld.add(evt.note); onNote(evt.note, true, 'midi'); } else { noteState.noteOff(input, evt.channel, evt.note); if (!noteState.isHeld(evt.note)) realMidiHeld.delete(evt.note); onNoteOff(evt.note, 'midi'); } });
  }
  function connectMic() { openMic().then(ioRefresh).catch(() => ioState('off', 'The microphone was blocked. Allow it in the browser, or open the standalone copy in Chrome.')); }
  // Start on a mic instrument asks for the mic FIRST (the browser's own prompt), then begins: an exercise that cannot hear only ever says "Time." and "You stepped away". Blocked or unavailable: say so and do not start.
  function startAfterMic() {
    if (!needsMic() || micReady) { startSession(); return; }
    const m = mod, blocked = () => { const msg = 'The microphone was blocked, so I could not start. Press "Set up input", then "Connect microphone", and allow it in your browser.'; ioState('off', msg); if (mod === m) coach(msg); };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { const msg = 'This browser cannot open a microphone here. Open the standalone copy in Chrome.'; ioState('off', msg); coach(msg); return; }
    ensureAudio(); openMic().then(() => { ioRefresh(); if (!sess && mod === m) startSession(); }).catch(blocked);
  }
  function connectMidi() {
    navigator.requestMIDIAccess().then(a => {
      const wire = () => {
        midiOutRefresh(a);
        const inputs = []; a.inputs.forEach(i => inputs.push(i));
        // A port this app had open that is gone: onstatechange no longer lists
        // it at all (unplugged, or Windows handed its note port back to a DAW),
        // or still lists it but reads anything other than 'connected'. Null its
        // onmidimessage -- a stale MIDIInput otherwise keeps a listener wired
        // to a port the status strip no longer names -- release whatever notes
        // noteState says it was holding, exactly as if it had sent every one of
        // them a note-off on its way out, and forget it ever delivered a byte
        // so a replug has to be heard again before the status says "working".
        // The listener loop below re-attaches to every LISTED port in this same
        // call, so for a listed disconnected port the null is overwritten: the
        // release and the midiHeard delete are what act there.
        midiPortInputs.forEach(i => { if (inputs.indexOf(i) === -1 || i.state !== 'connected') { i.onmidimessage = null; releaseNotes(i); midiHeard.delete(i); } });
        // Listen to EVERY input, whatever open() goes on to report. Web MIDI
        // opens a port implicitly when onmidimessage is assigned, so this is
        // how the app heard keyboards before open() was introduced, and a port
        // that genuinely cannot deliver simply never fires -- a listener on it
        // costs nothing. Gating the listener on open() instead lost real
        // keyboards: MIDI ports are exclusive on Windows, so a DAW or the
        // keyboard's own utility holding the note port of a multi-port device
        // left the app opening only the idle sibling, reporting "found", and
        // hearing nothing. open() below decides only what the status SAYS.
        inputs.forEach(i => { i.onmidimessage = ev => handleMidiMessage(i, ev); });
        const connected = inputs.filter(i => i.state === 'connected');
        Promise.all(connected.map(i => i.open().then(() => ({ input: i, ok: true }), e => ({ input: i, ok: false, error: (e && e.message) || 'could not be opened' })))).then(results => {
          midiPorts = results.map(r => ({ name: r.input.name || 'MIDI device', state: r.input.state, connection: r.input.connection, ok: r.ok, error: r.error }));
          midiPortInputs = results.map(r => r.input); if (!midiPorts.length) midiLog.length = 0;
          midiOn = results.some((r, i) => r.ok || midiWorks(i));
          ioRefresh();
          // No MIDI input at all: an e-kit was tried and genuinely is not
          // there, so a drum kit falls back to the mic (kick/snare/hi-hat
          // only, see listenDrums()) rather than leaving Connect a dead end.
          // A kit whose e-kit IS found never reaches here, so this can never
          // fight real MIDI note-ons for the same tap.
          if (!connected.length && MODS[mod] && MODS[mod].input === 'mic+midi' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) openMic().then(ioRefresh).catch(() => ioState('off', 'No MIDI device found, and the microphone was blocked. Allow it, or plug in a kit.'));
          else if (!connected.length) ioState('off', 'No MIDI device is plugged in. Plug it in and it will be picked up. Screen and computer keys still work as practice, not proof a real keyboard works.');
          else if (!midiOn) ioState('off', 'Another program may be using this keyboard. Close it and press Connect again.');
        });
      };
      wire(); a.onstatechange = wire;
    }).catch(e => {
      // Chrome 124+ asks on every requestMIDIAccess(): a dismissed/blocked prompt is NotAllowedError, so say that and keep Connect there to ask again. SecurityError is the embedded/iframe case, the only one the standalone copy fixes. Anything else (InvalidStateError: no MIDI backend) is not a permission problem.
      const n = e && e.name, tail = ' Screen and computer keys still work as practice, not proof a real keyboard works.';
      if (n === 'NotAllowedError') { const b = $('ioBtn'); b.hidden = false; b.disabled = false; b.textContent = 'Try MIDI again'; ioState('off', 'Chrome asked to use your MIDI devices and the answer was no (or the box was closed). Click Try MIDI again to ask again; if Chrome no longer asks, click the icon left of the address bar and allow MIDI.' + tail); }
      else if (n === 'SecurityError') ioState('off', 'MIDI was blocked here. Open the standalone copy in Chrome.' + tail);
      else ioState('off', 'This browser could not reach MIDI on this computer.' + tail);
    });
  }
  $('ioBtn').addEventListener('click', () => {
    ensureAudio();
    if (needsMic()) { if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { ioState('off', 'This browser cannot open a microphone here. Open the standalone copy in Chrome.'); return; } connectMic(); return; }
    if (!navigator.requestMIDIAccess) {
      // A drum kit still has the mic to fall back on even when this browser
      // cannot read MIDI at all (needsMic() stays false for 'mic+midi' so an
      // e-kit is tried FIRST; see the empty-inputs branch below for the same
      // fallback when MIDI is readable but nothing is plugged in).
      if (MODS[mod] && MODS[mod].input === 'mic+midi' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { connectMic(); return; }
      ioState('off', 'This browser cannot read MIDI. Use Chrome or Edge. Screen and computer keys still work as practice, not proof a real keyboard works.'); return;
    }
    connectMidi();
  });
  // "Set up input" reveals the whole io strip (Connect, the Input select,
  // Check my microphone, MIDI details, the level meter). #ioBtn and the rest
  // stay in the DOM and clickable while the sheet is closed -- this only
  // toggles [hidden] on the wrapper, never removes or recreates the controls
  // -- so a test (or a learner already mid-flow) that reaches #ioBtn directly
  // still works with the sheet collapsed.
  // a11y (item 2, setup-sheet-focus): every OTHER toggle button in this file
  // blurs itself on click -- fine when the click only ever hides that one
  // button. This one instead REVEALS a whole sheet of new controls right
  // where the button was, so blurring dropped a keyboard user's focus to
  // <body> on every single toggle, forcing a Tab-from-the-top just to reach
  // what they themselves just opened (or, on close, anything at all). Focus
  // now stays on the button both ways -- exactly where a keyboard user's
  // next Tab/Shift-Tab expects it, whether they are about to move INTO the
  // sheet or back OUT into the page.
  $('setupBtn').addEventListener('click', function () { const el = $('setupSheet'), open = el.hidden; el.hidden = !open; this.setAttribute('aria-expanded', String(open)); });
  if ($('micDeviceSelect')) $('micDeviceSelect').addEventListener('change', function () {
    // The room floor belongs to the device that was measured: drop it (and its marker) so the new device gets its own check, and advance micGen so any measurement still running for the old stream is discarded.
    DB.prefs.inputDeviceId = this.value || null; micGen++; DB.prefs.noiseFloor = null; DB.prefs.noiseFloorV = null; applyGates(gatesFor(null)); save();
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; micReady = false; }
    if (needsMic()) openMic().then(ioRefresh).catch(() => ioState('off', 'That microphone could not be opened.'));
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', refreshMicDevices);
  if ($('calibrateBtn')) $('calibrateBtn').addEventListener('click', function () { this.blur(); calibrateNoiseFloor(); });
  document.addEventListener('keydown', ev => {
    if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return; const tag = ev.target.tagName; if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && ev.target.type !== 'checkbox') || ev.target.isContentEditable) return;
    if (mod === 'rhy' && (ev.key === ' ' || ev.key.length === 1)) { if (tag === 'BUTTON' && ev.key === ' ' && ev.target.id !== 'tapPad') return; ev.preventDefault(); ensureAudio(); onTap(ev); return; }
    if (MODS[mod] && MODS[mod].kit && KIT_KEYS[ev.key.toLowerCase()]) { ev.preventDefault(); ensureAudio(); onHit(KIT_KEYS[ev.key.toLowerCase()], tapAudioTime(ev), 'key'); return; }
    if (mod === 'ear' && task && task.choices && /^[1-9]$/.test(ev.key)) { const id = task.choices[+ev.key - 1]; if (id) answer(id); return; }
    if (mod === 'kbd' && PCKEYS[ev.key.toLowerCase()] !== undefined) { ev.preventDefault(); ensureAudio(); const m = PCKEYS[ev.key.toLowerCase()]; noteState.noteOn('computer-key', 0, m); tone(m, now() + 0.01, 0.5, 0.15); onNote(m, true, 'computer-key'); }
  });
  // The keydown above has no matching note-off, so a computer key held down
  // while the browser drops the key event (alt-tab away mid-press is the
  // common way) never released it -- noteState is the same held-note ledger
  // MIDI note-off, window blur and tab-hidden already clear into.
  document.addEventListener('keyup', ev => { if (mod === 'kbd' && PCKEYS[ev.key.toLowerCase()] !== undefined) { const m = PCKEYS[ev.key.toLowerCase()]; noteState.noteOff('computer-key', 0, m); onNoteOff(m, 'computer-key'); } });
  cv.addEventListener('pointerdown', ev => { const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) * cv.width / r.width, y = (ev.clientY - r.top) * cv.height / r.height; ensureAudio(); if (MODS[mod] && MODS[mod].kit && kitBox) { const p = pieceAt((x - kitBox.x) / kitBox.w, (y - kitBox.y) / kitBox.h, kitBox.w, kitBox.h); if (p) onHit(p, tapAudioTime(ev), 'click'); } if (mod === 'kbd') { const k = keyRects.find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); if (k) { tone(k.m, now() + 0.01, 0.5, 0.15); onNote(k.m, true, 'screen'); } } if (mod === 'tuner') { const play = playRects.find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); if (play) { tone(play.m, now() + 0.02, 1.6, 0.2); return; } const row = rowRects.find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); if (row) tunerLock = tunerLock === row.idx ? null : row.idx; } });
  // item 3 (Wave W, w-fixes): keyboard path onto the same canvas piano -- arrow keys move the focus cursor, Enter/Space plays the focused key.
  cv.addEventListener('keydown', ev => { if (mod !== 'kbd') return; const order = kbdOrder(); if (!order.length) return; if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); kbdFocusIdx = Math.min(order.length - 1, kbdFocusIdx + 1); } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); kbdFocusIdx = Math.max(0, kbdFocusIdx - 1); } else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); const k = order[Math.min(kbdFocusIdx, order.length - 1)]; if (k) { ensureAudio(); tone(k.m, now() + 0.01, 0.5, 0.15); onNote(k.m, true, 'screen'); } } });
  $('tapPad').addEventListener('pointerdown', ev => { ev.preventDefault(); ensureAudio(); onTap(ev); });
  $('replayBtn').addEventListener('click', function () { this.blur(); if (task && !task.done) { playRef(task); lastInputAt = now(); } });
  $('showMeBtn').addEventListener('click', function () { this.blur(); const e = cur(); if (!task || task.done || !e) return; if (!e.failed && !e.helped) { e.helped = true; e.reveal = true; } say('Shown. This one is help, not a test: no credit and no penalty.', ''); refreshPrompt(); });
  $('playBtn').addEventListener('click', function () { this.blur(); if (!sess) startAfterMic(); else if (paused) resume(); else takeBreak('user'); });
  $('endBtn').addEventListener('click', function () { this.blur(); endSession(); }); $('endBtn2').addEventListener('click', endSession); $('backBtn').addEventListener('click', resume);
  $('snoozeBtn').addEventListener('click', () => { sess.snoozeUntil = Date.now() + 5 * 60000; sess.tiredFor = 0; S.ready = Math.min(S.ready, 0.6); pauseInfo = { at: Date.now(), secs: 0 }; resume(); coach('Five more minutes, then I will ask again. I have eased off the pace meanwhile.'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) takeBreak('hidden'); if (document.hidden) { flushSave(); releaseNotes(); runTeardown('hidden'); } else { refreshModelClock(); resumeAudio(); ioRefresh(); } wakeLock.handleVisibilityChange(document); });
  // A hidden tab is a pause the learner might return to; pagehide (real tab
  // close, navigation, reload) never comes back, so it gets the same
  // teardown -- a hidden tab that goes straight to being closed must not
  // leave the mic/AudioContext running just because visibilitychange already
  // ran once. runTeardown() is idempotent (each stopper is a no-op once
  // already run), so a hidden tab that is THEN closed safely runs it twice.
  // Kept next to this listener rather than in the flushSave/writeDB pagehide
  // wiring above, which an unrelated unit also edits.
  window.addEventListener('pagehide', () => runTeardown('pagehide'));
  // now() is actx.currentTime, so a context the teardown stopper suspended
  // above freezes the app clock solid -- nextTaskAt, scheduled against that
  // frozen now(), can never become due again. The visible branch above
  // covers a plain tab switch; a bfcache restore (Back/Forward Cache) instead
  // fires pageshow with persisted:true and NO visibilitychange at all on some
  // browsers, so resumeAudio() (a no-op unless actx exists and is suspended)
  // needs its own call here too, or a learner returning from history
  // navigation gets the same frozen clock this whole fix exists to prevent.
  window.addEventListener('pageshow', ev => { if (ev.persisted) resumeAudio(); });
  // A held note has no way to send its own note-off once the window itself
  // loses focus (alt-tab, another app grabbing the keyboard) -- release
  // everything noteState is holding rather than leave a phantom note "held"
  // until some later, unrelated message happens to clear that same pitch.
  window.addEventListener('blur', () => releaseNotes());
  function jump(dl) { const nl = Math.max(1, S.level + dl); if (nl === S.level) { coach('You are already on level 1: ' + D().name + '. That is the easiest level.'); return; } S.level = nl; S.ready = 0.3; task = null; say(''); coach((dl < 0 ? 'Moved down' : 'Skipped ahead') + ' to level ' + S.level + ': ' + D().name + '.'); save(); if (mod === 'kbd') renderOpts(); showAll(); }
  $('easierBtn').addEventListener('click', function () { this.blur(); jump(-1); }); $('harderBtn').addEventListener('click', function () { this.blur(); jump(1); });
  $('resetBtn').addEventListener('click', function () { this.blur(); if (!confirm(t('reset.confirm', { name: MODS[mod].name }))) return; if (sess) endSession(); DB.mods[mod] = S = freshModel(); recent = []; streak = 0; coach(t('reset.progressCleared', { name: MODS[mod].name })); save(); showAll(); });
  $('optNames').addEventListener('change', function () { DB.prefs.names = this.checked; save(); renderOpts(); }); // the practice Show labels own up to names off
  // Theme J1: 'system' removes the attribute so styles.css's own
  // prefers-color-scheme media query decides; 'light'/'dark' pin it,
  // overriding the OS setting either way (see src/styles.css).
  function applyTheme(t) { if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  $('optTheme').addEventListener('change', function () { DB.prefs.theme = this.value; applyTheme(this.value); applyAccent(); save(); });
  $('optLocale').addEventListener('change', function () { DB.prefs.locale = LOCALES.some(l => l.code === this.value) ? this.value : 'en'; applyLocale(DB.prefs.locale); updateNavInstrumentLabel(); showAll(); refreshModelPack(); save(); });
  function applyNoteNaming() { DB.prefs.noteNaming = { system: $('optNoteSystem').value, accidentals: $('optAccidentals').value }; setNoteNaming(DB.prefs.noteNaming); save(); showAll(); }
  $('optNoteSystem').addEventListener('change', applyNoteNaming); $('optAccidentals').addEventListener('change', applyNoteNaming);

  function setMod(m) {
    if (sess) endSession(); mod = m; if (micStream && !(TOOLS[m] || (MODS[m] && /^(pluck|sustain|mic)/.test(MODS[m].input)))) { const pm = $('practiceMeter'); if (pm) pm.hidden = true; micStream.getTracks().forEach(t => t.stop()); micStream = null; micReady = false; micGen++; } if (MODS[m]) { S = DB.mods[m]; DB.prefs.mod = m; } customOn = false; grooveOn = false; groove = null; task = null; bar = null; heard = null; cap.on = false; tunerState = null; tunerLock = null; diagInputFrames = []; diagLastState = null;
    if (pitchWorkletNode && MODS[m] && MODS[m].fmin && MODS[m].fmax) { lastWorkletRangeSent = { fmin: MODS[m].fmin, fmax: MODS[m].fmax }; pitchWorkletNode.port.postMessage({ type: 'range', fmin: MODS[m].fmin, fmax: MODS[m].fmax }); }
    if (pitchWorkletNode && actx) { const neededFrameSize = frameSizeForInstrument(instrumentById[m], actx.sampleRate); if (neededFrameSize !== lastWorkletFrameSize) { lastWorkletFrameSize = neededFrameSize; pitchWorkletNode.port.postMessage({ type: 'frameSize', frameSize: neededFrameSize }); } }
    document.querySelectorAll('#picker button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mod === m)));
    updateNavInstrumentLabel(); cv.classList.toggle('kit', !!(MODS[m] && MODS[m].kit)); cv.classList.toggle('tuner', m === 'tuner');
    // U2: a returning learner whose saved mod is a variant (e.g.
    // 'ukulele-low-g') lands with that variant's family disclosure already
    // open and the variant itself pressed, mirroring the toolsGroup line
    // above -- never with the variant hidden and only the parent visible.
    if (VARIANT_PARENTS[m]) { const variantGroup = document.querySelector('.picker-variant-group[data-mod-group="' + VARIANT_PARENTS[m] + '"] .variant-toggle'); if (variantGroup) variantGroup.open = true; }
    // R10 P4: the idle stage used to restate the just-picked instrument/tool
    // name here in giant uppercase display type -- a near-illegible dark-on-
    // dark ghost sitting over the stage background that read as a rendering
    // glitch, and purely redundant with the picker button already showing
    // pressed. The canvas's own "PRESS START" and the picker's pressed state
    // are enough; #prompt stays empty until a real exercise names one.
    $('prompt').textContent = ''; $('hint').textContent = ''; $('choices').hidden = true; say(''); if (MODS[m]) coach(idleCoachLine());
    renderOpts(); ioRefresh(); showAll(); save();
  }
  // Two visual tiers inside the one #picker container (kept as a single id
  // so every existing `#picker button` selector -- setMod's aria-pressed
  // sync, openPanel's cross-picker clearing -- still finds every button with
  // no change there): real instruments render straight into #picker as
  // before, most prominent; TOOLS (Tuner, Capture a melody), the two
  // pseudo-mods that read as tools to a learner rather than instruments to
  // pick up (TOOL_MOD_IDS: 'ear', 'rhy'), and the three panel tools
  // (PANEL_TOOL_IDS: Ear training, How to play it, Music theory) render into
  // a quieter nested .picker-tools group instead. P2b-3: this group is a
  // plain, always-visible group now, not a shut-by-default <details> -- once
  // the instrument sheet itself is open (setInstrumentSheetOpen), everything
  // inside it, tools included, is visible with no second disclosure to find.
  function buildPickerButton(m, o) { const b = document.createElement('button'); b.type = 'button'; b.dataset.mod = m; b.style.setProperty('--c', o.color); b.setAttribute('aria-pressed', 'false'); b.appendChild(document.createTextNode(o.name)); const sm = document.createElement('small'); sm.textContent = o.tag; b.appendChild(sm); b.addEventListener('click', () => { b.blur(); closePanel(); pickerAsSheet = true; setMod(m); setInstrumentSheetOpen(false); if (document.activeElement === document.body) focusNavInstrument(); }); return b; }
  // A panel tool button (Ear training / How to play it / Music theory)
  // shares buildPickerButton's look (--c colour dot, <small> tag line) but
  // opens a registered panel instead of selecting a mod, and shuts the
  // instrument sheet on click exactly like picking an instrument does --
  // both leave the learner looking at what they just chose, not an empty
  // sheet still hanging open behind it.
  function buildPanelToolButton(p) { const b = document.createElement('button'); b.type = 'button'; b.dataset.panel = p.id; b.style.setProperty('--c', p.color || '#93a0bd'); b.setAttribute('aria-pressed', 'false'); b.appendChild(document.createTextNode(p.name)); const sm = document.createElement('small'); sm.textContent = p.tag || ''; b.appendChild(sm); b.addEventListener('click', () => { b.blur(); openPanel(p.id); setInstrumentSheetOpen(false); focusPanelHeading(); }); return b; }
  // U2: children[parentId] lists the variant ids grouped under it, built
  // from VARIANT_PARENTS rather than a second hand-written map, so the two
  // stay impossible to drift apart.
  function variantChildrenByParent() { const out = {}; Object.keys(VARIANT_PARENTS).forEach(v => { const p = VARIANT_PARENTS[v]; (out[p] = out[p] || []).push(v); }); return out; }
  // P2b-1: reads the currently-pressed instrument button's own label
  // straight out of the real DOM (rather than a second `mod`/`MODS[mod]`
  // lookup that could drift from what setMod() actually marked pressed) and
  // writes it into the nav Instrument button, e.g. "Instrument: Guitar".
  // The one way to change instrument now: replaces the old collapsed
  // "<Instrument> — change instrument" summary line inside the picker
  // itself with a single always-visible nav control. A no-op before
  // setMod()'s first call finishes marking a button pressed.
  function updateNavInstrumentLabel() {
    const btn = $('navInstrument'); if (!btn) return;
    // A fresh profile has SOME mod pressed (setMod(mod) always runs at boot,
    // on the model default) even though nothing has genuinely been chosen
    // yet -- pickerAsSheet, not "is anything pressed", is what tells a
    // first-time visitor ("Choose an instrument") apart from a real choice
    // ("Instrument: <name>"), same distinction hasSavedMod always drew.
    const pressed = pickerAsSheet && document.querySelector('#picker button[aria-pressed="true"]');
    btn.textContent = pressed ? t('nav.instrument', { name: pressed.firstChild.textContent }) : t('nav.chooseInstrument');
  }
  // Toggled by the nav Instrument button (routeTo('instrument')) and by
  // buildPickerButton's own click handler, which always shuts the sheet
  // again once a real choice is made -- never touches aria-current, since
  // the instrument sheet is not one of the nav's three destinations.
  function setInstrumentSheetOpen(open) {
    const box = $('picker'); if (box) box.hidden = !open;
    const btn = $('navInstrument'); if (btn) btn.setAttribute('aria-expanded', String(open));
  }
  // Closing the sheet hides the button that had focus, which would drop focus to <body>: put it on the nav Instrument button (where the sheet opened from) instead.
  function focusNavInstrument() { const b = $('navInstrument'); if (b) b.focus(); }
  // A tool panel (Ear training / How to play it / Music theory) opened from the sheet announces itself the way the nav screens do (F2): focus lands on its heading.
  function focusPanelHeading() { const h = $('panelHost').querySelector('h2'); if (h) { if (!h.hasAttribute('tabindex')) h.tabIndex = -1; h.focus(); } else focusNavInstrument(); }
  function buildPicker() {
    const box = $('picker'), instrumentIds = MOD_IDS.filter(m => TOOL_MOD_IDS.indexOf(m) < 0), toolIds = TOOL_MOD_IDS.concat(Object.keys(TOOLS)), children = variantChildrenByParent();
    // Escape closes the sheet from anywhere inside it and puts focus back on the nav Instrument button (the other dismissible surfaces -- panels, the break card -- already do).
    box.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.defaultPrevented && !box.hidden) { ev.preventDefault(); setInstrumentSheetOpen(false); focusNavInstrument(); } });
    // Each variant family renders as ONE top-level control (the parent
    // button, always visible and independently selectable -- e.g. "Ukulele"
    // still reaches mod 'uke') plus a quiet <details> disclosure beside it
    // holding the variant buttons, shut by default so the ten real
    // instrument choices stay the thing a learner sees first. A variant id
    // is skipped from the flat top-level loop entirely (VARIANT_PARENTS[m]
    // check) -- it only ever renders inside its family's disclosure.
    //
    // P2b-1: the row itself always renders straight into #picker now --
    // #picker IS the chooser sheet the nav Instrument button opens and
    // shuts (setInstrumentSheetOpen()), so there is exactly one disclosure
    // controlling visibility, not the old #picker-always-visible plus a
    // second <details>#pickerCollapse nested inside it for a returning
    // learner. Which state the sheet starts in (shut for a returning
    // learner, open for a first-time visitor) is decided once at boot from
    // hasSavedMod, see the setInstrumentSheetOpen() call in the boot
    // sequence below.
    instrumentIds.filter(m => !VARIANT_PARENTS[m]).forEach(m => {
      const kids = children[m];
      if (!kids) { box.appendChild(buildPickerButton(m, MODS[m])); return; }
      const group = document.createElement('span'); group.className = 'picker-variant-group'; group.dataset.modGroup = m;
      group.appendChild(buildPickerButton(m, MODS[m]));
      const toggle = document.createElement('details'); toggle.className = 'variant-toggle';
      // Same "build the label from the data" rule as the tools summary
      // below: naming the variants by hand would go stale the first time
      // one is renamed or a third is added.
      const summary = document.createElement('summary'); summary.textContent = 'Variants: ' + kids.map(v => MODS[v].name).join(', '); summary.title = summary.textContent; toggle.appendChild(summary);
      const list = document.createElement('div'); list.className = 'variant-buttons';
      kids.forEach(v => list.appendChild(buildPickerButton(v, MODS[v])));
      toggle.appendChild(list);
      if (kids.indexOf(mod) >= 0) toggle.open = true;
      group.appendChild(toggle);
      box.appendChild(group);
    });
    // P2b-3: a plain labelled group, not a <details> -- always visible the
    // moment the instrument sheet itself is open, no second disclosure a
    // learner has to find. Tuner/Capture a melody/Interval drill/Rhythm
    // (toolIds) plus the three panel tools (PANEL_TOOL_IDS -- Ear training,
    // How to play it, Music theory) all live here now.
    const toolsGroup = document.createElement('div'); toolsGroup.className = 'picker-tools'; toolsGroup.id = 'pickerTools'; toolsGroup.setAttribute('role', 'group'); toolsGroup.setAttribute('aria-labelledby', 'pickerToolsLabel');
    const label = document.createElement('span'); label.id = 'pickerToolsLabel'; label.className = 'picker-tools-label'; label.textContent = t('picker.tools'); toolsGroup.appendChild(label);
    toolIds.forEach(m => toolsGroup.appendChild(buildPickerButton(m, MODS[m] || TOOLS[m])));
    PANEL_TOOL_IDS.forEach(id => { const p = panels.list().find(pp => pp.id === id); if (p) toolsGroup.appendChild(buildPanelToolButton(p)); });
    box.appendChild(toolsGroup);
  }
  // The tuner tool knows which instrument's open strings it is listening
  // for (tunerKind); the melody-capture tool deliberately does not (it hears
  // anything sung, hummed, whistled or played), so it keeps the generic
  // fallback range -- see src/audio/range.js.
  setInterval(() => { if (!TOOLS[mod] || !micReady || !anTime) return; const buf = new Float32Array(anTime.fftSize); anTime.getFloatTimeDomainData(buf); const toolRange = mod === 'tuner' ? rangeForInstrument(instrumentById[tunerKind === 'vln' ? 'violin' : tunerKind]) : FALLBACK_RANGE; const r = yin(buf, actx.sampleRate, toolRange.fmin, toolRange.fmax, gates.pitch), fr = { rms: r.rms, freq: r.freq && r.clarity > 0.8 ? r.freq : 0 }; if (r.rms > AUDIO_HEARD_RMS_FLOOR) audioHeardTicks++; if (fr.freq) fr.midi = fmidi(fr.freq); meterUpdate(fr.rms); toolPitch(fr, 0.05); }, 50);

  // ---------- backups: a downloadable copy of the whole DB, plus the saved song library
  // (E9: db.v now feeds migrateDB; song library shares the exact store learn/songs/editor
  // panels use, same fallback-to-memory pattern as src/ui/learn.js:92-93) ----------
  function showBackupNudge(text) { $('backupNudgeText').textContent = text; $('backupNudge').hidden = false; }
  function noteBackupMade(t) { lastBackupAt = t; try { localStorage.setItem(BACKUP_AT_KEY, String(t)); } catch (e) {} }
  function backupLibrary() { try { return createLibrary(indexedDbStore(indexedDB, 'bandcoach-songs')); } catch (e) { return createLibrary(memoryStore()); } }
  async function doExportProgress() { const songs = await backupLibrary().exportAll(); return exportProgressFile(DB, { appVersion: APP_VERSION, now: Date.now, songs }); }
  async function saveBackup() {
    const env = await doExportProgress();
    const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'band-coach-progress.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    noteBackupMade(Date.now()); $('backupNudge').hidden = true;
    coach(t('backup.saved'));
  }
  async function doImportProgress(text) {
    const result = importProgressFile(text);
    if (!result.ok) { coach(t(result.errorId)); return result; }
    // The songs go first because that is the store that can fail (e.g.
    // IndexedDB unavailable): if it does, nothing about the live profile
    // has changed yet, so there is nothing to roll back. Only once the
    // songs are safely in does this replace DB, prefs, theme and mod.
    if (Array.isArray(result.songs) && result.songs.length) {
      try { await backupLibrary().importAll(result.songs); }
      catch (e) { const error = en['backup.err.songsNotStored']; coach(t('backup.err.songsNotStored')); return { ok: false, error }; }
    }
    const priorLatencyMs = DB && DB.latencyMs;
    modelNow = Date.now(); DB = sanitizeDB(result.db, undefined, modelNow); DB.latencyMs = num(priorLatencyMs, DB.latencyMs, 0, 300); if (!Array.isArray(DB.custom)) DB.custom = [];
    $('optNames').checked = DB.prefs.names; $('optTheme').value = DB.prefs.theme; applyTheme(DB.prefs.theme); $('optLocale').value = DB.prefs.locale; applyLocale(DB.prefs.locale); setNoteNaming(DB.prefs.noteNaming); $('optNoteSystem').value = DB.prefs.noteNaming.system; $('optAccidentals').value = DB.prefs.noteNaming.accidentals; setMod(DB.prefs.mod);
    if (!writeDB()) { const error = en['backup.err.notSaved']; coach(t('backup.err.notSaved')); return { ok: false, error }; }
    coach(t('backup.restored'));
    return result;
  }
  $('backupSaveBtn').addEventListener('click', function () { this.blur(); saveBackup(); });
  $('backupRestoreInput').addEventListener('change', function () {
    const file = this.files && this.files[0]; this.value = '';
    if (!file) return;
    const reader = new FileReader();
    // Check the file before asking: a file that is not a backup is refused with the reason, and the "replace your progress" confirm is only raised for one that can be restored.
    reader.onload = () => { const text = String(reader.result), check = importProgressFile(text); if (!check.ok) { coach(t(check.errorId)); return; } if (confirm(t('backup.confirmRestore'))) doImportProgress(text); };
    reader.onerror = () => coach(t('backup.readError'));
    reader.readAsText(file);
  });
  $('backupNudgeDismiss').addEventListener('click', () => { $('backupNudge').hidden = true; });

  // ---------- check for updates: a file:// copy can never rewrite or replace itself (browser
  // security, not a missing feature), so the honest alternative is a button that ASKS and answers
  // in place -- never on load, on a timer, on focus, or otherwise unprompted (src/core/update-check.js
  // carries the comparison/fetch policy and is unit-tested on its own; this only wires the button).
  (function () {
    const updBtn = $('updateCheckBtn'), updResult = $('updateCheckResult');
    if (!updBtn || !updResult) return;
    function appendUpdateLink(href) {
      const a = document.createElement('a'); a.href = href; a.rel = 'noopener'; a.textContent = t('update.downloadLinkText'); updResult.appendChild(a);
    }
    function renderUpdateResult(r) {
      updResult.textContent = '';
      if (r.status === 'dev') { updResult.textContent = t('update.devBuild', { version: DEV_VERSION }); return; }
      if (r.status === 'up-to-date') { updResult.textContent = t('update.upToDate', { version: r.latestVersion }); return; }
      if (r.status === 'behind') { updResult.textContent = t('update.behind', { version: r.latestVersion }); appendUpdateLink(r.downloadUrl); return; }
      updResult.textContent = t('update.error'); appendUpdateLink(r.downloadUrl);
    }
    updBtn.addEventListener('click', function () {
      this.blur();
      if (updBtn.disabled) return; // a second press while one is in flight must not start another request
      updBtn.disabled = true; updResult.textContent = t('update.checking');
      checkForUpdate({ currentVersion: APP_VERSION, fetchImpl: typeof fetch === 'function' ? fetch : undefined })
        .then(renderUpdateResult, () => renderUpdateResult({ status: 'error', downloadUrl: FALLBACK_DOWNLOAD_URL }))
        .then(() => { updBtn.disabled = false; });
    });
  })();

  // ---------- optional model pack: same consent-on-press shape as the update check above. Nothing
  // is requested until the button is pressed; the status line only ever READS the local IndexedDB
  // cache (src/core/model-pack.js carries fetch/verify/cache policy and is unit-tested on its own).
  let refreshModelPack = () => {};
  (function () {
    const btn = $('modelPackBtn'), out = $('modelPackStatus');
    if (!btn || !out) return;
    const store = createIndexedDBStore(), inFlight = new Set();
    if (!store) { btn.disabled = true; out.textContent = t('modelPack.noStorage'); return; }
    // Every status write takes a new ticket; a cache read that resolves after a newer write
    // (the on-load read losing a race to a fast press) drops its stale answer.
    let ticket = 0;
    const say = (text) => { ticket++; out.textContent = text; };
    function render() {
      const mine = ++ticket;
      const show = (text) => { if (mine === ticket) out.textContent = text; };
      packStatus({ store, packName: DEFAULT_MODEL_PACK, inFlight }).then(s => { show(s.state === 'cached' ? t('modelPack.cached', { version: s.version }) : s.state === 'downloading' ? t('modelPack.downloading') : t('modelPack.absent')); }, () => { show(t('modelPack.absent')); });
    }
    render(); refreshModelPack = render; // a language switch re-reads the status so it is re-worded
    btn.addEventListener('click', function () {
      this.blur();
      if (btn.disabled) return;
      btn.disabled = true; say(t('modelPack.downloading'));
      loadPack({ manifestUrl: packManifestUrl(), fetchImpl: typeof fetch === 'function' ? fetch : undefined, store, inFlight })
        .then(() => render(), e => { say(t(e && e.code === 'no-manifest' ? 'modelPack.notPublished' : 'modelPack.failed')); })
        .then(() => { btn.disabled = false; });
    });
  })();

  // ---------- feature panels (src/ui/panels.js): learn, songs, ear, theory, history, fingerings, play-along ----------
  // A panel unit registers ONE panel by replacing its own slot:panel line
  // below; everything it needs from the app goes through panelApi.
  const panels = createPanels({ onEscape: () => { closePanel(); const nb = $('navInstrument'); if (document.activeElement === document.body && nb) nb.focus(); } });
  const panelApi = {
    db: () => DB, save: save, mod: () => mod, setMod: m => { closePanel(); setMod(m); }, instrument: id => instrumentById[id || mod], windTransposition: () => { const k = WIND_KINDS[DB.prefs.wind || 'bb']; return k[2] === 'bass' ? 0 : k[1]; }, // wind: the learner's B flat/E flat/F choice (theory panel only; the shared record stays concert)
    audio: () => { ensureAudio(); return actx; }, openMic: openMic, analysers: () => ({ time: anTime, freq: anFreq }), gates: () => gates,
    tone: tone, click: click, now: now, say: say, coach: coach, recordError: recordError, close: () => closePanel(),
    drum: (piece, at) => drumHit(piece, at),
    // openPanel(id): P2b-3, lets one panel open a sibling panel directly --
    // first user, the Songs panel's "Add a song" row (src/ui/songs.js),
    // opening Learn this/Record a tune/Play Along the same way a nav click
    // or a Tools-group panel button does.
    openPanel: id => openPanel(id),
    // store(id): this panel's saved data, kept in DB.panels[id] (plain JSON, 256 KB max; see sanitizePanelData)
    store: id => ({ get: () => (DB.panels && DB.panels[id]) || null, set: obj => { if (!DB.panels) DB.panels = {}; DB.panels[id] = obj; save(); } }),
    // creditNote(instrumentId): a panel-judged correct note feeds THAT
    // instrument's streak and level-up path (e.g. a song practised on
    // guitar credits guitar even if keyboard is still showing on the main
    // screen), same as credit() does for a built-in drill (no session log
    // update, since no session runs while a panel is open). streak is
    // global UI state (the on-screen streak counter), so it always ticks;
    // evaluate() reads/writes the CURRENT mod's S and D() (its own level
    // thresholds), so it only runs when instrumentId is the mod actually
    // showing -- crediting a different instrument's readiness must not
    // silently level up whatever happens to be on screen.
    creditNote: (instrumentId) => {
      streak++;
      const id = MODS[instrumentId] ? instrumentId : mod;
      if (id === mod) { S.ready = clamp(S.ready + S.gain, 0, 1); evaluate(); }
      else { const other = DB.mods[id]; if (other) other.ready = clamp(other.ready + (other.gain || 0.05), 0, 1); }
      save();
    },
    // logSession(): see the logSession() helper near endSession() above --
    // lets a panel (a finished song lesson) leave its own row in DB.sessions.
    logSession: rec => logSession(rec),
    // logEvent(): see the logEvent() helper near logSession() above -- lets
    // a panel (a judged song step) leave its own row in DB.events.
    logEvent: ev => logEvent(ev),
    // midiProof(): live proof this page load has actually heard a MIDI byte
    // -- same test src/core/pathway.js's caller at startSession (2020) uses,
    // exposed here so a mounted panel (the keyboard pathway panel) can ask
    // the same question pathwayState needs without reaching past the API.
    midiProof: () => midiPortInputs.some(i => midiHeard.has(i)),
    // midiOut: "Play it for me" (see midiOutPlay near handleMidiMessage) -- ready() is true only once the learner has picked a connected output.
    midiOut: { ready: () => !!midiOutSelected(), playing: () => midiOutBusy, play: (song, partIndex, onEnd) => midiOutPlay(song, partIndex, onEnd), stop: () => midiOutStop() },
  };
  //
  //
  // slot:panel:w-songs
  registerSongs(panels);
  //
  registerEditor(panels);
  //
  //
  registerEar(panels);
  //
  //
  registerTheory(panels);
  //
  //
  registerHistory(panels);
  //
  //
  registerFingerings(panels);
  //
  //
  registerPlayalong(panels);
  //
  //
  registerPathway(panels);
  //
  //
  // slot:panel:w-fixes
  //
  //
  function openPanel(id) {
    if (sess) endSession(); task = null;
    document.querySelectorAll('#picker button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.panel === id)));
    $('settingsView').hidden = true; $('mainArea').hidden = true; $('panelHost').hidden = false; $('panelSay').textContent = ''; $('panelSay').hidden = false;
    try { panels.open(id, $('panelHost'), panelApi); } catch (e) { recordError('panel:' + id, e); say('That screen could not open.', 'no'); }
    updateNavState();
  }
  function closePanel() {
    $('settingsView').hidden = true;
    if (!panels.current()) { $('mainArea').hidden = false; updateNavState(); return; }
    panels.close(); $('panelHost').hidden = true; $('panelSay').hidden = true; $('mainArea').hidden = false;
    document.querySelectorAll('#picker button[data-panel]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    updateNavState();
  }
  // P2b-2: Settings is a fourth real nav destination (unlike Instrument,
  // it claims aria-current) that shows #settingsView instead of a panel --
  // closePanel() first so any open panel (Songs/Progress/etc) is shut the
  // same way Practice shuts it, then #settingsView replaces #mainArea.
  function openSettings() {
    closePanel();
    $('mainArea').hidden = true; $('panelHost').hidden = true; $('settingsView').hidden = false;
    updateNavState();
  }
  // P2a: maps the currently open panel (if any) onto one of the nav's three
  // destinations -- 'songs' and 'history' are the only panels with a nav
  // button of their own; any other open panel (theory, ear, a panel reached
  // only through the old picker) means no destination is "current", same as
  // a screen the nav doesn't know about.
  // P3-11: 'editor' (Edit notes) and 'playalong' (Play along) are reached
  // only from inside Songs, so they count as Songs too -- otherwise opening
  // either would make the nav go dark, which reads as "you left Songs"
  // even though there is no other screen to go "back" to.
  // The keyboard path panel is reached only from Practice's keyboard options, so it counts as Practice for the same reason.
  function navDestFor(panelId) { return panelId === 'pathway' ? 'practice' : (panelId === 'songs' || panelId === 'editor' || panelId === 'playalong') ? 'songs' : panelId === 'history' ? 'progress' : panelId ? null : 'practice'; }
  // P2b-2: Settings isn't a panel (panels.current() knows nothing about it),
  // so the nav's notion of "current" has to check #settingsView first.
  function currentDest() { return !$('settingsView').hidden ? 'settings' : navDestFor(panels.current()); }
  function updateNavState() {
    const dest = currentDest();
    document.querySelectorAll('#mainNav button[data-route]').forEach(b => { if (b.dataset.route === dest) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  }
  // routeTo() is the nav bar's only entry point: 'practice' closes whatever
  // panel is open, 'songs'/'progress' open the panel that destination maps
  // to. Re-pressing the destination already showing is a no-op guarded
  // BEFORE calling openPanel -- openPanel() unconditionally ends a running
  // session, so without this guard clicking Songs again while Songs is
  // already open would silently end the learner's session for nothing.
  // P2b-1: 'instrument' is not one of those three destinations -- it never
  // claims aria-current (navDestFor/updateNavState don't know it exists)
  // and never touches an open panel, closed or otherwise. It only flips
  // whether the chooser sheet (#picker) is shown, so a learner can open it
  // from any screen -- e.g. from Songs -- without losing their place.
  const NAV_PANEL_FOR = { songs: 'songs', progress: 'history' };
  // F2: routeTo() now reports whether it actually changed screen (true) or
  // hit one of its own no-op guards (false) -- buildNav()'s click handler
  // uses that to decide whether focus should move at all (see
  // focusDestination() below). Instrument always reports true: unlike the
  // other four destinations it has no "already there" guard, only open vs
  // shut, and both are a real, focus-worthy state change.
  function routeTo(dest) {
    if (dest === 'instrument') { setInstrumentSheetOpen($('picker').hidden); return true; }
    // P3-11: navDestFor() now maps editor/playalong onto 'songs' too, so
    // currentDest() === 'songs' while either is open -- the no-op guard
    // below would otherwise swallow "press Songs from Edit notes/Play
    // along" as if Songs were already showing. Only the actual songs panel
    // counts as "already there"; every other case (including re-pressing
    // Songs while Songs is open) still hits the guard unchanged.
    if (dest === 'songs' && panels.current() !== 'songs') { openPanel('songs'); return true; }
    // The keyboard path panel counts as Practice too (navDestFor), so pressing Practice there goes back to the exercise.
    if (dest === 'practice' && panels.current() === 'pathway') { closePanel(); return true; }
    if (dest === currentDest()) return false;
    if (dest === 'practice') { closePanel(); return true; }
    if (dest === 'settings') { openSettings(); return true; }
    const panelId = NAV_PANEL_FOR[dest]; if (!panelId) return false;
    openPanel(panelId); return true;
  }
  // F2: the heading each destination's own screen focuses once routeTo()
  // actually moves there -- 'practice' has no heading of its own inside
  // #mainArea (the stage is a live exercise display, not a titled screen),
  // so a genuine "Songs -> Practice" navigation leaves focus on the nav
  // button the browser already put it on for a real click/Enter/Space,
  // same as the no-op case below; that is an honest landing (you can see
  // and hear the exercise start), never a silent drop to <body>.
  const DEST_HEADING_ID = { songs: 'songsHeading', progress: 'historyHeading', settings: 'settingsTitle' };
  function focusDestination(dest, routed, navBtn) {
    if (!routed) return; // no-op guard: leave focus exactly where the press left it (the nav button)
    if (dest === 'instrument') { const h = $('pickerHeading'); if (!$('picker').hidden && h) h.focus(); else navBtn.focus(); return; }
    const h = $(DEST_HEADING_ID[dest]); if (h) h.focus();
  }
  function buildNav() {
    $('mainNav').setAttribute('aria-label', t('nav.label'));
    document.querySelectorAll('#mainNav button[data-route]').forEach(b => b.addEventListener('click', () => { focusDestination(b.dataset.route, routeTo(b.dataset.route), b); }));
    updateNavState();
  }
  loadDB(); applyLocale(DB.prefs.locale); if (!Array.isArray(DB.custom)) DB.custom = []; $('optNames').checked = DB.prefs.names; $('optTheme').value = DB.prefs.theme; $('optLocale').value = DB.prefs.locale; applyTheme(DB.prefs.theme); $('optNoteSystem').value = DB.prefs.noteNaming.system; $('optAccidentals').value = DB.prefs.noteNaming.accidentals; buildPicker(); pickerAsSheet = hasSavedMod; setInstrumentSheetOpen(!hasSavedMod); buildNav(); setMod(mod); requestAnimationFrame(frame);
  const hook = !__DEBUG_HOOK__ ? null : { state: () => S, db: () => DB, sess: () => sess, task: () => task, cur: cur, note: onNote, answer: answer, tap: onTap, bar: () => bar, playing: () => playing, setMod: setMod, testSource: testSource, heard: () => heard, yin: yin, cap: () => cap, tuner: () => tunerState, tunerLock: () => tunerLock, deaf: () => deafWindow.isDeaf(), deafUntil: () => deafWindow.until(), exportProgress: doExportProgress, importProgress: doImportProgress, audioNow: audioNow, modelNow: () => modelNow, plan: () => sessionPlan, planProgress: () => planProgress,
    // levelDef(): D() -- a test's seam onto a mix level's limit/bpm.
    levelDef: () => D() };
  // Debug-hook slots: replace ONLY your own line with
  //   if (__DEBUG_HOOK__) Object.assign(hook, { … });
  if (__DEBUG_HOOK__) Object.assign(hook, { errors: getErrors });
  // startWithoutMic(): a session on the frames a test injects, with no live mic (Start opens one first; the fake device's tone would mix in).
  if (__DEBUG_HOOK__) Object.assign(hook, { startWithoutMic: startSession });
  if (__DEBUG_HOOK__) Object.assign(hook, { pitchFrame: (fr, dt) => onPitch(fr, dt) });
  if (__DEBUG_HOOK__) Object.assign(hook, { testPluck: testPluck, pitchWorkletActive: () => !!pitchWorkletNode });
  if (__DEBUG_HOOK__) Object.assign(hook, { testDrumHit: testDrumHit });
  //
  if (__DEBUG_HOOK__) Object.assign(hook, { gates: () => gates, calibrate: calibrateNoiseFloor, devices: () => micDevices, pitchWorkletGate: () => lastWorkletGateSent, monoRoute: () => lastMonoRoute,
    // Test-only seam (mic-gate-and-capture): drives the exact same
    // gatesFor()+applyGates() path calibrateNoiseFloor() uses, without the
    // real 3-second quiet-room listen -- lets a characterization test set a
    // known noise floor deterministically and assert on the worklet's own
    // behaviour (whether a quiet frame's pitch reaches the page), not on
    // fabricating a pass.
    setNoiseFloorForTest: floor => { DB.prefs.noiseFloor = floor; applyGates(gatesFor(floor)); save(); } });
  if (__DEBUG_HOOK__) Object.assign(hook, { micOpen: () => micReady, audioExists: () => !!actx, audioSuspended: () => !!(actx && actx.state === 'suspended'), teardownRuns: () => teardownRunCount });
  //
  if (__DEBUG_HOOK__) Object.assign(hook, { judgeChord: judgeChord, chroma: chroma });
  if (__DEBUG_HOOK__) Object.assign(hook, { groove: () => groove, grooveLast: () => grooveLast, grooveBpm: () => S.grooveBpm, grooveOn: v => { grooveOn = !!v; task = null; groove = null; }, grooveInject: (midi, atAudioTime) => { const fire = () => { if (audioNow() >= atAudioTime) onNote(midi, true); else setTimeout(fire, 4); }; fire(); } });
  //
  if (__DEBUG_HOOK__) Object.assign(hook, { kbdTarget: () => kbdTargetDbg });
  if (__DEBUG_HOOK__) Object.assign(hook, { showMe: () => $('showMeBtn').click() });
  //
  if (__DEBUG_HOOK__) Object.assign(hook, { midi: () => ({ on: midiOn, ports: midiPorts, log: midiLog.slice(), held: Array.from(realMidiHeld) }), heldNotes: () => noteState.heldPitches() });
  //
  // slot:hook:rhythm-vocab
  //
  if (__DEBUG_HOOK__) Object.assign(hook, { lastStaff: () => lastStaff, setNotate: v => { DB.prefs.notate[mod] = v; save(); } });
  // slot:hook:notation-wire
  //
  // slot:hook:a11y
  if (__DEBUG_HOOK__) Object.assign(hook, { reducedMotion: () => reducedMotion });
  if (__DEBUG_HOOK__) Object.assign(hook, { panels: () => panels.list().map(p => p.id), openPanel: openPanel, closePanel: closePanel, panelOpen: () => panels.current(), registerPanel: def => panels.register(def) });
  //
  //
  // slot:hook:w-songs
  if (__DEBUG_HOOK__) Object.assign(hook, { songsNote: forwardSongNote, songsNoteAt: forwardSongNoteAt, songsRecordStart: songsRecordStartSec });
  //
  // P3-12: the recording debug seams now live in the Songs record door
  // (src/ui/songs/record-door.js), not the editor panel; the hook's own
  // names (editorSetFrames/editorRecording) are unchanged so tests change
  // little.
  if (__DEBUG_HOOK__) Object.assign(hook, { editorSetFrames: __editorSetDebugFrames, editorSong: __getDebugSong, editorRecording: __editorIsRecording });
  //
  //
  if (__DEBUG_HOOK__) Object.assign(hook, { ear: __earTestHook });
  //
  //
  if (__DEBUG_HOOK__) Object.assign(hook, { theoryCurrentQuestion: theoryCurrentQuestion });
  //
  //
  // slot:hook:w-history
  //
  //
  // slot:hook:w-fingerings
  //
  //
  // slot:hook:w-playalong
  //
  //
  if (__DEBUG_HOOK__) Object.assign(hook, { flash: () => ({ bad: flashBad, good: flashGood }), pitchWorkletRange: () => lastWorkletRangeSent, pitchWorkletFrameSize: () => lastWorkletFrameSize, kbdFocus: kbdFocusInfo });
  // item B2 (Wave kbd): the raw keyRects the last frame drew, for a test to
  // check row grouping, hit-rect size and hand marks without guessing the
  // layout formula itself.
  if (__DEBUG_HOOK__) Object.assign(hook, { kbdRange: () => kbdRange(), kbdKeys: () => keyRects.map(k => ({ m: k.m, x: k.x, y: k.y, w: k.w, h: k.h, black: k.black, row: k.row, hand: k.hand, mark: k.mark })) });
  // item D2 (Wave kbd): the full-keyboard overview drawKbdOverview() set last
  // frame, or null when nothing drew one (non-kbd mods) -- a deep-cloned
  // snapshot, same as kbdKeys(), so a test can hold one frame's value past
  // the next draw() without it changing under it.
  if (__DEBUG_HOOK__) Object.assign(hook, { kbdOverview: () => kbdOverviewRect ? JSON.parse(JSON.stringify(kbdOverviewRect)) : null });
  if (__DEBUG_HOOK__) Object.assign(hook, { audioHeardTicks: () => audioHeardTicks });
  if (__DEBUG_HOOK__) Object.assign(hook, { rangeHeld: () => rangeTest && rangeTest.curMidi !== null ? { stage: rangeTest.stage, midi: rangeTest.curMidi, ms: performance.now() - rangeTest.curSince } : null });
  if (__DEBUG_HOOK__) Object.assign(hook, { kitBox: () => kitBox, kitLabels: () => kitLabels });
  if (__DEBUG_HOOK__) Object.assign(hook, { micHits: () => drumMicHits.slice() });
  if (__DEBUG_HOOK__) window.__coach = hook;

  // Boot is over. Announce it so anything driving the page has a condition to
  // wait on instead of a guess: the markup (#cv and friends) is present long
  // before this line runs, so "the document loaded" never meant "the app is
  // ready". Set in the release build too — the download is driven by the
  // release gate the same way.
  document.documentElement.setAttribute('data-coach-ready', '1');

})();
