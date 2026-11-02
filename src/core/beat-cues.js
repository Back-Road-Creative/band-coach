// The timing behind every "when do I play?" cue on screen: the beat number,
// the line that crosses each note on time, the ring that closes on a drum, and
// the Songs runway. Pure: the clock is always an argument, so a test can stand
// at any moment of a take. Drawing lives in src/app.js and
// src/ui/songs/beat-guide.js. Nothing here changes how a hit is scored.

// A hit is marked after taking the output latency (and, in the trainer, its
// learned offset) off the moment it landed, so a hit in time lands that much
// AFTER the note's written time. Drawn on the raw clock, the cues would meet
// the note early and teach the learner to play early.
export function cueClock(nowSec, latencyMs, offsetSec) {
  return nowSec - (offsetSec || 0) - (latencyMs || 0) / 1000;
}

export function beatTimes(t0, spb, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(t0 + i * spb);
  return out;
}

// The beat in progress at `t`: its number within the bar (counting UP from 1),
// its place in `times`, and `pulse`, 1 on the beat fading to 0 by the next one.
// Takes a list rather than a tempo so a song's tempo change keeps the count
// right. The last beat lasts as long as the one before it.
export function beatAt(t, times, perBar) {
  if (!times.length || t < times[0]) return null;
  let i = 0;
  while (i + 1 < times.length && times[i + 1] <= t) i++;
  const span = i + 1 < times.length ? times[i + 1] - times[i] : (i > 0 ? times[i] - times[i - 1] : 1);
  const into = (t - times[i]) / span;
  if (into >= 1) return null;
  return { n: (i % perBar) + 1, index: i, pulse: 1 - into };
}

// Where the line is at `t`, given points { t, x } in time order. Straight
// between points, so it crosses each one exactly on time however unevenly the
// notes are engraved, and it waits at both ends.
export function sweepAt(t, points) {
  if (t <= points[0].t) return points[0].x;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1], b = points[i];
      return a.x + ((t - a.t) / (b.t - a.t)) * (b.x - a.x);
    }
  }
  return points[points.length - 1].x;
}

// One ring per drum, for that drum's own next hit within `leadSec`: progress
// runs 0 (just appeared) to 1 (the hit). A drum's hit one eighth away shows a
// nearly closed ring while a drum three eighths away shows a wide one.
export function drumRings(onsets, t, leadSec) {
  const seen = new Set(), rings = [];
  for (const o of onsets) {
    if (o.t < t) continue;
    const away = o.t - t;
    for (const piece of o.pieces) {
      if (seen.has(piece)) continue;
      seen.add(piece);
      if (away <= leadSec) rings.push({ piece, progress: 1 - away / leadSec });
    }
  }
  return rings;
}

// Should the metronome keep going through the bar being played? Yes, up to the
// last level (past it, keeping time alone is the point) unless a live mic is
// being counted: it would hear each click from the speakers as a hit.
// (The Songs guide makes the same call for itself: src/ui/songs.js startRecording.)
export function clicksThrough({ level, levels, micCounts }) {
  return level <= levels && !micCounts;
}

// The blocks on screen at `t`. A note at `nowX` is due now; `windowSec` of music
// fits between the line and the right edge, and what has left the canvas is gone.
export function runwayBlocks(notes, t, { windowSec, nowX, width }) {
  const pxPerSec = (width - nowX) / windowSec, out = [];
  for (const n of notes) {
    const x = nowX + (n.sec - t) * pxPerSec, w = n.dur * pxPerSec;
    if (x > width || x + w < 0) continue;
    out.push({ x, w, row: n.row, note: n });
  }
  return out;
}

// Top to bottom the way a drum staff reads: cymbals, then drums, kick last.
const DRUM_ROWS = ['crash', 'ride', 'hihat-open', 'hihat-closed', 'hihat-pedal', 'tom-high', 'tom-mid', 'snare', 'tom-floor', 'kick'];

// What a Songs try's guide shows. `help` false (Check) or `timed` false (a
// step with no tempo to follow) leaves only the count-in, since anything more
// would be a clock or an answer. `tickSec(tick, originTick)` is the same timing
// the judge uses, so the runway and the marking agree.
export function guideSpec({ notes, originTick, song, tickSec, help, timed, kit, rhythmOnly }) {
  const perBar = song.metre.num;
  if (!help || !timed || !notes.length) return { perBar, runway: false, phraseBeats: [], notes: [], rows: [] };
  const beatTicks = song.ticksPerQuarter * (4 / song.metre.den);
  const lastTick = Math.max(...notes.map((n) => n.start + n.dur));
  const phraseBeats = [];
  for (let tick = originTick; tick < lastTick; tick += beatTicks) phraseBeats.push(tickSec(tick, originTick));
  let rows, rowOf;
  if (kit) {
    rows = DRUM_ROWS.filter((p) => notes.some((n) => n.piece === p));
    rowOf = (n) => rows.indexOf(n.piece);
  } else if (rhythmOnly) {
    rows = [null];
    rowOf = () => 0;
  } else {
    // Higher pitch, higher row. No note names: this shows the shape of the
    // tune, and the staff above it stays the one place a note is named.
    const pitches = [...new Set(notes.map((n) => n.midi))].sort((a, b) => b - a);
    rows = pitches.map(() => null);
    rowOf = (n) => pitches.indexOf(n.midi);
  }
  return {
    perBar,
    runway: true,
    phraseBeats,
    rows,
    notes: notes.map((n) => {
      const sec = tickSec(n.start, originTick);
      return { sec, dur: tickSec(n.start + n.dur, originTick) - sec, row: rowOf(n), piece: n.piece };
    }),
  };
}
