// Acceptance: a learner picks a recording on "Add a song" and reads the review.
// The pick is a real file chooser (chooseFile), the clicks are real, and the
// file is the one a person downloads (the release build). Nothing here reaches
// through a debug hook: the page is only OBSERVED (the review's own DOM, and the
// songs the app stored in its own IndexedDB).
//
// What these pin is the file door's contract: what the app heard, said in the
// review, is what was played; a recording with no notes in it is not dressed up
// as a song; and a clean recording can be practised straight from the review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withAcceptancePage } from '../helpers/browser.mjs';
import { chooseFile } from '../helpers/file-chooser.mjs';
import { pluck, rms, writePluckWav } from '../helpers/pluck-wav.mjs';

const SR = 22050;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const NO_NOTES = 'No notes were captured — nothing was transcribed.';
const TPQ = 480; // ticks per quarter note (the stored song's resolution)

// ---- fixtures, written to a temp dir at run time (no binary files in git) ----
const dir = mkdtempSync(join(tmpdir(), 'bc-file-transcription-'));
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } });
const concat = (parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const silence = (seconds) => new Float32Array(Math.round(seconds * SR));
// One pluck per entry, each `slots[i]` seconds long: the string rings, then `gap`
// seconds of nothing, then the next one. Same seed for every pluck.
function melody(midis, { slots, gap = 0.3, gain = 1, seed = 2 } = {}) {
  return concat(midis.map((m, i) => concat([pluck(hz(m), SR, slots[i] - gap, { gain, seed }), silence(gap)])));
}
const wav = (name, pcm) => writePluckWav(join(dir, name + '.wav'), pcm, SR);
const rand32 = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// The clean melody: one long note that is the tonic (the bar line and the key
// both lean on it), then three shorter ones. 7.5 s. The probe chose it: of the
// even four-slot variants none clears the metre and key checks.
const CLEAN = [60, 64, 67, 69];
const SLOTS = [3, 1.5, 1.5, 1.5];
const PCM = {
  clean: melody(CLEAN, { slots: SLOTS }),
  quiet: melody(CLEAN, { slots: SLOTS, gain: 0.05 }),
  loud: melody(CLEAN, { slots: SLOTS, gain: 0.9 }),
  replucks: melody([69, 69, 69], { slots: [0.8, 0.8, 0.8] }),
  decay: pluck(hz(69), SR, 2.5, { decay: 0.998 }),
  silence: silence(2),
  noise: (() => { const r = rand32(7); const n = new Float32Array(2 * SR); for (let i = 0; i < n.length; i++) n[i] = r() * 2 - 1; const g = 0.1 / rms(n); return n.map((x) => x * g); })(),
  clipped: pluck(hz(69), SR, 2, { gain: 8 }),
  wrong: melody([60, 64, 64, 69], { slots: SLOTS }),
  poly: (() => { const a = pluck(hz(60), SR, 2.5, { seed: 1 }); const b = pluck(hz(67), SR, 2.5, { seed: 2 }); return a.map((x, i) => (x + b[i]) / 2); })(),
};
const FILE = Object.fromEntries(Object.entries(PCM).map(([k, v]) => [k, wav(k, v)]));

// ---- the learner's actions and what they can read ----
async function openAddSong(page) {
  await page.clickSelector('#mainNav button[data-route="songs"]');
  await page.clickSelector('.add-song-row button');
}
// The label is the control the page offers; when its box is laid over by its own
// section (a wrapped line leaves the box centre empty) the visible input is the
// same control, so the pick goes there. Never setFileInput.
async function pick(page, file) {
  try {
    return await chooseFile(page, 'label[for="songsFileInput"]', file);
  } catch (e) {
    if (!/obscured|opened no file chooser/.test(e.message)) throw e;
    return chooseFile(page, '#songsFileInput', file);
  }
}

const readStore = (page) => page.evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open('bandcoach-songs', 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const tx = db.transaction('kv', 'readonly'); const st = tx.objectStore('kv');
  const keys = await new Promise((res) => { const q = st.getAllKeys(); q.onsuccess = () => res(q.result); });
  const out = [];
  for (const k of keys) if (String(k).startsWith('song:')) out.push(await new Promise((res) => { const q = st.get(k); q.onsuccess = () => res(q.result); }));
  db.close();
  return out;
})()`);

// What the app stored, as the plain numbers a test asserts on.
async function readSongs(page) {
  const songs = await readStore(page);
  return songs.map((s) => ({
    id: s.id,
    bpm: s.bpm,
    tempoMap: s.tempoMap || null,
    notes: ((s.parts && s.parts[0] && s.parts[0].notes) || []).map((n) => ({ start: n.start, dur: n.dur, midi: n.midi, confidence: n.confidence })),
  }));
}

// What the review screen says, observation only.
const readReview = (page) => page.evaluate(`(() => {
  const r = document.querySelector('.panel-learn-result');
  if (!r || r.hidden) return null;
  const texts = (sel) => Array.from(r.querySelectorAll(sel)).map((e) => e.textContent.trim());
  const btn = r.querySelector('.panel-learn-practise-btn');
  const reason = r.querySelector('.panel-learn-practise-gate-reason');
  return {
    title: (r.querySelector('h4') || {}).textContent || null,
    checks: texts('ul.panel-learn-checklist li'),
    strip: Array.from(r.querySelectorAll('.panel-learn-confidence-note')).map((e) => e.getAttribute('data-confidence')),
    unsure: texts('ul.panel-learn-unsure-list li'),
    practiseDisabled: btn ? btn.disabled : null,
    reason: reason ? reason.textContent.trim() : null,
  };
})()`);

// Picks `file` and waits until the review is on screen and the song is stored
// (the app's own "Working it out…" line has gone), then returns what it says.
async function pickAndRead(t, page, file, { stored = 1 } = {}) {
  await pick(page, file);
  const deadline = Date.now() + 60000;
  for (;;) {
    const review = await readReview(page);
    const status = await page.evaluate("(document.querySelector('.panel-songs-msg') || {}).textContent || ''");
    if (review && (await readStore(page)).length >= stored && !/Working it out/.test(status)) {
      const songs = await readSongs(page);
      // The probe, kept: what the review and the store said for this file.
      t.diagnostic(`${file.split('/').pop()}: ${JSON.stringify({ review, status, songs: songs.map((x) => ({ bpm: x.bpm, notes: x.notes.map((n) => `${n.midi}@${n.start}+${n.dur}`) })) })}`);
      return { review, songs, status };
    }
    if (Date.now() > deadline) throw new Error(`no review after the pick; the status line says: ${status}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const tickPolyphonic = (page) => page.clickSelector('label[for="songsPolyphonic"]');

