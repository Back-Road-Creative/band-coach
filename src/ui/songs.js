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
// Band packs (src/song/band-pack.js): the same file input also accepts a
// .bandpack file -- a whole band's set list, plus optionally who plays which
// part of each song, handed around as one zip. Importing one adds every song
// to the library the same way a challenge does, and shows any part
// assignments read-only (plain text, no editing here). "Share with your
// band" bundles the learner's own saved library into a downloadable
// .bandpack with no assignments -- file exchange only, same as a challenge,
// no network/server/account (plan D6).
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
import { countInTimes, clampBpm, DEFAULT_BPM } from './learn/count-in.js';
import { starterSongs } from '../song/starter/index.js';
import { createLibrary, memoryStore, indexedDbStore } from '../song/library.js';
import { validateSong } from '../song/model.js';
import { buildLessonPlan, nextStep, creditFor } from '../song/lesson.js';
import { feasibility } from '../song/feasibility.js';
import { INSTRUMENTS } from '../instruments/index.js';
import { routeImportFile, importerFor } from './songs/import-route.js';
import { judgeAttempt, passesRule, holdTuneFeedback, firstCorrection, phraseSec } from './songs/practice.js';
import { phaseOf, repairFor } from '../core/teaching.js';
import { barHeat, worstBars } from '../song/bar-heat.js';
import { createLoopBackingTransport, applyAttemptToTransport, backingBpm, rateLabel } from './songs/loop-backing.js';
import { mapMasteryKeys } from './songs/mastery.js';
import { GRADE, review, migrateItem } from '../core/srs.js';
import { parseChallenge, buildChallenge } from '../song/challenge.js';
import { writeBandPack, readBandPack } from '../song/band-pack.js';
import { exportMidi } from '../song/export-midi.js';
import { exportMusicXml } from '../song/export-musicxml.js';
import { exportAbc } from '../song/export-abc.js';
import { makeEvent } from '../core/learning-events.js';
import { t } from '../core/i18n.js';

// Every playable ('ready') instrument record, for the "Play it on…" row --
// same source src/app.js reads for notation/mic-range/how-to-play, so this
// panel never invents an instrument list of its own.
const READY_INSTRUMENTS = INSTRUMENTS.filter((i) => i.status === 'ready');

// P2b-3: the plain home for three sibling panels that used to sit behind
// the now-deleted "More ways to practise" disclosure -- Record a tune
// (src/ui/editor.js), Learn this (src/ui/learn.js) and Play Along
// (src/ui/playalong.js) are all ways to ADD a song to practise, so they sit
// in one row at the very top of this panel rather than getting three
// separate nav buttons of their own. Labels match each panel's own
// registered `name` exactly (panels.register in the files above), so a
// rename there never goes stale here.
const ADD_SONG_PANELS = [
  { id: 'editor', label: 'Record a tune' },
  { id: 'learn', label: 'Learn this' },
  { id: 'playalong', label: 'Play Along' },
];

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

// Cents deviation of a detected frequency from the nearest equal-tempered
// semitone `midi` -- positive is sharp, negative is flat. Pure (no DOM, no
// AudioContext), the same maths src/app.js's own live tuner uses (fmidi =
// 69 + 12*log2(f/440), app.js:91), just expressed as an offset from a given
// target rather than rounded to the nearest note itself.
export function centsFromFreq(freq, midi) {
  const fractionalMidi = 69 + 12 * Math.log2(freq / 440);
  return (fractionalMidi - midi) * 100;
}

// One mic-detected note as a played event. durSec starts at one capture
// tick (50 ms), so a note heard once and gone is judged as clipped short
// rather than skipped as "unmeasured"; the capture loop stretches it while
// the same pitch keeps sounding.
export const MIC_TICK_SEC = 0.05;
export function playedEventFrom(freq, midi, atSec) {
  return { midi, atSec, durSec: MIC_TICK_SEC, cents: centsFromFreq(freq, midi) };
}

// Called on every capture tick where the SAME pitch is still sounding
// (songs.js's mic loop, below). Before this, only durSec grew while the
// note was held -- cents stayed frozen at whatever the very first tick
// read, so a note attacked in tune that then drifted sharp or flat over
// the hold was judged only on its attack. This folds each tick's reading
// into a running mean (tracked via the private _centsN sample count) so
// event.cents reflects the whole hold, sign preserved -- practice.js takes
// Math.abs() of each hit's cents downstream, so a signed mean here is right.
export function extendHeldEvent(event, freq, midi, nowSec) {
  const n = (event._centsN || 1) + 1;
  event.cents = (event.cents * (n - 1) + centsFromFreq(freq, midi)) / n;
  event._centsN = n;
  event.durSec = Math.max(MIC_TICK_SEC, nowSec - event.atSec);
  return event;
}

// Count-in before every "Your turn" try (N2): four clicks at the step's own
// EFFECTIVE tempo (its written bpm, ladder-slowed rate already applied by
// the caller's effectiveBpm() -- see startRecording() below) so a learner
// following a slowed-down backing hears a count-in at the same speed, or
// DEFAULT_BPM for an untimed step (bpm 0, e.g. "pitches" -- there is no
// tempo to count in AT, but a beat still gives a moment to get ready). Same
// four-beat scheduler src/ui/learn.js's mic door already uses
// (src/ui/learn/count-in.js countInTimes, MIN/MAX-clamped there). Pure:
// `times` are phrase-local offsets from 0 -- the caller adds its own real
// clock's `at0` before scheduling real clicks.
export function countInFor(step, effectiveStepBpm) {
  const bpm = clampBpm(effectiveStepBpm > 0 ? effectiveStepBpm : DEFAULT_BPM);
  return { bpm, times: countInTimes(bpm, 4, 0) };
}

// A keyboard/on-screen-key note has no note-off in this listener (app.js's
// handleMidiMessage forwards only the 'on' half via forwardNote() -- see
// this file's header comment), so a played note's length is read as "until
// the next press of the SAME pitch" -- pushes a new open event (durSec:
// null) and, if an earlier event of the same midi is still open, closes it
// at this press's atSec. A different pitch pressed in between does not
// close it early: a keyboard player's hands are not required to release one
// note before starting the next. Mutates and returns `playedEvents`.
export function pushMidiEvent(playedEvents, midi, atSec) {
  for (let i = playedEvents.length - 1; i >= 0; i--) {
    if (playedEvents[i].midi === midi && playedEvents[i].durSec == null) {
      playedEvents[i].durSec = Math.max(0, atSec - playedEvents[i].atSec);
      break;
    }
  }
  playedEvents.push({ midi, atSec, durSec: null });
  return playedEvents;
}

// Whatever MIDI note is still open (no next same-pitch press arrived) when
// the try ends is closed at the end of the try itself, rather than left with
// no length at all -- called once from finishRecording() below.
export function closeOpenMidiEvents(playedEvents, atSec) {
  playedEvents.forEach((e) => { if (e.durSec == null) e.durSec = Math.max(0, atSec - e.atSec); });
  return playedEvents;
}

