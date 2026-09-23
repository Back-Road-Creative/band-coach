// Quantizes heard notes (wall-clock seconds, straight from the pitch
// tracker) onto the song's tempo map, in ticks -- with a per-note confidence
// so the UI can flag onsets that landed far from any sensible grid point,
// triplet detection so a swung/compound passage isn't force-fit to straight
// 16ths, and pickup-bar inference so a recording that starts mid-bar (an
// anacrusis) gets a sane bar 1 once `shiftBarline` (src/song/edit.js) is
// applied to the result. Pure: no DOM, no AudioContext, no clock reads --
// everything (notes, tempo map, options) is a parameter, and the caller owns
// applying `shiftBarline` itself. This is a fresh implementation for the
// tempo-map shape from src/song/model.js (A2, tempoMap[{tick,bpm}]); it does
// not read or change src/song/transcribe.js's own single-bpm quantize.

const DEFAULT_PPQ = 480;

function isFiniteNumber(x) { return typeof x === 'number' && Number.isFinite(x); }

// Builds the seconds<->ticks conversion for a tempo map with possibly more
// than one entry (a tempo change mid-piece). `tempoMap` is the model's
// shape: [{ tick, bpm }, ...] sorted by tick, ticks measured at `ppq`
// ticks-per-quarter. Returns { secToTick(sec) }. A caller that already has
// its own seconds<->ticks mapping (e.g. from a live scheduler) can bypass
// this entirely by passing `opts.secondsToTicks` to quantizeNotes instead.
function buildClock(tempoMap, ppq) {
  const list = Array.isArray(tempoMap) && tempoMap.length ? tempoMap.slice().sort((a, b) => a.tick - b.tick) : [{ tick: 0, bpm: 120 }];
  const segs = [];
  let segStartSec = 0;
  for (let i = 0; i < list.length; i++) {
    const bpm = isFiniteNumber(list[i].bpm) && list[i].bpm > 0 ? list[i].bpm : 120;
    const tick = isFiniteNumber(list[i].tick) && list[i].tick >= 0 ? list[i].tick : 0;
    const nextTick = i + 1 < list.length ? list[i + 1].tick : Infinity;
    const durTicks = nextTick - tick;
    const durSec = durTicks === Infinity ? Infinity : (durTicks / ppq) * (60 / bpm);
    segs.push({ tick, sec: segStartSec, bpm, durSec });
    if (durSec !== Infinity) segStartSec += durSec;
  }
  function secToTick(sec) {
    const s = isFiniteNumber(sec) ? Math.max(0, sec) : 0;
    let seg = segs[0];
    for (const candidate of segs) {
      if (candidate.sec <= s + 1e-9) seg = candidate; else break;
    }
    const secIntoSeg = s - seg.sec;
    return seg.tick + (secIntoSeg / (60 / seg.bpm)) * ppq;
  }
  return { secToTick };
}

function snapTo(tick, gridStartTick, unit) {
  const rel = tick - gridStartTick;
  return gridStartTick + Math.round(rel / unit) * unit;
}

// A beat whose raw onsets fit a triplet grid (3 equal divisions per beat)
// markedly better than the straight grid (4 equal divisions per beat) is
// called a triplet beat. "Markedly" is a hard threshold (triplet error at
// most 70% of straight error) rather than "whichever is smaller" so a beat
// with only one onset (which fits either grid trivially) defaults to
// straight instead of flip-flopping on noise.
export function detectTuplets(rawTicks, opts = {}) {
  const ppq = isFiniteNumber(opts.ppq) && opts.ppq > 0 ? opts.ppq : DEFAULT_PPQ;
  const straightUnit = ppq / 4;
  const tripletUnit = ppq / 3;
  const byBeat = new Map();
  (Array.isArray(rawTicks) ? rawTicks : []).forEach((t) => {
    const beat = Math.floor(t / ppq);
    if (!byBeat.has(beat)) byBeat.set(beat, []);
    byBeat.get(beat).push(t);
  });
  const grids = new Map();
  for (const [beat, ticks] of byBeat) {
    const beatStart = beat * ppq;
    let errS = 0;
    let errT = 0;
    ticks.forEach((t) => {
      errS += Math.abs(t - snapTo(t, beatStart, straightUnit));
      errT += Math.abs(t - snapTo(t, beatStart, tripletUnit));
    });
    const isTriplet = ticks.length > 1 && errT < errS * 0.7;
    grids.set(beat, isTriplet ? 'triplet' : 'straight');
  }
  return grids;
}