// The seconds a stored note lasts, from the song's own tempo.
const secondsOf = (song, ticks) => (ticks / TPQ) * (60 / (song.tempoMap && song.tempoMap[0] ? song.tempoMap[0].bpm : song.bpm));


const midisOf = (song) => song.notes.map((n) => n.midi);
const CLEAN_MIDIS = [60, 64, 67, 69];
// Each test is one learner on a fresh page: open Songs, open Add a song, pick.
async function learnerPicks(t, file, { polyphonic = false } = {}, then) {
  await withAcceptancePage(t, {}, async (page) => {
    await openAddSong(page);
    if (polyphonic) await tickPolyphonic(page);
    const got = await pickAndRead(t, page, file);
    return then(got, page);
  });
}

// The review a recording with no notes in it gets: said plainly, nothing to
// practise. Also the control for itself: the clean melody must not pass it.
function assertEmptyReview({ review, songs }) {
  assert.deepEqual(review.checks, [NO_NOTES], 'the check list says nothing was captured');
  assert.deepEqual(review.strip, [], 'no note strip');
  assert.deepEqual(review.unsure, [], 'no unsure-note list');
  assert.equal(review.practiseDisabled, true, 'there is nothing to practise');
  assert.ok(review.reason, 'and the review says why');
  assert.equal(songs.length, 1);
  assert.equal(songs[0].notes.length, 0, 'the stored song has no notes');
}

