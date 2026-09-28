// Shared driver for playing the Hot Cross Buns starter song's lesson to its
// end via the real Songs panel -- copied from tests/characterization/
// kbd-practice-song-handoff.test.mjs (C11a), which owns the original and is
// left untouched. See that file's own comments for the reasoning behind the
// per-step-kind key and the tempo-ladder rate rescaling.
import { starterSongs } from '../../src/song/starter/index.js';
import { buildLessonPlan } from '../../src/song/lesson.js';
import { byId as instrumentById } from '../../src/instruments/index.js';

export const HOT_CROSS_BUNS_STEPS_BY_HEADING = (() => {
  const song = starterSongs.find((s) => s.id === 'hot-cross-buns');
  const plan = buildLessonPlan(song, song.parts[0].id, instrumentById.kbd);
  const STEP_WORDS = {
    listen: 'Listen', rhythm: 'Clap the rhythm', pitches: 'Play the notes, any speed',
    'phrase-slow': 'Play it slowly', 'tempo-ladder': 'Play it up to speed',
    chain: 'Play the phrases together', whole: 'Play the whole piece',
  };
  const byHeading = {};
  for (const step of plan.steps) {
    if (!step.passRule) continue; // 'listen' steps are driven by "Next", never by notes
    const key = (STEP_WORDS[step.kind] || step.kind) + ' (bars ' + (step.bars[0] + 1) + '-' + (step.bars[1] + 1) + ')';
    const notes = step.notes.map((n) => ({
      midi: n.midi,
      offsetSec: (n.start - step.originTick) / song.ticksPerQuarter * (60 / step.bpm),
    }));
    (byHeading[key] = byHeading[key] || []).push(notes);
  }
  return byHeading;
})();

export async function playHotCrossBunsToTheEnd(page) {
  const attemptCounts = {};
  for (let i = 0; i < 40; i++) {
    const finished = await page.evaluate(
      "(document.querySelector('.panel-songs-practice p') || {}).textContent && document.querySelector('.panel-songs-practice p').textContent.includes('whole piece')"
    );
    if (finished) return;
    const hasNext = await page.evaluate(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Next')"
    );
    if (hasNext) {
      await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Next').click()");
      continue;
    }
    // The badge (data-difficulty span) is a CHILD of the h4, so plain
    // textContent already reads "<title> (bars X-Y)Easy" -- matched with a
    // non-greedy heading capture rather than trimmed separately.
    const heading = await page.evaluate(
      "(() => { const h4 = document.querySelector('.panel-songs-practice h4'); return h4 && h4.textContent; })()"
    );
    const headingKey = heading && (heading.match(/^(.*\(bars \d+-\d+\))/) || [])[1];
    const rungs = headingKey ? HOT_CROSS_BUNS_STEPS_BY_HEADING[headingKey] : null;
    if (!rungs) { throw new Error('no known notes for step heading: ' + heading); }
    const attemptIndex = Math.min(attemptCounts[headingKey] || 0, rungs.length - 1);
    attemptCounts[headingKey] = (attemptCounts[headingKey] || 0) + 1;
    const notes = rungs[attemptIndex];
    // A tempo-ladder step's REAL bpm is step.bpm scaled by the loop transport's
    // own rate (src/ui/songs.js's effectiveBpm/backingBpm), which speeds up
    // after a clean loop -- so the on-screen "Playing at NN% speed"/"Full
    // speed" readout (src/ui/songs/loop-backing.js's rateLabel) is read here
    // and the plan's own (fixed-bpm) offsets rescaled to match, or a rung
    // reached after an earlier clean one judges these notes as late.
    const ratePct = await page.evaluate(
      "(() => { const r = document.querySelector('.panel-songs-rate'); if (!r) return 100; const m = r.textContent.match(/(\\d+)%/); return m ? Number(m[1]) : 100; })()"
    );
    const scale = 100 / Math.max(1, Math.round(100 * (ratePct / 100)));
    const scaledNotes = notes.map((n) => ({ midi: n.midi, offsetSec: n.offsetSec * scale }));
    // Click "Your turn" and wait for the real (wall-clock) count-in to end --
    // recordStartSec is set synchronously inside startRecording(), but the
    // MIDI listener that forwardNoteAt()'s events reach is only subscribed
    // once beginListening() actually runs, at the count-in's end. Once it
    // has, songsNoteAt's offsetSec is stamped exactly, whatever moment this
    // call itself lands.
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Your turn').click()");
    await page.waitFor(
      "document.querySelector('.panel-songs-count') && document.querySelector('.panel-songs-count').textContent.startsWith('Notes heard so far')",
      8000
    );
    await page.evaluate(
      `(() => { ${JSON.stringify(scaledNotes)}.forEach(n => window.__coach.songsNoteAt(n.midi, n.offsetSec, true)); })()`
    );
    await page.waitFor(
      "Array.from(document.querySelectorAll('.panel-songs-practice button')).some(b => b.textContent === 'Stop and check')"
    );
    await page.evaluate("Array.from(document.querySelectorAll('.panel-songs-practice button')).find(b => b.textContent === 'Stop and check').click()");
    await page.waitFor("document.querySelector('.panel-songs-practice h4') || document.querySelector('.panel-songs-practice p')");
  }
  throw new Error('Hot Cross Buns did not reach "whole piece" within the loop budget');
}