// Reconciles a batch of songs (as authored, possibly carrying an id that
// collides with one already in the library) with the ids library.add()
// actually assigned to each (collision-renamed to song-2, song-3, ... --
// src/song/library.js) -- used by the challenge/band-pack/single-file import
// paths so anything shown or stored afterward (a challenge's own
// progress[s.id] lookup, openSong(song)) references the id that is actually
// stored, never the id the file happened to carry (D2). `storedIds[i]` is
// the id library.add(songs[i], ...) returned; a song whose id did not change
// is returned unchanged (same reference), so a caller can cheaply tell
// nothing moved.
export function withStoredIds(songs, storedIds) {
  return songs.map((s, i) => (storedIds[i] === s.id ? s : { ...s, id: storedIds[i] }));
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

// Plain-word difficulty (src/song/phrase-difficulty.js's 0..1 score,
// attached per phrase step by src/song/lesson.js's buildLessonPlan). Exact
// thresholds are this unit's own call -- nothing in phrase-difficulty.js
// mandates a three-way split.
export function difficultyLabel(score) {
  if (score < 0.34) return 'Easy';
  if (score < 0.67) return 'Medium';
  return 'Hard';
}

function stepHint(step) {
  if (step.kind === 'listen') return 'Just listen this time.';
  if (step.kind === 'pitches') return 'Play the notes in order. Speed does not matter yet.';
  if (step.kind === 'tempo-ladder') return 'Play along at ' + step.bpm + ' beats a minute.';
  if (step.bpm) return 'Play along at ' + step.bpm + ' beats a minute.';
  return 'Play along.';
}

// Plain words for a repair step's dim (src/core/teaching.js repairFor) --
// what practice.js's failedDimension decided was the FIRST thing wrong,
// turned into the same kind of everyday phrase firstCorrection already uses
// for the failure message itself, just short enough to sit in a title.
const REPAIR_DIM_WORDS = {
  pitch: 'the missed note(s)',
  onset: 'the late note',
  tune: 'the pitch centre',
  hold: 'holding the note',
};

function repairTitle(step) {
  return 'Fix one thing: ' + (REPAIR_DIM_WORDS[step.dim] || 'this part');
}

// ---------------------------------------------------------------------------
// mastery crediting: writes into the SAME per-item store a built-in drill
// uses (src/app.js `it(id)` / `S.item[id]`), for the ids mapMasteryKeys()
// could map. Instruments with no per-item scheme (mapMasteryKeys returns an
// empty array for them) are left untouched — nothing invented.
// ---------------------------------------------------------------------------

export function applyMasteryCredit(api, instrumentId, mapped) {
  if (!mapped.length) return;
  const db = api.db();
  if (!db.mods) db.mods = {};
  if (!db.mods[instrumentId]) db.mods[instrumentId] = { item: {}, trans: {}, acc: {}, cr: {}, level: 1, ready: 0, judged: 0, tick: 0 };
  const modState = db.mods[instrumentId];
  if (!modState.item) modState.item = {};
  const now = Date.now();
  for (const { id, hit } of mapped) {
    const seen = modState.item[id] ? modState.item[id].seen || 0 : 0;
    // Same live item shape (`stability`/`difficulty`/`lastSeen`/`reps`/
    // `lapses`) src/app.js's built-in drills write via review() (src/core/
    // srs.js), migrated through if what's stored is still the old
    // { m, n, last } shape -- a song answer and a drill answer now leave
    // identical records, so due()/retrievability() reads either one the
    // same way. GRADE.GOOD/LAPSE (not HARD/EASY): a song step has no
    // reaction-time or confidence signal to grade finer than right/wrong.
    const raw = modState.item[id];
    const before = raw && typeof raw.stability === 'number' ? raw : migrateItem(raw || {}, now);
    modState.item[id] = Object.assign({ seen }, review(before, { grade: hit ? GRADE.GOOD : GRADE.LAPSE, now }));
  }
  api.save();
}

// ---------------------------------------------------------------------------
// session logging: a song lesson leaves a row in DB.sessions the same way a
// built-in drill's endSession() does (src/app.js), so "today's minutes", day
// streak and "last session" all count song practice too. `practice.judgedCount`/
// `judgedOk`/`startedAt` are set by advance() below, lazily, the first time a
// judged (passRule) step is attempted -- so a learner who never gets past the
// listen step never logs an empty session. Pure summary here; api.logSession()
// (src/app.js) does the actual push/trim/save, same split applyMasteryCredit
// above keeps with api.save().
// ---------------------------------------------------------------------------
export function summarizePracticeSession(practice, nowSec) {
  if (!practice || !practice.judgedCount) return null;
  return {
    mod: practice.instrumentId,
    minutes: Math.max(0, (nowSec - (practice.startedAt != null ? practice.startedAt : nowSec)) / 60),
    acc: practice.judgedOk / practice.judgedCount,
    source: 'song',
    songId: practice.song.id,
  };
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

// "Play it on…" row (plan D8): one card per ready instrument with a
// feasibility badge (src/song/feasibility.js -- itself built only on
// fitToInstrument()'s real result, never a guessed score). Module-level and
// exported (not a mountSongsPanel closure) so another panel -- currently
// src/ui/learn.js's "Learn this" result view -- can render the exact same
// row for a song it just imported/transcribed, without this panel's own
// practice-session state. `onPick(instrument)` fires when a card is
// clicked; mountSongsPanel's own renderPlayItOn() above passes its
// startPractice, learn.js passes its own "open this song's lesson on that
// instrument" handler.
export function renderPlayItOnCards(song, partId, currentInstrumentId, onPick) {
  const section = el('section', { class: 'panel-songs-play-on', 'aria-label': 'Play it on…' });
  section.appendChild(el('h5', { text: 'Play it on…' }));
  const list = el('ul', { class: 'panel-songs-play-on-list' });
  READY_INSTRUMENTS.forEach((instrument) => {
    const f = feasibility(song, partId, instrument);
    const isCurrent = instrument.id === currentInstrumentId;
    const card = el('li', {
      class: 'panel-songs-instrument-card' + (isCurrent ? ' panel-songs-instrument-card-current' : ''),
    });
    const btn = el('button', {
      type: 'button',
      class: 'panel-songs-instrument-btn',
      title: f.detail,
      onclick: () => onPick(instrument),
    });
    btn.appendChild(el('span', { class: 'panel-songs-instrument-name', text: instrument.name }));
    btn.appendChild(el('span', { class: 'panel-songs-badge', 'data-feasibility': f.level, text: f.label }));
    card.appendChild(btn);
    list.appendChild(card);
  });
  section.appendChild(list);
  return section;
}

// A cross-panel "open this song's lesson next time Songs is shown" request
// (used by src/ui/learn.js's "Practise this" button, since a panel only
// ever gets its OWN mounted instance -- there is no direct call from one
// panel's module into another's running closure). Backed by this panel's
// own saved-data slot (api.store, see src/ui/panels.js's sanitizePanelData
// contract: a plain, <=256KB JSON object, silently dropped if malformed),
// so it survives exactly as long as a real click-through would need and no
// longer -- mountSongsPanel's show() below reads it once and clears it.
const OPEN_REQUEST_STORE_ID = 'songs-open-request';
export function requestOpenSong(api, songId, partId, instrumentId) {
  api.store(OPEN_REQUEST_STORE_ID).set({ songId, partId: partId || null, instrumentId: instrumentId || null });
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
  // FIRST inside the container, ahead of even the heading -- the three
  // ways to add a song are the thing a learner arriving from the nav's
  // Songs button is most likely to want before they have any songs of
  // their own to pick from.
  const addSongRow = el('div', { class: 'add-song-row', role: 'group', 'aria-label': t('songs.addRow') });
  ADD_SONG_PANELS.forEach((p) => {
    addSongRow.appendChild(el('button', { type: 'button', text: p.label, onclick: () => api.openPanel(p.id) }));
  });
  hostEl.appendChild(addSongRow);

  const heading = el('h2', { text: 'Songs' });
  const intro = el('p', { class: 'panel-songs-intro', text: 'Pick a tune to practise, or add your own from a file.' });

  const listSection = el('section', { 'aria-label': 'Your songs' });
  const listUl = el('ul', { class: 'panel-songs-list' });
  listSection.appendChild(listUl);

  const importLabel = el('label', { for: 'songsFileInput', text: 'Add a song, a teacher’s challenge, or a band pack, from a file (.mid, .midi, .abc, .xml, .musicxml, .mxl, .gp, .gp5, .bandpack or .json)' });
  const importInput = el('input', { type: 'file', id: 'songsFileInput', accept: '.mid,.midi,.abc,.xml,.musicxml,.mxl,.gp,.gp5,.bandpack,.json' });
  // Pointer to the one shared door (plan §11.5.7): this file input keeps
  // working exactly as before (existing tests use it directly), this just
  // tells a learner where the newer, simpler door is -- for a recording
  // especially, which this input does not transcribe.
  // P2b-3: Learn this now has a real home of its own in the Add-a-song row
  // above -- this tip's button just opens it directly through the same
  // api.openPanel() that row uses, rather than hunting the DOM for a button
  // that may or may not still exist.
  const learnTipBtn = el('button', { type: 'button', id: 'songsLearnTipBtn', text: 'Open Learn this', onclick: () => api.openPanel('learn') });
  const learnTip = el('p', { class: 'panel-songs-learn-tip' }, [
    document.createTextNode('Tip: Learn this takes any recording or music file in one place. '), learnTipBtn,
  ]);
  const importMsg = el('div', { class: 'panel-songs-msg', role: 'status' });
  // Read-only part assignments from the last imported band pack -- one line
  // per song that carries an assignment (a song with no assignment gets no
  // line at all). Cleared at the top of every handleFile() so it never shows
  // a stale pack's assignments after a different file is picked.
  const bandPackPartsEl = el('div', { class: 'panel-songs-band-pack-parts-list' });
  const importSection = el('section', {}, [importLabel, importInput, learnTip, importMsg, bandPackPartsEl]);

  const challengeSection = el('section', { class: 'panel-songs-challenge', hidden: 'hidden' });

  const exportTitleLabel = el('label', { for: 'challengeTitleInput', text: 'Challenge title' });
  const exportTitleInput = el('input', { type: 'text', id: 'challengeTitleInput', value: 'My songs' });
  const exportBtn = el('button', { type: 'button', text: 'Export as a challenge', onclick: exportChallenge });
  const exportMsg = el('div', { class: 'panel-songs-export-msg', role: 'status' });
  // "Share with your band" (plan-adjacent to the challenge export above):
  // bundles the same library songs into a .bandpack instead, with no part
  // assignments (those are made band-side, once, by whoever hands the pack
  // out -- this panel only ever shows assignments read-only, see
  // bandPackPartsEl). Disabled until the library has at least one song, so a
  // learner can't download an empty pack.
  const shareBtn = el('button', { type: 'button', text: 'Share with your band', onclick: shareBandPack, disabled: 'disabled' });
  const shareMsg = el('div', { class: 'panel-songs-share-msg', role: 'status' });
  const exportSection = el('section', { 'aria-label': 'Export a challenge' }, [
    exportTitleLabel, exportTitleInput, exportBtn, exportMsg, shareBtn, shareMsg,
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
    // "Share with your band" packs up the library's own saved songs (same
    // as "Export as a challenge"), so it stays disabled with nothing to pack.
    if (saved.length) shareBtn.removeAttribute('disabled');
    else shareBtn.setAttribute('disabled', 'disabled');
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
    li.appendChild(songExportControls(songOrMeta, libraryId));
    return li;
  }

  // "Save as…" (plan-adjacent to D6's challenge export): one small button
  // per exporter (src/song/export-midi.js, export-musicxml.js, export-abc.js
  // -- all pure functions, a Song object in, file bytes/text out) next to
  // every song row, starter tunes included. `songOrMeta`/`libraryId` follow
  // the same pattern songRow()'s own onclick uses to get a full Song: a
  // starter tune already IS one, a library row needs library.get() first
  // since the list only holds lightweight metadata (title/id/etc, no notes).
  const EXPORT_FORMATS = [
    { label: 'MIDI', ext: 'mid', mime: 'audio/midi', build: exportMidi },
    { label: 'MusicXML', ext: 'musicxml', mime: 'application/vnd.recordare.musicxml+xml', build: exportMusicXml },
    { label: 'ABC', ext: 'abc', mime: 'text/vnd.abc', build: exportAbc },
  ];

  function songExportControls(songOrMeta, libraryId) {
    const span = el('span', { class: 'panel-songs-export' });
    EXPORT_FORMATS.forEach((format) => {
      const btn = el('button', {
        type: 'button',
        class: 'panel-songs-export-btn',
        text: format.label,
        title: 'Save "' + songOrMeta.title + '" as ' + format.label,
        onclick: async () => {
          const song = libraryId ? await library.get(libraryId) : songOrMeta;
          if (!song) { say('That song could not be found any more.', 'no'); return; }
          let data;
          try {
            data = format.build(song);
          } catch (e) {
            say('That song could not be saved as ' + format.label + ': ' + (e && e.message ? e.message : String(e)), 'no');
            return;
          }
          const fileBase = (song.title || 'song').replace(/[^\w.-]+/g, '_') || 'song';
          triggerDownload([data], format.mime, fileBase + '.' + format.ext);
        },
      });
      span.appendChild(btn);
    });
    return span;
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
    const fileName = (title.replace(/[^\w.-]+/g, '_') || 'challenge') + '.challenge.json';
    triggerDownload([json], 'application/json', fileName);
    exportMsg.textContent = 'Exported "' + title + '" with ' + songs.length + ' song' + (songs.length === 1 ? '' : 's') + '.';
  }

  // "Share with your band": same source list as exportChallenge() above
  // (the learner's own saved library, not the built-in starter tunes), built
  // into a .bandpack instead of a .challenge.json, via src/song/band-pack.js
  // writeBandPack(). No part assignments are made here -- shareBtn stays
  // disabled until the library holds a song (see refreshList()), so this
  // never runs against an empty library.
  async function shareBandPack() {
    let songs = [];
    try { songs = await library.exportAll(); } catch (e) { songs = []; }
    if (!songs.length) {
      shareMsg.textContent = 'Add some songs to your library first, then share them with your band.';
      return;
    }
    let bytes;
    try {
      bytes = writeBandPack({ name: 'Band pack', songs });
    } catch (e) {
      shareMsg.textContent = 'That band pack could not be built: ' + (e && e.message ? e.message : String(e));
      return;
    }
    triggerDownload([bytes], 'application/zip', 'band-pack.bandpack');
    shareMsg.textContent = 'Shared ' + songs.length + ' song' + (songs.length === 1 ? '' : 's') + ' as band-pack.bandpack.';
  }

  // Blob + hidden a[download] click -- the same pattern a "save my work"
  // button uses anywhere in a browser, no server involved. Shared by
  // exportChallenge(), shareBandPack() above and songExportControls() below
  // so every download behaves identically.
  function triggerDownload(blobParts, mimeType, fileName) {
    const blob = new Blob(blobParts, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: fileName });
    a.click();
    // Revoked a moment later, not synchronously: some browsers cancel an
    // in-flight download if the object URL disappears before the click is
    // fully handled.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openSong(song) {
    // A song already mid-recording (Stop and check never clicked) has its
    // mic/MIDI listener subscribed via `practice`, the module-level variable
    // every future note push reads live -- wiping practiceSection below
    // removes the Stop button but, without this, leaves that listener
    // running with nothing left to stop it: a multi-part song (parts list,
    // no auto-start below) or a 0-note song (dead end) never calls
    // startPractice() again to clean it up on its own.
    stopRecording();
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

  // `instrumentOverride`, when given (a "Play it on…" card was clicked),
  // starts the lesson on THAT instrument instead of the learner's current
  // main-screen instrument -- picking a card never calls api.setMod(), which
  // would close this panel and jump back to the main screen; it only swaps
  // which instrument this song's lesson (and its saved songId/partId/
  // instrumentId, restored on the panel's next open) is built for.
  function startPractice(song, partId, instrumentOverride) {
    stopRecording();
    const instrumentId = instrumentOverride ? instrumentOverride.id : api.mod();
    const instrument = instrumentOverride || api.instrument(instrumentId);
    if (!instrument) {
      practiceSection.innerHTML = '';
      practiceSection.appendChild(el('p', { text: 'Pick an instrument on the main screen first, then come back here to practise.' }));
      return;
    }
    const saved = store.get();
    const level = saved && saved.songId === song.id && saved.partId === partId && Number.isFinite(saved.level) ? saved.level : 1;
    const plan = buildLessonPlan(song, partId, instrument, { level });
    // loopTransport/loopTransportStepIndex: the tempo-ladder rung's own
    // src/audio/stretch/loop.js transport (Riff Repeater pattern) -- created
    // fresh the first time renderPractice() sees a given tempo-ladder step
    // index, so a miss/clean-loop's rate change persists across repeat
    // attempts on THE SAME rung but resets when the ladder moves to a
    // different rung (nextStep() dropping back after two misses, or
    // skipping ahead after a clean first try): each rung already has its own
    // fixed bpm, so starting that rung's fine-grained rate back at full
    // speed is the simplest reading of "fresh rung, fresh ladder".
    // repair: null | { step, returnTo } -- a short isolated exercise (see
    // advance() below and src/core/teaching.js repairFor) that a check-phase
    // step's SECOND consecutive fail on the SAME thing drops into. Starting
    // (or re-starting) a lesson here always begins with a fresh object, so
    // switching songs/instruments or hitting "Practise again" clears any
    // repair in progress along with everything else practice-local.
    practice = { song, partId, instrument, instrumentId, plan, results: [], stepIndex: 0, repair: null, recording: false, countingIn: false, countInTimer: null, playedEvents: [], recordStartSec: 0, stop: null, loopTransport: null, loopTransportStepIndex: null };
    store.set({ songId: song.id, partId, instrumentId, level });
    renderPractice();
  }

  // "Play it on…" row (plan D8): one card per ready instrument with a
  // feasibility badge (src/song/feasibility.js -- itself built only on
  // fitToInstrument()'s real result, never a guessed score). Shown only on
  // the very first (listen) step of a lesson, before the learner has
  // attempted anything, so the badge is always seen before they commit to
  // an instrument. Computed lazily here, only for the song actually open --
  // never for the whole library up front.
  function renderPlayItOn(song, partId, currentInstrumentId) {
    return renderPlayItOnCards(song, partId, currentInstrumentId, (instrument) => startPractice(song, partId, instrument));
  }

  // The count element's own text for the current practice state: "Counting
  // in…" while the pre-try count-in is still clicking (practice.countingIn,
  // set by startRecording() below and cleared the moment real listening
  // begins), "Notes heard so far: N" once it does, empty otherwise -- shared
  // by updateCount() and renderPractice() so the two never drift apart.
  function countLabel() {
    if (!practice.recording) return '';
    if (practice.countingIn) return 'Counting in…';
    return 'Notes heard so far: ' + practice.playedEvents.length;
  }

  function updateCount() {
    if (countEl) countEl.textContent = countLabel();
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
    if (practice.repair) {
      renderRepairStep(practice.repair.step);
      return;
    }
    const step = plan.steps[stepIndex];
    // A tempo-ladder rung gets its own loop-backing transport (see the
    // `practice = {...}` comment in startPractice() above for the reset
    // rule); any other step kind carries none.
    if (step.kind === 'tempo-ladder') {
      if (practice.loopTransportStepIndex !== stepIndex) {
        practice.loopTransport = createLoopBackingTransport();
        practice.loopTransportStepIndex = stepIndex;
      }
    } else {
      practice.loopTransport = null;
      practice.loopTransportStepIndex = null;
    }
    if (plan.fit.unplayable.length && stepIndex === 0) {
      practiceSection.appendChild(el('p', {
        class: 'panel-songs-warn',
        text: plan.fit.unplayable.length + ' note' + (plan.fit.unplayable.length === 1 ? '' : 's') + ' in this song cannot be played on this instrument and will be skipped.',
      }));
    }
    if (plan.fit.changes.length) {
      practiceSection.appendChild(el('p', { text: 'This song was ' + plan.fit.changes.join('; ') + ' to fit your instrument.' }));
    }
    if (stepIndex === 0) {
      practiceSection.appendChild(renderPlayItOn(practice.song, practice.partId, practice.instrumentId));
    }
    const titleRow = el('h4', { text: stepTitle(step) + ' (bars ' + (step.bars[0] + 1) + '-' + (step.bars[1] + 1) + ')' });
    if (typeof step.difficulty === 'number') {
      titleRow.appendChild(el('span', {
        class: 'panel-songs-diff-badge',
        'data-difficulty': difficultyLabel(step.difficulty).toLowerCase(),
        text: difficultyLabel(step.difficulty),
      }));
    }
    practiceSection.appendChild(titleRow);
    practiceSection.appendChild(el('p', { text: stepHint(step) }));
    // Plain-word readout of the tempo ladder's own current rate (100% =
    // this rung's written bpm; a miss earlier steps it down, a clean loop
    // steps it back up -- see finishRecording() below and
    // src/ui/songs/loop-backing.js).
    if (step.kind === 'tempo-ladder' && practice.loopTransport) {
      practiceSection.appendChild(el('p', { class: 'panel-songs-rate', text: rateLabel(practice.loopTransport.getRate()) }));
    }

    const playBtn = el('button', { type: 'button', text: 'Play it', onclick: () => playPhrase(step) });
    practiceSection.appendChild(playBtn);

    if (step.passRule) {
      const recordBtn = el('button', {
        type: 'button',
        text: practice.recording ? 'Stop and check' : 'Your turn',
        onclick: () => (practice.recording ? finishRecording(step) : startRecording(step)),
      });
      practiceSection.appendChild(recordBtn);
      countEl = el('p', { class: 'panel-songs-count', text: countLabel() });
      practiceSection.appendChild(countEl);
    } else {
      practiceSection.appendChild(el('button', { type: 'button', text: 'Next', onclick: () => advance(true, null) }));
    }

    // The last judged try's bar-by-bar result (advance() below), kept on
    // screen until the learner starts another try (startRecording() clears
    // it) so they can read it while deciding what to do next.
    if (practice.lastHeat) {
      practiceSection.appendChild(renderBarStrip(practice.lastHeat, practice.lastHeatBars));
    }
  }

  // A repair step (src/core/teaching.js repairFor) is a handful of notes,
  // not a phrase -- no "Play it on…" cards, no unplayable-note warning, no
  // difficulty badge (repairFor's step never carries one). Just what it is
  // ("Fix one thing: …"), what to do ("Just these notes…"), and the same
  // play/record controls every other passRule'd step gets.
  function renderRepairStep(step) {
    practiceSection.appendChild(el('h4', { text: repairTitle(step) }));
    practiceSection.appendChild(el('p', { text: 'Just these notes, then back to the phrase.' }));
    practiceSection.appendChild(el('button', { type: 'button', text: 'Play it', onclick: () => playPhrase(step) }));
    practiceSection.appendChild(el('button', {
      type: 'button',
      text: practice.recording ? 'Stop and check' : 'Your turn',
      onclick: () => (practice.recording ? finishRecording(step) : startRecording(step)),
    }));
    countEl = el('p', { class: 'panel-songs-count', text: countLabel() });
    practiceSection.appendChild(countEl);
    if (practice.lastHeat) {
      practiceSection.appendChild(renderBarStrip(practice.lastHeat, practice.lastHeatBars));
    }
  }

  // One small chip per bar of `heat` that falls inside `stepBars` (the just-
  // attempted step's own [fromBar, toBar]) and actually had something judged
  // in it, plus a "Work on bar N next" line naming the single worst bar in
  // the whole heat map (worstBars ranks a bar with nothing judged last, so
  // this always lands on a bar the learner actually played).
  function renderBarStrip(heat, stepBars) {
    const wrap = el('div', { class: 'panel-songs-bar-strip', 'aria-label': 'Bar-by-bar result' });
    heat
      .filter((h) => h.bar >= stepBars[0] && h.bar <= stepBars[1] && h.grade !== 'none')
      .forEach((h) => {
        wrap.appendChild(el('span', {
          class: 'panel-songs-bar',
          'data-grade': h.grade,
          title: 'Bar ' + (h.bar + 1) + ': ' + h.hits + '/' + h.judged,
          text: String(h.bar + 1),
        }));
      });
    const worst = worstBars(heat, 1)[0];
    if (worst && (worst.grade === 'miss' || worst.grade === 'shaky')) {
      wrap.appendChild(el('p', { class: 'panel-songs-bar-worst', text: 'Work on bar ' + (worst.bar + 1) + ' next.' }));
    }
    return wrap;
  }

  // A tempo-ladder step's EFFECTIVE bpm: its own written rung bpm, scaled by
  // that rung's loop-backing transport rate (the Riff Repeater ladder --
  // src/ui/songs/loop-backing.js backingBpm()) -- 100% until a miss steps it
  // down. Every other step kind plays at its own written bpm unchanged.
  // Used for BOTH the synth backing playback below and the timing judged in
  // finishRecording(), so a learner following a slowed-down backing is
  // judged against the tempo they actually heard, not the rung's full speed.
  function effectiveBpm(step) {
    if (step.kind === 'tempo-ladder' && practice.loopTransport) return backingBpm(step.bpm, practice.loopTransport.getRate());
    return step.bpm;
  }

  function playPhrase(step) {
    const notes = step.notes;
    if (!notes.length) return;
    const at0 = api.now() + 0.15;
    const spacing = 0.55;
    // Schedule by real tick offsets when the step has a tempo -- on the same
    // phrase-local clock the try is judged on (phraseSec from step.originTick,
    // the phrase's bar line, so a pickup rest is heard as a rest); otherwise
    // (the "pitches" step, bpm 0) space notes evenly since there is no
    // tempo to follow.
    if (step.bpm > 0) {
      const ticksPerQuarter = practice.song.ticksPerQuarter;
      const bpm = effectiveBpm(step);
      notes.forEach((n) => {
        const secOffset = phraseSec(n.start, step.originTick, bpm, ticksPerQuarter);
        const dur = Math.max(0.12, (n.dur / ticksPerQuarter) * (60 / bpm));
        api.tone(n.midi, at0 + secOffset, dur, 0.22);
      });
    } else {
      notes.forEach((n, i) => api.tone(n.midi, at0 + i * spacing, spacing * 0.85, 0.22));
    }
  }

  // Capture's zero IS the phrase origin (step.originTick): an event at atSec
  // 0 is played on the phrase's first bar line, exactly where playPhrase()'s
  // own schedule starts, and judgeAttempt() compares on that same clock.
  //
  // N2: every try now opens with a four-beat count-in (countInFor(), same
  // scheduler src/ui/learn.js's mic door uses) instead of starting to listen
  // the instant the button is pressed -- a learner's own reaction time was
  // otherwise the very first thing being judged. practice.recordStartSec is
  // set to the moment the count-in ENDS (one beat after its last click, the
  // downbeat of the phrase itself), and nothing subscribes to notes/mic
  // input until then, so a note played during the clicks is not heard at
  // all -- never counted as an early hit or a stray extra.
  function startRecording(step) {
    const onsetsOnly = !!step && step.kind === 'rhythm';
    practice.recording = true;
    practice.countingIn = true;
    practice.playedEvents = [];
    // Starting a new try retires the previous try's bar strip.
    practice.lastHeat = null;
    practice.lastHeatBars = null;

    // Real listening only begins once the count-in ends (below); this is the
    // rest of the old startRecording() body, unchanged, just deferred.
    function beginListening() {
      if (practice.instrument.input === 'midi') {
        const unsubscribe = onMidiNote((midi) => {
          pushMidiEvent(practice.playedEvents, midi, api.now() - practice.recordStartSec);
          updateCount();
        });
        practice.stop = unsubscribe;
      } else {
        api.openMic().catch(() => say('The microphone was blocked. Allow microphone access, or switch to the keyboard.', 'no'));
        let onset;
        // The played event still being sounded, so a sustained instrument's
        // hold/tune rules (src/song/lesson.js) have something real to judge
        // (durSec/cents) -- every tick this SAME pitch keeps being heard, its
        // durSec is stamped forward; the moment it drops out (silence, or the
        // pitch moves on to the next note) durSec is left at that last-seen
        // value rather than kept open forever. A MIDI/on-screen-key note (see
        // onMidiNote above) never gets either field: there is no "still
        // sounding" signal to poll for a discrete key press.
        let openEvent = null;
        const timer = setInterval(() => {
          const analysers = api.analysers();
          const audio = api.audio();
          if (!analysers.time || !audio) return;
          if (!onset) onset = createOnsetDetector({ sampleRate: audio.sampleRate, frameSize: analysers.time.fftSize });
          const buf = new Float32Array(analysers.time.fftSize);
          analysers.time.getFloatTimeDomainData(buf);
          const o = onset.push(buf);
          // No onset and nothing still sounding: skip YIN entirely this tick.
          if (!o.onset && !openEvent) return;
          const toolRange = rangeForInstrument(practice.instrument);
          const r = yin(buf, audio.sampleRate, toolRange.fmin, toolRange.fmax, api.gates().pitch);
          const nowSec = api.now() - practice.recordStartSec;
          if (!o.onset) {
            if (openEvent && r.freq && r.clarity > 0.5 && Math.round(69 + 12 * Math.log2(r.freq / 440)) === openEvent.midi) {
              extendHeldEvent(openEvent, r.freq, openEvent.midi, nowSec);
            } else {
              openEvent = null;
            }
            return;
          }
          if (!r.freq || !(r.clarity > 0.7)) {
            openEvent = null;
            // "Clap the rhythm": an attack with no clear pitch (a clap, a tap)
            // is still a beat, so a rhythm step keeps it as an unpitched event.
            if (onsetsOnly) { practice.playedEvents.push({ midi: null, atSec: nowSec }); updateCount(); }
            return;
          }
          const midi = Math.round(69 + 12 * Math.log2(r.freq / 440));
          const event = playedEventFrom(r.freq, midi, nowSec);
          practice.playedEvents.push(event);
          openEvent = event;
          updateCount();
        }, 50);
        practice.stop = () => clearInterval(timer);
      }
    }

    const { bpm, times } = countInFor(step, effectiveBpm(step));
    const spb = 60 / bpm;
    const at0 = api.now() + 0.15;
    times.forEach((t, i) => api.click(at0 + t, i === 0));
    // The phrase origin (atSec 0 for judging) is one beat AFTER the last
    // click -- the downbeat the count-in was leading up to.
    practice.recordStartSec = at0 + times[times.length - 1] + spb;
    const delayMs = Math.max(0, (practice.recordStartSec - api.now()) * 1000);
    practice.countInTimer = setTimeout(() => {
      practice.countInTimer = null;
      practice.countingIn = false;
      beginListening();
      updateCount();
    }, delayMs);
    renderPractice();
  }

  function stopRecording() {
    if (practice && practice.countInTimer) { clearTimeout(practice.countInTimer); practice.countInTimer = null; }
    if (practice && practice.stop) { practice.stop(); practice.stop = null; }
    if (practice) { practice.recording = false; practice.countingIn = false; }
  }

  function finishRecording(step) {
    const elapsedMs = Math.max(0, (api.now() - practice.recordStartSec) * 1000);
    // A MIDI note still "held" (no later same-pitch press closed it) gets its
    // length from the moment the try itself ended, rather than being left
    // with no durSec at all -- see pushMidiEvent()/closeOpenMidiEvents()
    // above. A no-op for a mic-captured event, which always carries durSec
    // already.
    closeOpenMidiEvents(practice.playedEvents, Math.max(0, (api.now() - practice.recordStartSec)));
    stopRecording();
    const timed = step.kind !== 'pitches';
    const result = judgeAttempt(step.notes, practice.playedEvents, {
      bpm: effectiveBpm(step) || practice.song.bpm,
      ticksPerQuarter: practice.song.ticksPerQuarter,
      policy: practice.instrument.octavePolicy,
      timed,
      originTick: step.originTick,
      // "Clap the rhythm" judges WHEN, not what: any pitch or a clap counts.
      onsetsOnly: step.kind === 'rhythm',
    });
    // Feed this attempt's outcome to the tempo ladder BEFORE passesRule()
    // (below) reads step.passRule for `passed` -- rate only affects the
    // NEXT attempt's backing and judging (effectiveBpm() above already ran
    // for THIS one), so a miss on a rung the learner is about to be dropped
    // from still slows the backing down for anyone retrying it. Passing
    // step.passRule here too means "clean" (speeds the rate up) requires
    // actually PASSING the step -- hitting every note while failing on
    // timing, hold/tune or an extra note is not clean.
    if (step.kind === 'tempo-ladder' && practice.loopTransport) {
      applyAttemptToTransport(practice.loopTransport, result, step.passRule);
    }
    const passed = passesRule(result, step.passRule);
    // Every correctly-pitched note counts toward the trainer's own streak
    // and level-up path, not just this song's mastery record (applyMasteryCredit
    // below), whether or not the whole step ends up passing.
    // A rhythm step's hit is an onset, so it only credits when the pitch
    // happened to be right too (pitchOk, practice.js) -- a clap never does.
    if (typeof api.creditNote === 'function') {
      result.matches.forEach((m) => { if (m.ok && m.pitchOk !== false) api.creditNote(practice.instrumentId); });
    }
    advance(passed, result, elapsedMs);
  }

  // Trailing consecutive FAILURES on this exact step -- src/song/lesson.js's
  // own nextStep() keeps a private copy of this same idea for the tempo
  // ladder's rung-drop; this one reads practice.results (results.push()
  // above already includes the just-finished try) to decide whether a
  // check-phase step's SECOND miss on the SAME thing should drop into a
  // repair instead of just repeating the whole phrase again.
  function trailingFailsOnStep(results, stepIndex) {
    let count = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].stepIndex !== stepIndex || results[i].passed) break;
      count++;
    }
    return count;
  }

  // dims/unassessed for a judged step's learning event (plan 6.4): each
  // dimension is read straight off judgeAttempt()'s own aggregate against
  // the SAME numbers step.passRule already judges pass/fail with -- never a
  // new threshold invented here. A dimension the step's passRule never set
  // (e.g. tune/hold on a non-sustaining instrument, pitch on a rhythm step
  // where a clap is deliberately pitch-free -- practice.js's judgeOnsets
  // comment) is left out of `dims` and listed in `unassessed` instead of
  // guessed at.
  function dimsFromStep(step, result) {
    const dims = {}, unassessed = [], rule = step.passRule || {};
    if (!result || !result.judgedCount) { unassessed.push('pitch', 'onset', 'hold', 'tune'); return { dims, unassessed }; }
    if (step.kind === 'rhythm') unassessed.push('pitch');
    else dims.pitch = result.matches.every((m) => m.ok && m.pitchOk !== false) ? 'ok' : 'miss';
    if (rule.maxMeanErrorMs != null && result.meanErrorMs != null) dims.onset = result.meanErrorMs <= rule.maxMeanErrorMs ? 'ok' : 'miss';
    else unassessed.push('onset');
    if (rule.minDurationScore != null && result.durationScore != null) dims.hold = result.durationScore >= rule.minDurationScore ? 'ok' : 'miss';
    else unassessed.push('hold');
    if (rule.maxMeanAbsCents != null && result.meanAbsCents != null) dims.tune = result.meanAbsCents <= rule.maxMeanAbsCents ? 'ok' : 'miss';
    else unassessed.push('tune');
    return { dims, unassessed };
  }

  function advance(passed, result, elapsedMs) {
    // A repair try (src/core/teaching.js repairFor) is a handful of isolated
    // notes, not one of the plan's own steps: it never joins practice.results
    // (nextStep and the tempo-ladder streak logic stay blind to it) and
    // never earns mastery credit on its own (the per-note credit in
    // finishRecording already ran; crediting the STEP too would double-count
    // the same few notes against the original step's own credit). A pass
    // clears the repair and returns to the step it isolated FROM (returnTo);
    // a miss keeps it -- try again, same isolated notes.
    if (practice.repair) {
      const repairStep = practice.repair.step;
      say(passed ? 'Good. Back to the phrase.' : (firstCorrection(result, repairStep.passRule) || 'Not quite yet — try that again.'), passed ? 'ok' : 'no');
      if (result) {
        practice.lastHeat = barHeat(practice.song, result.matches);
        practice.lastHeatBars = repairStep.bars;
      }
      if (passed) practice.repair = null;
      practice.playedEvents = [];
      renderPractice();
      return;
    }
    const step = practice.plan.steps[practice.stepIndex];
    practice.results.push({ stepIndex: practice.stepIndex, passed });
    if (step.passRule) {
      // Lazily started on the FIRST judged step, not in startPractice(): a
      // learner who only ever watches the listen step and leaves never
      // logs an empty session (summarizePracticeSession above returns null
      // while judgedCount is 0).
      if (practice.startedAt == null) practice.startedAt = api.now();
      practice.judgedCount = (practice.judgedCount || 0) + 1;
      if (passed) practice.judgedOk = (practice.judgedOk || 0) + 1;
      const credit = creditFor({ step, passed, elapsedMs: elapsedMs || 0, judgedCount: result ? result.judgedCount : undefined, matches: result ? result.matches : undefined });
      const mapped = mapMasteryKeys(credit.masteryKeys, practice.instrumentId, (api.db().prefs || {}));
      // A rhythm step is judged on onsets only: a try with any clap or
      // wrong-pitch hit is no evidence about the notes' pitch mastery.
      if (!result || result.matches.every((m) => !m.ok || m.pitchOk !== false)) applyMasteryCredit(api, practice.instrumentId, mapped);
      // One learning-event row per judged step (plan 6.4) -- bpmActual is
      // the same as bpmTarget (step.bpm): no tempo estimate is measured
      // from the attempt anywhere in this file, so nothing better is
      // available to report.
      if (typeof api.logEvent === 'function') {
        const { dims, unassessed } = dimsFromStep(step, result);
        api.logEvent(makeEvent({
          instrument: practice.instrumentId, skill: step.kind + ':' + step.phraseIndex, source: 'song',
          songId: practice.song.id, partId: practice.partId, assistance: 'none',
          dims, unassessed, activeMs: Math.max(0, Math.round(elapsedMs || 0)),
          bpmTarget: step.bpm || null, bpmActual: step.bpm || null,
        }, { now: api.now() }));
      }
      // A failed try gets told the FIRST concrete thing to fix -- the
      // missed note, the late note, the hold/tune reason, or the extra note
      // -- instead of the generic retry prompt, so the learner knows the
      // ONE thing to work on next.
      const correction = !passed && result ? firstCorrection(result, step.passRule) : null;
      say(passed
        ? 'Nice. ' + (result ? result.hitCount + ' of ' + result.judgedCount + ' notes.' : '')
        : correction || 'Not quite yet — try that again.', passed ? 'ok' : 'no');
      if (result) {
        practice.lastHeat = barHeat(practice.song, result.matches);
        practice.lastHeatBars = step.bars;
      }
      // A check-phase step's SECOND consecutive miss on the SAME thing
      // (failedDimension, inside repairFor) becomes a short repair on just
      // those notes instead of a third run at the whole phrase -- see
      // trailingFailsOnStep above. practice.stepIndex is deliberately left
      // alone here (repairFor's returnTo): the plan position does not move,
      // the repair sits on top of it until passed.
      if (!passed && result && phaseOf(step) === 'check' && trailingFailsOnStep(practice.results, practice.stepIndex) >= 2) {
        const repairStep = repairFor(step, result, step.passRule);
        if (repairStep) {
          repairStep.returnTo = practice.stepIndex;
          practice.repair = { step: repairStep, returnTo: practice.stepIndex };
          practice.playedEvents = [];
          store.set({ songId: practice.song.id, partId: practice.partId, instrumentId: practice.instrumentId, level: practice.plan.level });
          renderPractice();
          return;
        }
      }
    } else {
      // A listen step (passRule: null) is judged nothing itself -- clicking
      // its "Next" runs this same advance() with result: null, so without
      // this the PREVIOUS step's bar strip (still sitting in lastHeat) rides
      // along onto the step after the listen step, reading as that new,
      // never-yet-attempted step's own result.
      practice.lastHeat = null;
      practice.lastHeatBars = null;
    }
    practice.stepIndex = nextStep(practice.plan, practice.results);
    practice.playedEvents = [];
    store.set({ songId: practice.song.id, partId: practice.partId, instrumentId: practice.instrumentId, level: practice.plan.level });
    // The lesson just reached its end (the "whole piece" step passed): log
    // this practice session once, the same moment endSession() logs a
    // built-in drill's session.
    if (practice.stepIndex >= practice.plan.steps.length && !practice.sessionLogged && typeof api.logSession === 'function') {
      const summary = summarizePracticeSession(practice, api.now());
      if (summary) { practice.sessionLogged = true; api.logSession(summary); }
    }
    renderPractice();
  }

  async function handleFile() {
    const file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) return;
    bandPackPartsEl.innerHTML = '';
    const route = routeImportFile(file.name);
    if (route.kind === 'unknown') {
      say('That file type is not supported yet. Use a .mid, .midi, .abc, .xml, .musicxml, .mxl, .gp, .gp5, .bandpack or .json file.', 'no');
      return;
    }
    if (route.kind === 'band-pack') {
      let pack;
      try {
        const buffer = await readFile(file, route.readAs);
        pack = readBandPack(new Uint8Array(buffer));
      } catch (e) {
        say(e && e.message ? e.message : String(e), 'no');
        return;
      }
      let storedIds;
      try {
        storedIds = [];
        for (const s of pack.songs) storedIds.push(await library.add(s, { now: Date.now() }));
      } catch (e) {
        say('The band pack could not be fully saved: ' + (e && e.message ? e.message : String(e)), 'no');
        return;
      }
      // D2: a song whose id collided with one already in the library was
      // reassigned (song-2, song-3, ...) by library.add() above -- reconciled
      // here so the part-assignment lines below (and anything read from
      // pack.songs after this point) name the id that is actually stored.
      pack.songs = withStoredIds(pack.songs, storedIds);
      say('Added ' + pack.songs.length + ' song' + (pack.songs.length === 1 ? '' : 's') + ' from band pack "' + pack.name + '".', 'ok');
      // Part assignments, read-only: one line per song that carries one,
      // "<title>: <member> plays <part name>, ...". A song with no
      // assignment (pack.parts[i] is null) gets no line at all.
      pack.songs.forEach((s, i) => {
        const assignment = pack.parts[i];
        if (!assignment) return;
        const line = Object.entries(assignment)
          .map(([member, partIndex]) => member + ' plays ' + (s.parts[partIndex] ? s.parts[partIndex].name : 'part ' + (partIndex + 1)))
          .join(', ');
        bandPackPartsEl.appendChild(el('p', { class: 'panel-songs-band-pack-parts', text: s.title + ': ' + line }));
      });
      await refreshList();
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
      let storedIds;
      try {
        storedIds = [];
        for (const s of challenge.songs) storedIds.push(await library.add(s, { now: Date.now() }));
      } catch (e) {
        say('The challenge could not be fully saved: ' + (e && e.message ? e.message : String(e)), 'no');
        return;
      }
      // D2: reconcile any collision-reassigned id BEFORE renderChallenge()
      // reads challenge.songs -- its progress[s.id] lookup and each song's
      // own "Open" button (openSong(song)) must reference the id that is
      // actually stored, not the id the file happened to carry.
      challenge.songs = withStoredIds(challenge.songs, storedIds);
      say('Added the "' + challenge.title + '" challenge (' + challenge.songs.length + ' song' + (challenge.songs.length === 1 ? '' : 's') + ').', 'ok');
      renderChallenge(challenge);
      await refreshList();
      return;
    }
    let song, warnings;
    try {
      const data = await readFile(file, route.readAs);
      // routeImportFile() decided the kind above; importerFor() (src/ui/
      // songs/import-route.js) is the one place that maps a kind to its
      // actual importer, so a .gp file reaches importGp7 rather than
      // falling through to the MusicXML importer.
      const importer = importerFor(route.kind);
      if (!importer) throw new Error('no importer for file kind "' + route.kind + '"');
      ({ song, warnings } = importer(data, { fileName: file.name }));
    } catch (e) {
      say('That file could not be read: ' + (e && e.message ? e.message : String(e)), 'no');
      return;
    }
    const { ok, errors } = validateSong(song);
    if (!ok) {
      say('That file did not turn into a usable song: ' + errors.join('; '), 'no');
      return;
    }
    let storedId;
    try {
      storedId = await library.add(song, { now: Date.now() });
    } catch (e) {
      say('The song could not be saved: ' + (e && e.message ? e.message : String(e)), 'no');
      return;
    }
    // D2: a single import mentions the stored id in its own message only
    // when it actually changed (a same-titled song already in the library) --
    // nothing else here reads song.id afterward, so there is no other place
    // to reconcile.
    const idNote = storedId !== song.id ? ' (saved as "' + storedId + '" -- a song with that id was already saved)' : '';
    if (warnings && warnings.length) say('Added "' + song.title + '". ' + warnings.join(' ') + idNote, 'ok');
    else say('Added "' + song.title + '" to your songs.' + idNote, 'ok');
    await refreshList();
  }

  importInput.addEventListener('change', handleFile);

  // A pending requestOpenSong() (src/ui/learn.js's "Practise this") --
  // read once, on the very next show(), then cleared so it never re-fires
  // the next time a learner opens Songs normally. A song this panel cannot
  // find (removed, or from a store that failed to open) is silently
  // skipped rather than shown as an error: the request has already served
  // its purpose of getting the learner here.
  async function checkOpenRequest() {
    const req = api.store(OPEN_REQUEST_STORE_ID).get();
    if (!req || !req.songId) return;
    api.store(OPEN_REQUEST_STORE_ID).set(null);
    const song = await library.get(req.songId);
    if (!song || !song.parts.length) return;
    const partId = req.partId || song.parts[0].id;
    const instrument = req.instrumentId ? READY_INSTRUMENTS.find((i) => i.id === req.instrumentId) : undefined;
    startPractice(song, partId, instrument);
  }

  refreshList();

  return {
    show() {
      refreshList();
      checkOpenRequest();
    },
    hide() {
      stopRecording();
      // A learner who judged at least one step then switched to another
      // panel without finishing the lesson still gets that practice counted
      // -- otherwise a session cut short by "I'll come back to this" never
      // shows up in the practice log at all. Same logSession() path and the
      // same practice.sessionLogged guard the lesson-finish call above uses,
      // so returning to this same lesson and finishing it later does not
      // log a second row for the steps already counted here.
      if (practice && !practice.sessionLogged && typeof api.logSession === 'function') {
        const summary = summarizePracticeSession(practice, api.now());
        if (summary) { practice.sessionLogged = true; api.logSession(summary); }
      }
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