test('1. a clean melody: four notes in order, nothing to check, ready to practise', async (t) => {
  await learnerPicks(t, FILE.clean, {}, ({ review, songs }) => {
    assert.equal(review.strip.length, 4, 'four notes on the strip');
    assert.deepEqual(midisOf(songs[0]), CLEAN_MIDIS, 'the stored notes are the ones played, in order');
    assert.deepEqual(review.unsure, ['No notes are unsure.']);
    // Both halves of "ready" are reported together, so a failure shows which.
    const failed = [];
    try { assert.deepEqual(review.checks, [], 'nothing left to check'); } catch (e) { failed.push(e.message.split('\n')[0] + ' ' + JSON.stringify(review.checks)); }
    try { assert.equal(review.practiseDisabled, false, `Practise is enabled (${review.reason})`); } catch (e) { failed.push(e.message.split('\n')[0]); }
    assert.deepEqual(failed, [], 'the review is ready to practise');
  });
});

test('2. a quiet and a loud take of the same melody store the same four pitches', async (t) => {
  for (const name of ['quiet', 'loud']) {
    await learnerPicks(t, FILE[name], {}, ({ songs }) => {
      assert.deepEqual(midisOf(songs[0]), CLEAN_MIDIS, `${name}: the four pitches`);
    });
  }
});

test('3. the same note plucked three times is three notes', async (t) => {
  await learnerPicks(t, FILE.replucks, {}, ({ songs }) => {
    assert.deepEqual(midisOf(songs[0]), [69, 69, 69]);
  });
});

test('4. a long ring is one note that lasts about as long as it is loud enough to be heard', async (t) => {
  // The test works out from its own samples where the last window the app can
  // hear (rms 0.008, yin's floor) starts; the note ends about one hop later.
  const pcm = PCM.decay;
  const hop = Math.round(0.05 * SR);
  let lastLoud = 0;
  for (let s = 0; s < pcm.length; s += hop) {
    const w = new Float32Array(4096);
    w.set(pcm.subarray(s, Math.min(s + 4096, pcm.length)));
    if (rms(w) >= 0.008) lastLoud = s / SR;
  }
  const expected = lastLoud + 0.05;
  await learnerPicks(t, FILE.decay, {}, ({ songs }) => {
    const [song] = songs;
    assert.equal(song.notes.length, 1, 'one note');
    assert.equal(song.notes[0].midi, 69);
    const seconds = secondsOf(song, song.notes[0].dur);
    const tolerance = secondsOf(song, 120) + 0.1; // one 16th plus 100 ms
    t.diagnostic(`decay: the note lasts ${seconds.toFixed(3)} s, the test expects ${expected.toFixed(3)} s +/- ${tolerance.toFixed(3)}`);
    assert.ok(Math.abs(seconds - expected) <= tolerance, `lasts ${seconds.toFixed(3)} s; the audible ring is ${expected.toFixed(3)} s`);
  });
});

test('5. silence: the review says nothing was captured and offers nothing to practise', async (t) => {
  await learnerPicks(t, FILE.silence, {}, assertEmptyReview);
});

test('5b. control: the clean melody does not pass the silence checks', async (t) => {
  await learnerPicks(t, FILE.clean, {}, (got) => {
    assert.throws(() => assertEmptyReview(got), assert.AssertionError);
  });
});

test('6. noise: no notes on the strip and nothing to practise', async (t) => {
  await learnerPicks(t, FILE.noise, {}, ({ review, songs }) => {
    assert.deepEqual(review.strip, [], 'no strip');
    assert.equal(review.practiseDisabled, true);
    t.diagnostic(`noise: ${songs[0].notes.length} stored notes; checks ${JSON.stringify(review.checks)}`);
  });
});

test('7. clipping: characterised, and no pitch but the one played is stored', async (t) => {
  await learnerPicks(t, FILE.clipped, {}, ({ review, songs }) => {
    t.diagnostic(`clipped review: ${JSON.stringify(review)}`);
    // A file that stored nothing would pass the per-note check below with no notes to check.
    assert.ok(songs[0].notes.length >= 1, 'the clipped note is stored, not dropped');
    for (const m of midisOf(songs[0])) assert.equal(m, 69);
  });
});

