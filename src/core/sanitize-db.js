// sanitizeDB: the one gate between a stored or restored profile and the
// running app. Pure: no DOM, no storage, no clock (the caller passes
// `modelNow`). The app's instrument tables come in through `deps`, the same
// way safeSet takes its storage, so a unit test can drive this with a few
// fake tables and never boot a browser. sanitizePanelData (src/ui/panels.js)
// comes in the same way, so this core module imports nothing from src/ui.
//
// Every allow-list check is an OWN-key check (own()): a plain-object lookup
// such as MODS[p.mod] is truthy for an inherited key, so a hand-edited or
// shared backup naming 'constructor', 'toString' or '__proto__' passed as a
// valid instrument and the app booted on Object's own constructor.
import { validateEvent, boundEvents } from './learning-events.js';
import { sanitizeNoteNaming } from './note-names.js';
import { ROOM_CHECK_VERSION } from '../audio/levels.js';
import { exerciseRangeFor, tonicFromRange } from '../instruments/how/voice-range.js';

const NOTATE_MODES = ['names', 'staff', 'both'];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (x, d, lo, hi) => { x = +x; if (!isFinite(x)) x = d; return clamp(x, lo, hi); };
// hasOwnProperty.call, not Object.hasOwn: the build targets es2020 and Object.hasOwn is ES2022, so an older browser would throw on every load.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// repairEventClocks (bc-clk): before this fix, src/ui/songs.js stamped a song row's
// `at` with the audio clock (seconds since page load, resets to 0 every reload)
// instead of epoch ms like every other row -- so a saved row with a finite `at`
// under EVENT_CLOCK_EPOCH_FLOOR (1e12 ms is the year 2001; the audio clock could
// never reach that many SECONDS of page-open time) came from that bug and its
// stamped `at` is not the real time. Repaired with the `at` of the next row in
// array order (DB.events is append-only -- logEvent only pushes, boundEvents only
// drops rows, never reorders, so array order IS push order) that has a real epoch
// `at`; a bad row with no later epoch row (nothing trustworthy comes after it) falls
// back to `modelNow`, the load time -- never earlier than the truth, so a
// return/retention wait (src/core/pathway.js) is never granted early. `id` is left
// untouched.
const EVENT_CLOCK_EPOCH_FLOOR = 1e12;
function repairEventClocks(events, modelNow) {
  const out = events.slice();
  for (let i = 0; i < out.length; i++) {
    if (Number.isFinite(out[i].at) && out[i].at < EVENT_CLOCK_EPOCH_FLOOR) {
      let fixedAt = modelNow;
      for (let j = i + 1; j < out.length; j++) { if (Number.isFinite(out[j].at) && out[j].at >= EVENT_CLOCK_EPOCH_FLOOR) { fixedAt = out[j].at; break; } }
      out[i] = Object.assign({}, out[i], { at: fixedAt });
    }
  }
  return out;
}

