// Songs panel (Wave W, unit "songs"): a song list (built-in starter tunes
// plus the learner's own saved songs), a way to add a song from a file, and
// a step-by-step practice lesson built by src/song/lesson.js.
//
// Teacher challenge lists (Wave I, unit I6, src/song/challenge.js): the same
// file input also accepts a teacher-authored .json challenge (a titled list
// of songs). Importing one adds every song to the library and shows it as
// its own list with a "N of M songs passed" line, each song's own pass
// state remembered in api.store('songs-progress') (a song counts as passed
// the moment its own practice lesson reaches the end, whole-piece step
// included -- see the `stepIndex >= plan.steps.length` branch of
// renderPractice()). "Export as a challenge" turns the learner's own saved
// library into a downloadable .json a teacher can hand to another student.
//
// Registered via register(panels) -> panels.register({ id: 'songs', ... }),
// following the panel-frame contract in src/ui/panels.js / the "feature
// panels" block of src/app.js.
//
// Note capture during practice:
//  - The current instrument's `input` (src/instruments/*.js) is 'midi' for
//    only one ready instrument (kbd). Its notes never reach the microphone,
//    so they are read off src/app.js's own key-press pipeline: app.js's
//    onNote() forwards every played note to forwardNote() below (the ONE
//    permitted line in onNote(), see the author brief), and this panel
//    subscribes to that with onMidiNote() while a step is being recorded.
//  - Every other ready instrument is 'mic': pitch is read here directly,
//    on this panel's own timer, from api.openMic() + api.analysers().time
//    through yin() (src/audio/yin.js), gated by api.gates().pitch, with
//    src/audio/onset.js picking out the moment of each new attack so a
//    held or re-attacked note is not counted twice.

import { yin } from '../audio/yin.js';
import { createOnsetDetector } from '../audio/onset.js';
import { rangeForInstrument } from '../audio/range.js';
import { starterSongs } from '../song/starter/index.js';
import { createLibrary, memoryStore, indexedDbStore } from '../song/library.js';
import { validateSong } from '../song/model.js';
import { importMidi } from '../song/import-midi.js';
import { importAbc } from '../song/import-abc.js';
import { importMusicXml } from '../song/import-musicxml.js';
import { buildLessonPlan, nextStep, creditFor } from '../song/lesson.js';
import { routeImportFile } from './songs/import-route.js';
import { judgeAttempt, passesRule } from './songs/practice.js';
import { mapMasteryKeys } from './songs/mastery.js';
import { parseChallenge, buildChallenge } from '../song/challenge.js';

// ---------------------------------------------------------------------------
// onNote() forwarding (the one permitted src/app.js line)
// ---------------------------------------------------------------------------

const noteListeners = [];

// Called from the single added line in src/app.js's onNote(). Fires for
// every played note (MIDI keyboard, on-screen keys, computer keys) whether
// or not the app's own built-in drill is running, so a song practice step
// can hear key presses while no built-in task is active.
export function forwardNote(midi, exact) {
  for (const fn of noteListeners.slice()) {
    try { fn(midi, exact); } catch (e) { /* one bad listener must not break the others */ }
  }
}

function onMidiNote(fn) {
  noteListeners.push(fn);
  return () => {
    const i = noteListeners.indexOf(fn);
    if (i >= 0) noteListeners.splice(i, 1);
  };
}

// ---------------------------------------------------------------------------
// step description in plain words
// ---------------------------------------------------------------------------

const STEP_WORDS = {
  listen: 'Listen',
  rhythm: 'Clap the rhythm',
  pitches: 'Play the notes, any speed',
  'phrase-slow': 'Play it slowly',
  'tempo-ladder': 'Play it up to speed',
  chain: 'Play the phrases together',
  whole: 'Play the whole piece',
};

function stepTitle(step) {
  return STEP_WORDS[step.kind] || step.kind;
}

