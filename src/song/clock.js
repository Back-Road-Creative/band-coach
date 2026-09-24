// One song clock merging a song's opening bpm with its tempoMap. Pure functions, no DOM, no
// AudioContext — the caller owns the clock. tempoMap entries at tick 0 are always superseded by
// song.bpm (export-musicxml.js:284's "measure 1's tempo is always song.bpm" rule, generalised
// here), so callers building the actual timing curve never see a conflicting tick-0 entry.
import { tickToSeconds, secondsToTick } from '../audio/analysis/tempo-map.js';

// Returns the tempo-map entries a clock should use: song.bpm at tick 0, followed by every
// tempoMap entry with tick > 0 (a tick-0 entry in tempoMap, if present, is dropped — song.bpm
// wins, matching export-musicxml.js:283-284).
export function songTempoEntries(song) {
  const changes = (Array.isArray(song.tempoMap) ? song.tempoMap : []).filter((entry) => entry.tick > 0);
  return [{ tick: 0, bpm: song.bpm }, ...changes];
}

// Builds a clock over `song`'s merged tempo entries: bpmAt(tick) reads the tempo in effect at
// a tick, sec(fromTick, toTick, scale) converts a tick span to elapsed seconds (scale stretches
// every segment, e.g. 0.5 = half speed), tickAfter(fromTick, sec, scale) is its inverse (how far
// forward, in ticks, `sec` seconds of playback at `scale` carries from fromTick), and
// changesBetween(fromTick, toTick) lists the tempo-map entries whose tick falls strictly inside
// (fromTick, toTick].
export function createSongClock(song) {
  const entries = songTempoEntries(song);
  const ppq = song.ticksPerQuarter;
  function bpmAt(tick) {
    let bpm = entries[0].bpm;
    for (const entry of entries) if (entry.tick <= tick) bpm = entry.bpm;
    return bpm;
  }
  function sec(fromTick, toTick, scale = 1) {
    const raw = tickToSeconds(entries, toTick, ppq) - tickToSeconds(entries, fromTick, ppq);
    return raw / scale;
  }
  function tickAfter(fromTick, secElapsed, scale = 1) {
    const fromSec = tickToSeconds(entries, fromTick, ppq);
    return secondsToTick(entries, fromSec + secElapsed * scale, ppq);
  }
  function changesBetween(fromTick, toTick) {
    return entries.filter((entry) => entry.tick > fromTick && entry.tick <= toTick);
  }
  return { bpmAt, sec, tickAfter, changesBetween };
}
