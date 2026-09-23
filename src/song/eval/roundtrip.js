// Round-trip evaluation harness: render each starter song (src/song/
// starter/index.js) to the synthetic per-frame pitch-tracker input that
// src/song/transcribe.js consumes -- NOT audio synthesis, the same
// synthetic-frames approach tests/unit/capture-v2-transcribe.test.mjs
// already uses for transcribe.js's own unit tests -- run it through
// transcribe(), and score the result against the song's own notes with
// note-f1.js. Pure: no DOM, no AudioContext, no real randomness (a seeded
// LCG only), so results are exactly reproducible.
//
// "Instrument family" here means the family keys in src/instruments/
// schema.js (FAMILIES), each mapped to a rendering profile that stands in
// for how differently that family's real capture would look to a pitch
// tracker: a keyboard is nearly noiseless, a bowed or wind instrument
// glides into pitch and wobbles more, a voice wobbles and glides the most.
// This module does not import src/instruments/* (out of this unit's
// scope) -- the profiles below are this harness's own approximation, not
// wired to any specific instrument's real characteristics.
//
// 'percussion' is left out: mallet/kit percussion is not a monophonic
// pitch-tracker target the way the other seven families are, and the
// starter songs are all plain melodies with no percussion part.

import { starterSongs } from '../starter/index.js';
import { ticksToSeconds } from '../model.js';
import { transcribe } from '../transcribe.js';
import { scoreNotes } from './note-f1.js';

// Seeded LCG, same construction as tests/unit/capture-v2-transcribe.test.mjs,
// so a given seed always renders identical frames.
function makeLcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// frameRate: frames/second the tracker samples at.
// jitterMs: random onset timing error (uniform, +/- jitterMs/2).
// wobbleCents: random pitch wobble per frame (uniform, +/- wobbleCents),
//   folded into semitones by eventsToNotes's own Math.round.
// glide: whether the first few frames ease in from a wider wobble,
//   standing in for an attack/portamento rather than an instant pitch lock.
export const FAMILY_PROFILES = {
  keys: { frameRate: 200, jitterMs: 0, wobbleCents: 0, glide: false },
  fretted: { frameRate: 200, jitterMs: 8, wobbleCents: 3, glide: false },
  bowed: { frameRate: 200, jitterMs: 12, wobbleCents: 8, glide: true },
  wind: { frameRate: 200, jitterMs: 15, wobbleCents: 8, glide: true },
  brass: { frameRate: 200, jitterMs: 15, wobbleCents: 6, glide: true },
  'free-reed': { frameRate: 200, jitterMs: 10, wobbleCents: 4, glide: false },
  voice: { frameRate: 200, jitterMs: 25, wobbleCents: 15, glide: true },
};

// Renders one Song's melody part (src/song/model.js shape: notes are
// { start, dur, midi } in ticks) into dense per-frame pitch-tracker output
// at the song's own bpm, using `rng` for jitter/wobble.
export function renderSongToFrames(song, profile, rng) {
  const frames = [];
  const notes = song.parts[0].notes;
  for (const note of notes) {
    const onsetSec = ticksToSeconds(note.start, song.bpm);
    const durSec = ticksToSeconds(note.dur, song.bpm);
    const jitterSec = profile.jitterMs ? (rng() - 0.5) * 2 * (profile.jitterMs / 1000) : 0;
    const start = Math.max(0, onsetSec + jitterSec);
    const sound = durSec * 0.95; // leave a small gap so consecutive notes don't merge
    const nFrames = Math.max(3, Math.round(sound * profile.frameRate));
    for (let i = 0; i < nFrames; i++) {
      const wobble = profile.wobbleCents ? (rng() - 0.5) * 2 * (profile.wobbleCents / 100) : 0;
      const glideFactor = profile.glide && i < 3 ? 3 - i : 1;
      frames.push({ t: start + i / profile.frameRate, midi: note.midi + wobble * glideFactor, confidence: 0.9 });
    }
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

// Runs one song through render -> transcribe -> score for one family
// profile. Returns note-f1.js's {precision, recall, f1, matched, ref, est}.
export function evaluateSong(song, familyName, seed = 1) {
  const profile = FAMILY_PROFILES[familyName];
  if (!profile) throw new Error(`roundtrip: unknown family "${familyName}"`);
  const rng = makeLcg(seed);
  const frames = renderSongToFrames(song, profile, rng);
  const { song: got } = transcribe(frames, {});

  const ref = song.parts[0].notes.map((n) => ({ onset: ticksToSeconds(n.start, song.bpm), midi: n.midi }));
  // `got.bpm` is transcribe()'s own tempo estimate, not the source song's
  // bpm -- its note ticks are only meaningful against its own bpm.
  const est = got.parts[0].notes.map((n) => ({ onset: ticksToSeconds(n.start, got.bpm), midi: n.midi }));
  return scoreNotes(ref, est);
}

// Evaluates every (song, family) pair (or the subset given in opts) and
// summarises per-song (a fixed 'keys' profile -- the cleanest signal, so a
// per-song regression isn't masked by a noisy family) and per-family (mean
// F1 across every song, for that family's rendering profile).
export function evaluateAll(opts = {}) {
  const songs = opts.songs ?? starterSongs;
  const families = opts.families ?? Object.keys(FAMILY_PROFILES);

  const perSong = songs.map((song) => {
    const r = evaluateSong(song, 'keys', 1);
    return { title: song.title, ...r };
  });

  const perFamily = families.map((family) => {
    const scores = songs.map((song) => evaluateSong(song, family, 1));
    const meanF1 = scores.reduce((sum, s) => sum + s.f1, 0) / scores.length;
    return { family, meanF1, scores };
  });

  return { perSong, perFamily };
}