// Quantizes heard notes onto the tempo map, in ticks. `notes` is
// [{ midi, startSec, durSec }]; `tempoMap` is the model's [{ tick, bpm }]
// shape (an empty/undefined map falls back to a flat 120bpm, same default
// as src/song/model.js's normalizeSong). `opts.ppq` defaults to 480 (the
// model's TICKS_PER_QUARTER); `opts.grid` forces 'straight' or 'triplet'
// everywhere instead of per-beat detection; `opts.secondsToTicks` overrides
// the built-in tempo-map conversion with a caller-supplied function.
// Confidence falls linearly from 1 (exact grid point) to 0 (half a grid
// unit away, the worst a "round to nearest" snap can produce).
export function quantizeNotes(notes, tempoMap, opts = {}) {
  const ppq = isFiniteNumber(opts.ppq) && opts.ppq > 0 ? opts.ppq : DEFAULT_PPQ;
  const list = Array.isArray(notes) ? notes : [];
  if (!list.length) return [];

  const secToTick = typeof opts.secondsToTicks === 'function' ? opts.secondsToTicks : buildClock(tempoMap, ppq).secToTick;

  const raw = list.map((n) => ({
    midi: n.midi,
    startTick: secToTick(n.startSec),
    endTick: secToTick((isFiniteNumber(n.startSec) ? n.startSec : 0) + (isFiniteNumber(n.durSec) ? n.durSec : 0)),
  }));

  const straightUnit = ppq / 4;
  const tripletUnit = ppq / 3;
  const forcedGrid = opts.grid === 'straight' || opts.grid === 'triplet' ? opts.grid : null;
  const grids = forcedGrid ? new Map() : detectTuplets(raw.map((n) => n.startTick), { ppq });

  return raw.map((n) => {
    const beat = Math.floor(n.startTick / ppq);
    const beatStart = beat * ppq;
    const gridKind = forcedGrid || grids.get(beat) || 'straight';
    const unit = gridKind === 'triplet' ? tripletUnit : straightUnit;
    const tick = Math.round(snapTo(n.startTick, beatStart, unit));
    let endTick = Math.round(snapTo(n.endTick, beatStart, unit));
    if (endTick <= tick) endTick = tick + unit;
    const dist = Math.abs(n.startTick - tick);
    const confidence = Math.max(0, Math.min(1, 1 - dist / (unit / 2)));
    return { midi: n.midi, tick, durTicks: endTick - tick, confidence };
  });
}

// Infers a pickup (anacrusis) length in ticks from a set of quantized notes:
// the phase (tick mod bar length) most heavily weighted by note duration and
// confidence is treated as "where the recurring strong beat actually falls
// within the bar". `shiftBarline(song, pickupTicks)` (src/song/edit.js) adds
// pickupTicks to every note, which is the forward shift that lands that
// phase exactly on a bar boundary (adding `barTicks - phase`, rather than
// subtracting `phase`, keeps every shifted note at or after tick 0, which is
// what shiftBarline requires). Returns 0 (no pickup) if there are no notes,
// or if the phase found is already 0.
export function inferPickup(quantized, metre, opts = {}) {
  const ppq = isFiniteNumber(opts.ppq) && opts.ppq > 0 ? opts.ppq : DEFAULT_PPQ;
  const list = Array.isArray(quantized) ? quantized : [];
  if (!list.length) return 0;
  const num = metre && isFiniteNumber(metre.num) && metre.num >= 1 ? metre.num : 4;
  const den = metre && isFiniteNumber(metre.den) && metre.den > 0 ? metre.den : 4;
  const barTicks = num * (4 / den) * ppq;
  if (!(barTicks > 0)) return 0;

  const weightOf = (n) => Math.max(1e-6, isFiniteNumber(n.durTicks) ? n.durTicks : 1) * (isFiniteNumber(n.confidence) ? Math.max(0.05, n.confidence) : 1);
  const totalWeight = list.reduce((s, n) => s + weightOf(n), 0) || 1;

  const step = Math.max(1, Math.round(ppq / 16));
  let best = { phase: 0, weight: -1 };
  for (let phase = 0; phase < barTicks; phase += step) {
    let weight = 0;
    list.forEach((n) => {
      const rel = ((n.tick - phase) % barTicks + barTicks) % barTicks;
      if (rel < step / 2 || rel > barTicks - step / 2) weight += weightOf(n);
    });
    if (weight > best.weight) best = { phase, weight };
  }
  if (best.weight / totalWeight < 0.3 || best.phase === 0) return 0;
  return Math.round((barTicks - best.phase) % barTicks);
}
