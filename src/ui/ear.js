// Ear training panel (id "ear"). Wires src/core/ear/index.js's ten pure
// exercise generators to sound (api.tone/api.click), answer widgets (choice
// buttons, an on-screen note/rhythm entry, or the microphone), and a
// per-exercise level that adapts to how the learner is doing. All timing and
// leveling maths lives in src/ui/ear/state.js so it can be unit-tested
// without a browser; this file is just DOM wiring.
import { EAR_EXERCISES, makeQuestion, checkAnswer } from '../core/ear/index.js';
import { SCALE_FAMILIES } from '../core/ear/scales-modes.js';
import { yin } from '../audio/yin.js';
import {
  defaultExerciseState,
  recordAnswer,
  accuracy,
  secondsPerQuarter,
  tapsToOnsets,
  centsToMidi,
  segmentPitches,
} from './ear/state.js';

// Test-only introspection (only ever read behind __DEBUG_HOOK__, see the
// slot:hook:w-ear wiring in src/app.js): the currently mounted panel's live
// question/response, so a characterization test can grade the exact question
// the deterministic seed produced instead of guessing at it.
let debugRef = null;
export function __earTestHook() {
  return debugRef;
}

const MAX_LEVEL = 5;
// Fixed playback tempo for rhythm dictation and song-rhythm (their play
// events are in quarter notes, not seconds, unlike every other exercise
// here). Slow enough that a learner's tap timing has room inside
// rhythm-dictation's default 40-tick tolerance (about 80ms at this tempo).
const RHYTHM_BPM = 60;
const MIC_POLL_MS = 90;
const PITCH_FMIN = 70;
const PITCH_FMAX = 1200;

// Plain-word screen names (the brief's own wording), independent of the
// core module's own short labels used elsewhere.
const EXERCISE_TITLES = {
  degrees: 'Scale degrees',
  'melodic-dictation': 'Melodic dictation',
  'song-dictation': 'Dictation from songs',
  'rhythm-dictation': 'Rhythm dictation',
  'song-rhythm': 'Rhythms from songs',
  progressions: 'Chord progressions',
  'scales-modes': 'Scales and modes',
  inversions: 'Chord inversions',
  intonation: 'In tune or not',
  'sing-back': 'Sing it back',
};
const EXERCISE_ORDER = Object.keys(EXERCISE_TITLES);

function choiceLabel(exerciseId, value) {
  if (exerciseId === 'scales-modes' && SCALE_FAMILIES[value]) return SCALE_FAMILIES[value].label;
  return String(value);
}

function noteName(midi) {
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return NAMES[pc] + octave;
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  (children || []).forEach((c) => node.appendChild(c));
  return node;
}

function loadStore(api) {
  const raw = api.store('ear').get();
  const store = raw && typeof raw === 'object' ? raw : {};
  if (typeof store.seedCounter !== 'number') store.seedCounter = 0;
  if (!store.exercises || typeof store.exercises !== 'object') store.exercises = {};
  EXERCISE_ORDER.forEach((id) => {
    const s = store.exercises[id];
    if (!s || typeof s.level !== 'number') store.exercises[id] = defaultExerciseState();
  });
  if (!EXERCISE_ORDER.includes(store.lastExercise)) store.lastExercise = EXERCISE_ORDER[0];
  return store;
}

