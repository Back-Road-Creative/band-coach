// Pure session helpers for the Songs panel (note-event shaping, count-in, import
// notes, mastery credit, session summary). No DOM, no AudioContext; moved
// unchanged from src/ui/songs.js so the panel file keeps only panel code.
import { countInTimes, clampBpm, DEFAULT_BPM } from '../learn/count-in.js';
import { t } from '../../core/i18n.js';
import { GRADE, review, migrateItem } from '../../core/srs.js';

// Cents deviation of a detected frequency from the nearest equal-tempered
// semitone `midi` -- positive is sharp, negative is flat. Pure (no DOM, no
// AudioContext), the same maths src/app.js's own live tuner uses (fmidi =
// 69 + 12*log2(f/440), app.js's fmidi), just expressed as an offset from a given
// target rather than rounded to the nearest note itself.
export function centsFromFreq(freq, midi) {
  const fractionalMidi = 69 + 12 * Math.log2(freq / 440);
  return (fractionalMidi - midi) * 100;
}

// One mic-detected note as a played event. durSec starts at one capture
// tick (50 ms), so a note heard once and gone is judged as clipped short
// rather than skipped as "unmeasured"; the capture loop stretches it while
// the same pitch keeps sounding.
const MIC_TICK_SEC = 0.05;
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

// Plain-words sentence for a multi-song import: library.add() gave a song a
// different id than the file carried (song-2, ...) only because that id was
// already stored, so the learner now has a second copy; say so rather than
// let the import look like it did nothing new. '' when nothing collided.
export function alreadyInLibraryNote(songs, storedIds) {
  const n = songs.filter((s, i) => storedIds[i] !== s.id).length;
  return n === 0 ? '' : n === 1 ? t('songs.import.alreadyOne') : t('songs.import.alreadyMany', { count: n });
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

// E6c: the plain-words notice for what a single-song notation import
// changes to fit the keyboard, built on E6a's fidelityReport (src/song/
// eval/fidelity.js). Only out-of-range/octaveShift are reachable for kbd
// today (sourceNotes is always null from this call site, and keys is not
// single-line, so dropped/merged/chordReduced are always empty -- see
// fidelity.js's own doc comment) -- the dropped/merged wording below is
// kept for whenever a caller that DOES have sourceNotes reuses this. Pure:
// no DOM, no instrument lookup, just the report's own numbers -> words.
// English strings live here rather than the i18n table -- songs.js is a
// CONVERTED_FILE for its existing strings, but this notice is scoped
// narrowly enough (E6c) that adding a whole shared-table block is out of
// this unit's OWNS; a later i18n pass can migrate it if it earns a home.
export function fidelityNoticeText(report) {
  if (!report) return '';
  const parts = [];
  const outOfRangeCount = (report.outOfRange || []).filter((u) => u.reason === 'out-of-range').length;
  if (outOfRangeCount > 0) parts.push(outOfRangeCount === 1 ? '1 note is too low or too high for the keyboard and will be skipped' : outOfRangeCount + ' notes are too low or too high for the keyboard and will be skipped');
  if (report.octaveShift) {
    const octaves = Math.abs(report.octaveShift) / 12;
    const dir = report.octaveShift > 0 ? 'up' : 'down';
    parts.push(octaves === 1 ? 'Moved ' + dir + ' 1 octave to fit the keyboard' : 'Moved ' + dir + ' ' + octaves + ' octaves to fit the keyboard');
  }
  const droppedCount = (report.dropped || []).length;
  if (droppedCount > 0) parts.push(droppedCount === 1 ? '1 note was dropped' : droppedCount + ' notes were dropped');
  const mergedCount = (report.merged || []).length;
  if (mergedCount > 0) parts.push(mergedCount === 1 ? '1 chord was merged into a single note' : mergedCount + ' chords were merged into single notes');
  if (parts.length === 0) return '';
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
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

// The stored "Calibrate timing" offset (DB.latencyMs) as Songs uses it: 0..300 ms
// (the range sanitize-db.js saves), a missing/negative/non-number value counts as 0.
export function songLatencyMs(db) {
  const n = Number(db && db.latencyMs);
  return Number.isFinite(n) ? Math.min(300, Math.max(0, n)) : 0;
}

// Played events shifted earlier by the offset, so the scorer judges when the
// learner played, not when the speakers-to-input chain delivered it.
export function latencyAdjusted(events, latencyMs) {
  return latencyMs ? events.map((e) => ({ ...e, atSec: e.atSec - latencyMs / 1000 })) : events;
}