export function sanitizeDB(v, defaultLatencyMs, modelNow, deps) {
  const { MODS, MOD_IDS, WIND_KINDS, VOICE_KINDS, LOCALES, NOTATE_MOD_IDS, sanitizeModel, sanitizePanelData, skillMap } = deps;
  const notate = {}; NOTATE_MOD_IDS.forEach(m => { notate[m] = 'names'; });
  const d = { v: 1, mods: {}, sessions: [], events: [], prefs: { mod: 'kbd', wind: 'bb', voice: 'low', kbdHands: 'both', sessionMinutes: null, names: true, noiseFloor: null, noiseFloorV: null, inputDeviceId: null, notate: notate, theme: 'system', locale: 'en', noteNaming: { system: 'letters', accidentals: 'mixed' } } }; v = (v && typeof v === 'object') ? v : {};
  MOD_IDS.forEach(m => { d.mods[m] = sanitizeModel(m, v.mods && v.mods[m], modelNow); });
  if (Array.isArray(v.sessions)) d.sessions = v.sessions.filter(x => x && typeof x.d === 'string' && own(MODS, x.mod)).slice(-60).map(x => {
    // source/songId (a panel-logged row, e.g. a finished or abandoned song
    // lesson -- see songs.js's logSession()) are optional: a built-in
    // drill's row never carried them and still shouldn't after this load,
    // so an absent/non-string value is dropped rather than sanitised to ''
    // or null, keeping a drill row and a song row's own shape distinct.
    const row = { d: x.d.slice(0, 10), mod: x.mod, min: num(x.min, 0, 0, 600), acc: num(x.acc, 0, 0, 1), a1: num(x.a1, 0, 0, 1), a2: num(x.a2, 0, 0, 1), from: num(x.from, 1, 1, 80), to: num(x.to, 1, 1, 80), breaks: num(x.breaks, 0, 0, 99) };
    if (typeof x.source === 'string') row.source = x.source;
    if (typeof x.songId === 'string') row.songId = x.songId;
    return row;
  });
  // DB.events (src/core/learning-events.js): each row is validated with
  // the SAME validateEvent() a writer runs before push -- a corrupt or
  // hand-edited row is dropped here, never thrown, exactly like an
  // invalid DB.sessions row above is filtered rather than crashing load.
  if (Array.isArray(v.events)) d.events = boundEvents(repairEventClocks(v.events.filter(x => validateEvent(x).ok), modelNow), { skillMap: skillMap, skillMapInstrument: 'kbd' });
  const p = v.prefs || {}; if (own(MODS, p.mod)) d.prefs.mod = p.mod; if (own(WIND_KINDS, p.wind)) d.prefs.wind = p.wind; d.prefs.voiceRange = (p.voiceRange && typeof p.voiceRange === 'object' && Number.isFinite(p.voiceRange.low) && Number.isFinite(p.voiceRange.high) && p.voiceRange.low < p.voiceRange.high) ? { low: clamp(Math.round(p.voiceRange.low), 24, 96), high: clamp(Math.round(p.voiceRange.high), 24, 96) } : null; const VKp = Object.assign({}, VOICE_KINDS, d.prefs.voiceRange ? { mine: ['My range (found by test)', tonicFromRange(exerciseRangeFor(d.prefs.voiceRange)).tonic] } : {}); if (own(VKp, p.voice)) d.prefs.voice = p.voice; d.prefs.names = p.names !== false;
  d.prefs.noiseFloor = (typeof p.noiseFloor === 'number' && isFinite(p.noiseFloor) && p.noiseFloor >= 0) ? clamp(p.noiseFloor, 0, 1) : null;
  // A floor stored before the room check could abstain (no marker, or an older one) may have learned playing: drop it, so the next Connect measures again. Progress-file imports run through this too.
  d.prefs.noiseFloorV = p.noiseFloorV === ROOM_CHECK_VERSION ? ROOM_CHECK_VERSION : null; if (d.prefs.noiseFloorV === null) d.prefs.noiseFloor = null; if (d.prefs.noiseFloor === null) d.prefs.noiseFloorV = null;
  d.prefs.inputDeviceId = typeof p.inputDeviceId === 'string' && p.inputDeviceId ? p.inputDeviceId : null;
  // Theme J1: System/Light/Dark, an unrecognised or missing saved value
  // sanitises to 'system' so a corrupt/old backup never leaves the toggle
  // stuck on nothing it can render.
  d.prefs.theme = ['system', 'light', 'dark'].indexOf(p.theme) >= 0 ? p.theme : 'system';
  d.prefs.locale = LOCALES.some(l => l.code === p.locale) ? p.locale : 'en';
  // Note naming J2: letters / German (H/B) / fixed-do solfege, each in
  // sharps, flats or mixed spelling -- unknown or missing sanitises to
  // today's default so nname() never has a pref it can't render.
  d.prefs.noteNaming = sanitizeNoteNaming(p.noteNaming);
  d.prefs.harpKey = (Number.isInteger(p.harpKey) && p.harpKey >= 0 && p.harpKey <= 11) ? p.harpKey : 0;
  // Piano hands together B1: Both/Right only/Left only, same allow-list
  // sanitising pattern as prefs.wind/prefs.voice above -- an unrecognised
  // or missing saved value sanitises to 'both', today's only behaviour.
  d.prefs.kbdHands = ['both', 'right', 'left'].indexOf(p.kbdHands) >= 0 ? p.kbdHands : 'both';
  // Session length E7c: 5/10/15 minutes or no limit at all (null, today's
  // only behaviour) -- same allow-list sanitising pattern as
  // prefs.kbdHands above, so any other saved value (a string '5', 0, 20,
  // garbage) sanitises to no limit rather than a target the coach can't
  // explain.
  d.prefs.sessionMinutes = [5, 10, 15].indexOf(p.sessionMinutes) >= 0 ? p.sessionMinutes : null;
  // "Show: staff / names / both" is per-instrument and defaults to 'names',
  // i.e. today's display, untouched, for any instrument not set.
  const pn = (p.notate && typeof p.notate === 'object') ? p.notate : {};
  NOTATE_MOD_IDS.forEach(m => { if (NOTATE_MODES.indexOf(pn[m]) >= 0) d.prefs.notate[m] = pn[m]; });
  d.custom = Array.isArray(v.custom) ? v.custom.map(x => Math.round(num(x, 60, 20, 110))).slice(0, 300) : [];
  d.latencyMs = num(v.latencyMs, defaultLatencyMs || 0, 0, 300);
  d.panels = sanitizePanelData(v.panels);
  return d;
}