export function registerEar(panels) {
  panels.register({
    id: 'ear',
    name: 'Ear training',
    tag: 'listen & answer',
    color: '#5be08a',
    mount(hostEl, api) {
      const store = loadStore(api);
      function save() {
        api.store('ear').set(store);
      }

      let exerciseId = store.lastExercise;
      let question = null;
      let response = []; // in-progress answer for choice-sequence / note-entry / rhythm-entry
      let revealed = false;
      let graded = false;
      let micTimer = null;
      let micSamples = [];
      let micTapTimes = null; // rhythm entry uses this array of api.now() timestamps

      hostEl.innerHTML = '';
      const root = el('div', { class: 'panel-ear' });
      const heading = el('h2', { text: 'Ear training' });
      const sub = el('p', { class: 'sub', text: 'Listen, then answer. Each exercise has its own level that moves up after a run of right answers and down after repeated misses.' });

      const exercisePicker = el('div', { class: 'ear-exercises', role: 'group', 'aria-label': 'Choose an exercise' });
      const exerciseButtons = {};
      EXERCISE_ORDER.forEach((id) => {
        const btn = el('button', { type: 'button', 'data-exercise': id, 'aria-pressed': 'false', text: EXERCISE_TITLES[id] });
        btn.addEventListener('click', () => selectExercise(id));
        exerciseButtons[id] = btn;
        exercisePicker.appendChild(btn);
      });

      const status = el('p', { class: 'ear-status', id: 'earStatus' });
      const prompt = el('p', { class: 'ear-prompt', id: 'earPrompt' });

      const controls = el('div', { class: 'ear-controls' });
      const playBtn = el('button', { type: 'button', id: 'earPlayBtn', text: 'Hear it again' });
      const revealBtn = el('button', { type: 'button', id: 'earRevealBtn', text: 'Show me the answer' });
      const nextBtn = el('button', { type: 'button', id: 'earNextBtn', text: 'Next question' });
      playBtn.addEventListener('click', () => playQuestion());
      revealBtn.addEventListener('click', () => reveal());
      nextBtn.addEventListener('click', () => nextQuestion());
      controls.appendChild(playBtn);
      controls.appendChild(revealBtn);
      controls.appendChild(nextBtn);

      const answerArea = el('div', { class: 'ear-answer', id: 'earAnswerArea' });
      const feedback = el('p', { class: 'ear-feedback', id: 'earFeedback', role: 'status', 'aria-live': 'polite' });
      const explain = el('p', { class: 'ear-explain', id: 'earExplain', hidden: 'hidden' });

      root.appendChild(heading);
      root.appendChild(sub);
      root.appendChild(exercisePicker);
      root.appendChild(status);
      root.appendChild(prompt);
      root.appendChild(controls);
      root.appendChild(answerArea);
      root.appendChild(feedback);
      root.appendChild(explain);
      hostEl.appendChild(root);

      function exerciseState() {
        return store.exercises[exerciseId];
      }

      function renderStatus() {
        const s = exerciseState();
        const acc = accuracy(s);
        const names = EAR_EXERCISES[exerciseId].levelNames || [];
        const levelName = names[s.level - 1] || `Level ${s.level}`;
        status.textContent = `Level ${s.level} of ${MAX_LEVEL} — ${levelName}.` + (acc == null ? '' : ` Accuracy this session: ${Math.round(acc * 100)}%.`);
        Object.entries(exerciseButtons).forEach(([id, btn]) => btn.setAttribute('aria-pressed', String(id === exerciseId)));
      }

      function stopMic() {
        if (micTimer) {
          clearInterval(micTimer);
          micTimer = null;
        }
      }

      function clearAnswerArea() {
        answerArea.innerHTML = '';
      }

      function scheduleEvents(startAt) {
        const isRhythm = exerciseId === 'rhythm-dictation' || exerciseId === 'song-rhythm';
        question.play.forEach((ev) => {
          const t = isRhythm ? ev.t * secondsPerQuarter(RHYTHM_BPM) : ev.t;
          const dur = isRhythm ? ev.dur * secondsPerQuarter(RHYTHM_BPM) : ev.dur;
          const at = startAt + t;
          if (isRhythm) {
            api.click(at, false);
            return;
          }
          (ev.midi || []).forEach((m) => {
            api.tone(centsToMidi(m, ev.cents), at, dur);
          });
        });
      }

      function playQuestion() {
        if (!question) return;
        api.audio();
        const startAt = api.now() + 0.15;
        scheduleEvents(startAt);
      }

      function reveal() {
        if (!question) return;
        revealed = true;
        explain.hidden = false;
        explain.textContent = question.explain;
      }

      function setFeedback(ok, detail) {
        feedback.textContent = ok ? 'Correct.' : `Not quite. ${detail || ''}`.trim();
        feedback.className = 'ear-feedback ' + (ok ? 'ok' : 'no');
      }

      function grade(rawResponse, opts) {
        if (graded || !question) return;
        graded = true;
        const result = checkAnswer(exerciseId, question, rawResponse, opts || {});
        store.exercises[exerciseId] = recordAnswer(exerciseState(), result.ok, MAX_LEVEL);
        save();
        setFeedback(result.ok, result.ok ? '' : `Expected: ${JSON.stringify(question.answer)}.`);
        renderStatus();
        reveal();
        api.say(result.ok ? 'Nice ear.' : 'Listen again and compare.', result.ok ? 'ok' : 'no');
      }

      function renderChoiceSingle() {
        clearAnswerArea();
        const group = el('div', { class: 'ear-choices', role: 'group', 'aria-label': 'Your answer' });
        question.choices.forEach((choice) => {
          const btn = el('button', { type: 'button', text: choiceLabel(exerciseId, choice) });
          btn.addEventListener('click', () => grade(choice));
          group.appendChild(btn);
        });
        answerArea.appendChild(group);
      }

      function renderChoiceSequence() {
        clearAnswerArea();
        response = [];
        const need = question.answer.length;
        const progress = el('p', { class: 'ear-progress', id: 'earProgress' });
        const group = el('div', { class: 'ear-choices', role: 'group', 'aria-label': 'Your answer, in order' });
        function renderProgress() {
          progress.textContent = `Picked ${response.length} of ${need}: ${response.join(', ') || '(none yet)'}`;
        }
        renderProgress();
        question.choices.forEach((choice) => {
          const btn = el('button', { type: 'button', text: choiceLabel(exerciseId, choice) });
          btn.addEventListener('click', () => {
            if (graded || response.length >= need) return;
            response = response.concat([choice]);
            renderProgress();
            if (response.length === need) grade(response.slice());
          });
          group.appendChild(btn);
        });
        const clearBtn = el('button', { type: 'button', text: 'Clear picks' });
        clearBtn.addEventListener('click', () => {
          if (graded) return;
          response = [];
          renderProgress();
        });
        answerArea.appendChild(progress);
        answerArea.appendChild(group);
        answerArea.appendChild(clearBtn);
      }

      function renderNoteEntry() {
        clearAnswerArea();
        response = [];
        const need = question.answer.length;
        const progress = el('p', { class: 'ear-progress', id: 'earProgress' });
        function renderProgress() {
          progress.textContent = `Entered ${response.length} of ${need}: ${response.map(noteName).join(', ') || '(none yet)'}`;
        }
        renderProgress();
        const keys = el('div', { class: 'ear-note-entry', role: 'group', 'aria-label': 'Enter the notes you heard' });
        for (let m = 48; m <= 84; m++) {
          const btn = el('button', { type: 'button', text: noteName(m) });
          btn.addEventListener('click', () => {
            if (graded || response.length >= need) return;
            response.push(m);
            renderProgress();
            if (response.length === need) grade(response.slice(), { foldOctave: false });
          });
          keys.appendChild(btn);
        }
        const backBtn = el('button', { type: 'button', text: 'Backspace' });
        backBtn.addEventListener('click', () => {
          if (graded) return;
          response.pop();
          renderProgress();
        });
        answerArea.appendChild(progress);
        answerArea.appendChild(keys);
        answerArea.appendChild(backBtn);
      }

      function renderRhythmEntry() {
        clearAnswerArea();
        micTapTimes = [];
        const progress = el('p', { class: 'ear-progress', id: 'earProgress', text: 'Taps recorded: 0' });
        const tapBtn = el('button', { type: 'button', id: 'earTapBtn', text: 'Tap' });
        tapBtn.addEventListener('click', () => {
          if (graded) return;
          micTapTimes.push(api.now());
          progress.textContent = `Taps recorded: ${micTapTimes.length}`;
        });
        const clearBtn = el('button', { type: 'button', text: 'Clear taps' });
        clearBtn.addEventListener('click', () => {
          if (graded) return;
          micTapTimes = [];
          progress.textContent = 'Taps recorded: 0';
        });
        const submitBtn = el('button', { type: 'button', text: 'Submit rhythm' });
        submitBtn.addEventListener('click', () => {
          if (graded) return;
          grade(tapsToOnsets(micTapTimes, RHYTHM_BPM));
        });
        answerArea.appendChild(progress);
        answerArea.appendChild(tapBtn);
        answerArea.appendChild(clearBtn);
        answerArea.appendChild(submitBtn);
      }

      function renderMicEntry() {
        clearAnswerArea();
        micSamples = [];
        const status2 = el('p', { class: 'ear-progress', id: 'earProgress', text: 'Not listening yet.' });
        const startBtn = el('button', { type: 'button', text: 'Start listening' });
        const stopBtn = el('button', { type: 'button', text: "I'm done — grade it", disabled: 'disabled' });
        startBtn.addEventListener('click', async () => {
          if (graded) return;
          startBtn.disabled = true;
          try {
            await api.openMic();
          } catch (e) {
            api.recordError('ear:openMic', e);
            status2.textContent = 'Could not open the microphone.';
            startBtn.disabled = false;
            return;
          }
          micSamples = [];
          status2.textContent = 'Listening… sing the phrase.';
          stopBtn.disabled = false;
          const { time } = api.analysers();
          const actx = api.audio();
          micTimer = setInterval(() => {
            if (!time || !actx) return;
            const buf = new Float32Array(time.fftSize);
            time.getFloatTimeDomainData(buf);
            const r = yin(buf, actx.sampleRate, PITCH_FMIN, PITCH_FMAX, api.gates().pitch);
            micSamples.push(r.freq && r.clarity > 0.8 ? 69 + 12 * Math.log2(r.freq / 440) : null);
          }, MIC_POLL_MS);
        });
        stopBtn.addEventListener('click', () => {
          if (graded) return;
          stopMic();
          stopBtn.disabled = true;
          const notes = segmentPitches(micSamples);
          status2.textContent = `Heard ${notes.length} note${notes.length === 1 ? '' : 's'}.`;
          grade(notes);
        });
        answerArea.appendChild(status2);
        answerArea.appendChild(startBtn);
        answerArea.appendChild(stopBtn);
      }

      function renderAnswerWidget() {
        if (exerciseId === 'melodic-dictation' || exerciseId === 'song-dictation') return renderNoteEntry();
        if (exerciseId === 'rhythm-dictation' || exerciseId === 'song-rhythm') return renderRhythmEntry();
        if (exerciseId === 'sing-back') return renderMicEntry();
        if (Array.isArray(question.answer)) return renderChoiceSequence();
        return renderChoiceSingle();
      }

      function nextQuestion() {
        stopMic();
        revealed = false;
        graded = false;
        response = [];
        feedback.textContent = '';
        feedback.className = 'ear-feedback';
        explain.hidden = true;
        explain.textContent = '';
        const seed = store.seedCounter;
        store.seedCounter += 1;
        save();
        question = makeQuestion(exerciseId, exerciseState().level, seed);
        prompt.textContent = question.prompt;
        renderAnswerWidget();
        renderStatus();
        playQuestion();
      }

      function selectExercise(id) {
        if (!EAR_EXERCISES[id]) return;
        stopMic();
        exerciseId = id;
        store.lastExercise = id;
        save();
        nextQuestion();
      }

      debugRef = {
        getExerciseId: () => exerciseId,
        getQuestion: () => question,
        getResponse: () => response,
        getStore: () => store,
      };

      selectExercise(exerciseId);

      return {
        show() {
          renderStatus();
        },
        hide() {
          stopMic();
        },
      };
    },
  });
}