function stepHint(step) {
  if (step.kind === 'listen') return 'Just listen this time.';
  if (step.kind === 'pitches') return 'Play the notes in order. Speed does not matter yet.';
  if (step.kind === 'tempo-ladder') return 'Play along at ' + step.bpm + ' beats a minute.';
  if (step.bpm) return 'Play along at ' + step.bpm + ' beats a minute.';
  return 'Play along.';
}

// ---------------------------------------------------------------------------
// mastery crediting: writes into the SAME per-item store a built-in drill
// uses (src/app.js `it(id)` / `S.item[id]`), for the ids mapMasteryKeys()
// could map. Instruments with no per-item scheme (mapMasteryKeys returns an
// empty array for them) are left untouched — nothing invented.
// ---------------------------------------------------------------------------

function applyMasteryCredit(api, instrumentId, mapped) {
  if (!mapped.length) return;
  const db = api.db();
  if (!db.mods) db.mods = {};
  if (!db.mods[instrumentId]) db.mods[instrumentId] = { item: {}, trans: {}, acc: {}, cr: {}, level: 1, ready: 0, judged: 0, tick: 0 };
  const modState = db.mods[instrumentId];
  if (!modState.item) modState.item = {};
  for (const { id, hit } of mapped) {
    const o = modState.item[id] || (modState.item[id] = { m: 0.4, n: 0, last: 0, seen: 0 });
    o.m = o.m * 0.75 + (hit ? 1 : 0) * 0.25;
    o.n++;
    o.last = Date.now();
  }
  api.save();
}

// ---------------------------------------------------------------------------
// panel
// ---------------------------------------------------------------------------

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