test('8. a wrong note is stored as played, not as the one that was meant', async (t) => {
  // The learner meant C E G A and played C E E A. A file has no target to
  // compare against, so the honest result is what was played.
  await learnerPicks(t, FILE.wrong, {}, ({ songs }) => {
    assert.deepEqual(midisOf(songs[0]), [60, 64, 64, 69]);
    assert.ok(!midisOf(songs[0]).includes(67), 'the G that was meant is not there');
  });
});

test('9. two notes at once, with "More than one note at a time" ticked: voices are flagged, practise waits', async (t) => {
  await learnerPicks(t, FILE.poly, { polyphonic: true }, ({ review }) => {
    assert.ok(review.checks.some((c) => /^I heard \d+ voices?/.test(c)), `a voices line: ${JSON.stringify(review.checks)}`);
    assert.equal(review.practiseDisabled, true);
    assert.ok(review.reason);
  });
  // Control off: characterised only. Two notes sharing one period may be heard
  // as one wrong note, with nothing flagged.
  await learnerPicks(t, FILE.poly, {}, ({ review, songs }) => {
    t.diagnostic(`polyphonic file, control off: ${JSON.stringify({ review, midis: midisOf(songs[0]) })}`);
  });
});

test('10. picking the same file again gives a second review and a second song', async (t) => {
  await withAcceptancePage(t, {}, async (page) => {
    await openAddSong(page);
    await pickAndRead(t, page, FILE.clean);
    // Both takes read the same, but a second review cannot be mistaken for the
    // first: picking clears the review panel (songs.js handleFile), so the review
    // pickAndRead finds after this pick was drawn for it. Mutation: skip the draw
    // on the second import and pickAndRead times out with no review.
    const second = await pickAndRead(t, page, FILE.clean, { stored: 2 });
    assert.equal(second.songs.length, 2, 'two songs are stored');
    assert.deepEqual(midisOf(second.songs[1]), CLEAN_MIDIS);
    assert.equal(second.review.strip.length, 4, 'the review on screen is the second take');
  });
});

const practiseClick = async ({ review }, page) => {
  assert.equal(review.practiseDisabled, false, `Practise is enabled before the click (${review.reason})`);
  await page.clickSelector('.panel-learn-practise-btn');
  await page.waitFor("document.querySelector('.panel-songs-practice h3')", 30000);
  return page.evaluate(`({ title: document.querySelector('.panel-songs-practice h3').textContent, shown: !document.querySelector('.panel-songs-practice').hidden && document.querySelector('.panel-songs-practice').offsetParent !== null })`);
};

test('11. Practise this, on a clean recording, builds the lesson for that recording', async (t) => {
  await learnerPicks(t, FILE.clean, {}, async (r, page) => {
    const view = await practiseClick(r, page);
    assert.equal(view.title, 'clean', "Practise this opens this recording's own lesson");
  });
});

// Measured after the fix (the button is disabled at the parent, so this path is
// unreachable there): the lesson IS built for the song, but the Songs practice
// section keeps its `hidden` attribute (it is created hidden, songs.js:651;
// startPractice() and checkOpenRequest() never clear it; only openSong() does,
// :1125), so a learner who clicks Practise this sees no lesson. That file is
// outside this unit's Owns, so the assertion is a todo that reports (not fails)
// until the section is shown; then drop the todo (and fold this into test 11).
test('11c. the lesson is on screen after Practise this', { todo: 'practiceSection stays hidden after the review handoff (src/ui/songs.js startPractice)' }, async (t) => {
  await learnerPicks(t, FILE.clean, {}, async (r, page) => {
    assert.equal((await practiseClick(r, page)).shown, true, 'the practice lesson is visible to the learner');
  });
});

test('11b. control: a recording with a flagged item stays blocked, and the reason counts the items', async (t) => {
  await learnerPicks(t, FILE.poly, { polyphonic: true }, ({ review }) => {
    assert.equal(review.practiseDisabled, true);
    const m = /^Fix up the (\d+) .*, then practise\.$/.exec(review.reason || '');
    assert.ok(m, `the reason: ${review.reason}`);
    assert.equal(Number(m[1]), review.checks.length, 'it counts the items listed above it');
  });
});