function mountSongsPanel(hostEl, api) {
  let library;
  try {
    library = createLibrary(indexedDbStore(indexedDB, 'bandcoach-songs'));
  } catch (e) {
    library = createLibrary(memoryStore());
  }

  const store = api.store('songs');
  // { [songId]: true } for every song whose lesson has been played through
  // to the end at least once -- the ledger a loaded challenge reads its
  // "N of M songs passed" line from (plan D7: a ledger of pass/fail, no
  // XP or leagues).
  const progressStore = api.store('songs-progress');
  // The challenge currently being shown in challengeSection, or null.
  let currentChallenge = null;

  // practice state for the currently chosen song+part, or null
  let practice = null; // { song, partId, instrument, plan, results, stepIndex, recording, playedEvents, recordStartSec, stop }
  // The "Notes heard so far" paragraph from the last renderPractice(), when
  // a recording is possible for the current step. Captured notes update its
  // text in place (updateCount()) instead of rebuilding practiceSection, so
  // a learner tabbed onto the record button keeps keyboard focus while
  // playing a phrase.
  let countEl = null;

  hostEl.innerHTML = '';
  const heading = el('h2', { text: 'Songs' });
  const intro = el('p', { class: 'panel-songs-intro', text: 'Pick a tune to practise, or add your own from a file.' });

  const listSection = el('section', { 'aria-label': 'Your songs' });
  const listUl = el('ul', { class: 'panel-songs-list' });
  listSection.appendChild(listUl);

  const importLabel = el('label', { for: 'songsFileInput', text: 'Add a song, or a teacher’s challenge, from a file (.mid, .midi, .abc, .xml, .musicxml or .json)' });
  const importInput = el('input', { type: 'file', id: 'songsFileInput', accept: '.mid,.midi,.abc,.xml,.musicxml,.json' });
  const importMsg = el('div', { class: 'panel-songs-msg', role: 'status' });
  const importSection = el('section', {}, [importLabel, importInput, importMsg]);

  const challengeSection = el('section', { class: 'panel-songs-challenge', hidden: 'hidden' });

  const exportTitleLabel = el('label', { for: 'challengeTitleInput', text: 'Challenge title' });
  const exportTitleInput = el('input', { type: 'text', id: 'challengeTitleInput', value: 'My songs' });
  const exportBtn = el('button', { type: 'button', text: 'Export as a challenge', onclick: exportChallenge });
  const exportMsg = el('div', { class: 'panel-songs-export-msg', role: 'status' });
  const exportSection = el('section', { 'aria-label': 'Export a challenge' }, [
    exportTitleLabel, exportTitleInput, exportBtn, exportMsg,
  ]);

  const practiceSection = el('section', { class: 'panel-songs-practice', hidden: 'hidden' });

  hostEl.appendChild(heading);
  hostEl.appendChild(intro);
  hostEl.appendChild(listSection);
  hostEl.appendChild(importSection);
  hostEl.appendChild(challengeSection);
  hostEl.appendChild(exportSection);
  hostEl.appendChild(practiceSection);

  function say(text, kind) {
    importMsg.textContent = text;
    if (typeof api.say === 'function') api.say(text, kind);
  }

  async function refreshList() {
    listUl.innerHTML = '';
    starterSongs.forEach((song) => listUl.appendChild(songRow(song, null)));
    let saved = [];
    try { saved = await library.list(); } catch (e) { saved = []; }
    saved
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .forEach((meta) => listUl.appendChild(songRow(meta, meta.id)));
  }

  function songRow(songOrMeta, libraryId) {
    const li = el('li', { class: 'panel-songs-row' });
    const btn = el('button', {
      type: 'button',
      text: songOrMeta.title,
      onclick: async () => {
        const song = libraryId ? await library.get(libraryId) : songOrMeta;
        if (!song) { say('That song could not be found any more.', 'no'); return; }
        openSong(song);
      },
    });
    li.appendChild(btn);
    return li;
  }

  // Renders (or re-renders, e.g. after a song is marked passed) the loaded
  // challenge's own list: title, who it is from, an optional note, the
  // "N of M songs passed" summary, and one button per song that opens it
  // straight into practice via the SAME openSong() a starter/library row
  // uses -- a challenge song is a real Song object throughout, never a
  // separate code path.
  function renderChallenge(challenge) {
    currentChallenge = challenge;
    const progress = progressStore.get() || {};
    const passedCount = challenge.songs.filter((s) => progress[s.id]).length;
    challengeSection.hidden = false;
    challengeSection.innerHTML = '';
    challengeSection.appendChild(el('h3', { text: challenge.title }));
    if (challenge.from) challengeSection.appendChild(el('p', { text: 'From: ' + challenge.from }));
    if (challenge.note) challengeSection.appendChild(el('p', { text: challenge.note }));
    challengeSection.appendChild(el('p', {
      class: 'panel-songs-challenge-progress',
      text: passedCount + ' of ' + challenge.songs.length + ' songs passed',
    }));
    const ul = el('ul', {});
    challenge.songs.forEach((song) => {
      const passed = !!progress[song.id];
      const li = el('li', {}, [
        el('button', { type: 'button', text: song.title + (passed ? ' (passed)' : ''), onclick: () => openSong(song) }),
      ]);
      ul.appendChild(li);
    });
    challengeSection.appendChild(ul);
  }

  // Marks `songId` passed in the ledger (idempotent) and, if it belongs to
  // the currently displayed challenge, re-renders that list so the "N of M"
  // count and the song's own row update right away.
  function markSongPassed(songId) {
    const progress = progressStore.get() || {};
    if (!progress[songId]) {
      progress[songId] = true;
      progressStore.set(progress);
    }
    if (currentChallenge && currentChallenge.songs.some((s) => s.id === songId)) renderChallenge(currentChallenge);
  }

  // "Export as a challenge": bundles every song currently in the learner's
  // own saved library (not the built-in starter tunes, which every copy of
  // the app already ships with) into one .json file a teacher hands to a
  // student, via a Blob + a hidden a[download] click -- the same pattern a
  // "save my work" button uses anywhere in a browser, no server involved
  // (plan D6).
  async function exportChallenge() {
    let songs = [];
    try { songs = await library.exportAll(); } catch (e) { songs = []; }
    if (!songs.length) {
      exportMsg.textContent = 'Add some songs to your library first, then export them as a challenge.';
      return;
    }
    const title = exportTitleInput.value.trim() || 'My songs';
    let json;
    try {
      json = buildChallenge(title, songs);
    } catch (e) {
      exportMsg.textContent = 'That challenge could not be built: ' + (e && e.message ? e.message : String(e));
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fileName = (title.replace(/[^\w.-]+/g, '_') || 'challenge') + '.challenge.json';
    const a = el('a', { href: url, download: fileName });
    a.click();
    // Revoked a moment later, not synchronously: some browsers cancel an
    // in-flight download if the object URL disappears before the click is
    // fully handled.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    exportMsg.textContent = 'Exported "' + title + '" with ' + songs.length + ' song' + (songs.length === 1 ? '' : 's') + '.';
  }

  function openSong(song) {
    practiceSection.hidden = false;
    practiceSection.innerHTML = '';
    practiceSection.appendChild(el('h3', { text: song.title }));
    if (song.parts.length > 1) {
      const partList = el('ul', {});
      song.parts.forEach((part) => {
        const li = el('li', {}, [
          el('button', { type: 'button', text: 'Practise: ' + part.name, onclick: () => startPractice(song, part.id) }),
        ]);
        partList.appendChild(li);
      });
      practiceSection.appendChild(partList);
    } else if (song.parts.length === 1) {
      startPractice(song, song.parts[0].id);
    } else {
      practiceSection.appendChild(el('p', { text: 'This song has no notes to practise yet.' }));
    }
  }

  function startPractice(song, partId) {
    stopRecording();
    const instrumentId = api.mod();
    const instrument = api.instrument(instrumentId);
    if (!instrument) {
      practiceSection.innerHTML = '';
      practiceSection.appendChild(el('p', { text: 'Pick an instrument on the main screen first, then come back here to practise.' }));
      return;
    }
    const saved = store.get();
    const level = saved && saved.songId === song.id && saved.partId === partId && Number.isFinite(saved.level) ? saved.level : 1;
    const plan = buildLessonPlan(song, partId, instrument, { level });
    practice = { song, partId, instrument, instrumentId, plan, results: [], stepIndex: 0, recording: false, playedEvents: [], recordStartSec: 0, stop: null };
    store.set({ songId: song.id, partId, instrumentId, level });
    renderPractice();
  }

  function updateCount() {
    if (countEl) countEl.textContent = practice.recording ? 'Notes heard so far: ' + practice.playedEvents.length : '';
    else renderPractice();
  }

  function renderPractice() {
    countEl = null;
    practiceSection.innerHTML = '';
    practiceSection.appendChild(el('h3', { text: practice.song.title }));
    const { plan, stepIndex } = practice;
    if (stepIndex >= plan.steps.length) {
      markSongPassed(practice.song.id);
      practiceSection.appendChild(el('p', { text: 'Nicely done. You have played through the whole piece.' }));
      practiceSection.appendChild(el('button', { type: 'button', text: 'Practise again', onclick: () => startPractice(practice.song, practice.partId) }));
      practiceSection.appendChild(el('button', { type: 'button', text: 'Back to songs', onclick: () => { practice = null; practiceSection.hidden = true; } }));
      return;
    }
    const step = plan.steps[stepIndex];
    if (plan.fit.unplayable.length && stepIndex === 0) {
      practiceSection.appendChild(el('p', {
        class: 'panel-songs-warn',
        text: plan.fit.unplayable.length + ' note' + (plan.fit.unplayable.length === 1 ? '' : 's') + ' in this song cannot be played on this instrument and will be skipped.',
      }));
    }
    if (plan.fit.changes.length) {
      practiceSection.appendChild(el('p', { text: 'This song was ' + plan.fit.changes.join('; ') + ' to fit your instrument.' }));
    }
    practiceSection.appendChild(el('h4', { text: stepTitle(step) + ' (bars ' + (step.bars[0] + 1) + '-' + (step.bars[1] + 1) + ')' }));
    practiceSection.appendChild(el('p', { text: stepHint(step) }));

    const playBtn = el('button', { type: 'button', text: 'Play it', onclick: () => playPhrase(step) });
    practiceSection.appendChild(playBtn);

    if (step.passRule) {
      const recordBtn = el('button', {
        type: 'button',
        text: practice.recording ? 'Stop and check' : 'Your turn',
        onclick: () => (practice.recording ? finishRecording(step) : startRecording()),
      });
      practiceSection.appendChild(recordBtn);
      countEl = el('p', { class: 'panel-songs-count', text: practice.recording ? 'Notes heard so far: ' + practice.playedEvents.length : '' });
      practiceSection.appendChild(countEl);
    } else {
      practiceSection.appendChild(el('button', { type: 'button', text: 'Next', onclick: () => advance(true, null) }));
    }
  }

  function playPhrase(step) {
    const notes = step.notes;
    if (!notes.length) return;
    const at0 = api.now() + 0.15;
    const spacing = 0.55;
    // Schedule by real tick offsets when the step has a tempo; otherwise
    // (the "pitches" step, bpm 0) space notes evenly since there is no
    // tempo to follow.
    if (step.bpm > 0) {
      const ticksPerQuarter = practice.song.ticksPerQuarter;
      const t0 = notes[0].start;
      notes.forEach((n) => {
        const secOffset = ((n.start - t0) / ticksPerQuarter) * (60 / step.bpm);
        const dur = Math.max(0.12, (n.dur / ticksPerQuarter) * (60 / step.bpm));
        api.tone(n.midi, at0 + secOffset, dur, 0.22);
      });
    } else {
      notes.forEach((n, i) => api.tone(n.midi, at0 + i * spacing, spacing * 0.85, 0.22));
    }
  }

  function startRecording() {
    practice.recording = true;
    practice.playedEvents = [];
    practice.recordStartSec = api.now();
    if (practice.instrument.input === 'midi') {
      const unsubscribe = onMidiNote((midi) => {
        practice.playedEvents.push({ midi, atSec: api.now() - practice.recordStartSec });
        updateCount();
      });
      practice.stop = unsubscribe;
    } else {
      api.openMic().catch(() => say('The microphone was blocked. Allow microphone access, or switch to the keyboard.', 'no'));
      let onset;
      const timer = setInterval(() => {
        const analysers = api.analysers();
        const audio = api.audio();
        if (!analysers.time || !audio) return;
        if (!onset) onset = createOnsetDetector({ sampleRate: audio.sampleRate, frameSize: analysers.time.fftSize });
        const buf = new Float32Array(analysers.time.fftSize);
        analysers.time.getFloatTimeDomainData(buf);
        const o = onset.push(buf);
        if (!o.onset) return;
        const toolRange = rangeForInstrument(practice.instrument);
        const r = yin(buf, audio.sampleRate, toolRange.fmin, toolRange.fmax, api.gates().pitch);
        if (!r.freq || !(r.clarity > 0.7)) return;
        const midi = Math.round(69 + 12 * Math.log2(r.freq / 440));
        practice.playedEvents.push({ midi, atSec: api.now() - practice.recordStartSec });
        updateCount();
      }, 50);
      practice.stop = () => clearInterval(timer);
    }
    renderPractice();
  }

  function stopRecording() {
    if (practice && practice.stop) { practice.stop(); practice.stop = null; }
    if (practice) practice.recording = false;
  }

  function finishRecording(step) {
    const elapsedMs = Math.max(0, (api.now() - practice.recordStartSec) * 1000);
    stopRecording();
    const timed = step.kind !== 'pitches';
    const result = judgeAttempt(step.notes, practice.playedEvents, {
      bpm: step.bpm || practice.song.bpm,
      ticksPerQuarter: practice.song.ticksPerQuarter,
      policy: practice.instrument.octavePolicy,
      timed,
    });
    const passed = passesRule(result, step.passRule);
    // Every correctly-pitched note counts toward the trainer's own streak
    // and level-up path, not just this song's mastery record (applyMasteryCredit
    // below), whether or not the whole step ends up passing.
    if (typeof api.creditNote === 'function') {
      result.matches.forEach((m) => { if (m.ok) api.creditNote(); });
    }
    advance(passed, result, elapsedMs);
  }

  function advance(passed, result, elapsedMs) {
    const step = practice.plan.steps[practice.stepIndex];
    practice.results.push({ stepIndex: practice.stepIndex, passed });
    if (step.passRule) {
      const credit = creditFor({ step, passed, elapsedMs: elapsedMs || 0, judgedCount: result ? result.judgedCount : undefined });
      const mapped = mapMasteryKeys(credit.masteryKeys, practice.instrumentId, (api.db().prefs || {}));
      applyMasteryCredit(api, practice.instrumentId, mapped);
      say(passed
        ? 'Nice. ' + (result ? result.hitCount + ' of ' + result.judgedCount + ' notes.' : '')
        : 'Not quite yet — try that again.', passed ? 'ok' : 'no');
    }
    practice.stepIndex = nextStep(practice.plan, practice.results);
    practice.playedEvents = [];
    store.set({ songId: practice.song.id, partId: practice.partId, instrumentId: practice.instrumentId, level: practice.plan.level });
    renderPractice();
  }

  async function handleFile() {
    const file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) return;
    const route = routeImportFile(file.name);
    if (route.kind === 'unsupported-mxl') {
      say('Compressed .mxl files are not supported yet. Export or open it as an uncompressed .musicxml file first.', 'no');
      return;
    }
    if (route.kind === 'unknown') {
      say('That file type is not supported yet. Use a .mid, .midi, .abc, .xml, .musicxml or .json file.', 'no');
      return;
    }
    if (route.kind === 'challenge') {
      let challenge;
      try {
        const text = await readFile(file, route.readAs);
        challenge = parseChallenge(text);
      } catch (e) {
        say('That file could not be read: ' + (e && e.message ? e.message : String(e)), 'no');
        return;
      }
      try {
        for (const s of challenge.songs) await library.add(s, { now: Date.now() });
      } catch (e) {
        say('The challenge could not be fully saved: ' + (e && e.message ? e.message : String(e)), 'no');
        return;
      }
      say('Added the "' + challenge.title + '" challenge (' + challenge.songs.length + ' song' + (challenge.songs.length === 1 ? '' : 's') + ').', 'ok');
      renderChallenge(challenge);
      await refreshList();
      return;
    }
    let song, warnings;
    try {
      const data = await readFile(file, route.readAs);
      if (route.kind === 'midi') ({ song, warnings } = importMidi(new Uint8Array(data), { fileName: file.name }));
      else if (route.kind === 'abc') ({ song, warnings } = importAbc(data, { fileName: file.name }));
      else ({ song, warnings } = importMusicXml(data, { fileName: file.name }));
    } catch (e) {
      say('That file could not be read: ' + (e && e.message ? e.message : String(e)), 'no');
      return;
    }
    const { ok, errors } = validateSong(song);
    if (!ok) {
      say('That file did not turn into a usable song: ' + errors.join('; '), 'no');
      return;
    }
    try {
      await library.add(song, { now: Date.now() });
    } catch (e) {
      say('The song could not be saved: ' + (e && e.message ? e.message : String(e)), 'no');
      return;
    }
    if (warnings && warnings.length) say('Added "' + song.title + '". ' + warnings.join(' '), 'ok');
    else say('Added "' + song.title + '" to your songs.', 'ok');
    await refreshList();
  }

  importInput.addEventListener('change', handleFile);

  refreshList();

  return {
    show() {
      refreshList();
    },
    hide() {
      stopRecording();
    },
  };
}

export function register(panels) {
  panels.register({
    id: 'songs',
    name: 'Songs',
    tag: 'practice a tune',
    color: '#5be08a',
    mount: mountSongsPanel,
  });
}
