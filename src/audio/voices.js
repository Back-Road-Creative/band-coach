// Family-shaped reference-tone synthesis. Every sample is COMPUTED (sums of
// decaying sine partials) at render time, never an embedded recording: the
// app is one double-clickable HTML file with a $0 budget and no server, so
// "sampled instrument sounds" has to mean synthesis, not sample playback.
// See src/app.js `tone()`, the single call site.
//
// Render functions are PURE (freq, sampleRate, seconds, volume) -> a
// Float32Array of samples in roughly [-1, 1]. That purity is deliberate: it
// lets tests assert pitch accuracy (src/audio/yin.js) and loudness directly
// in node, with no OfflineAudioContext, no browser. The real playback path
// (src/app.js `tone()`) copies the returned array into an AudioBuffer and
// plays it with an AudioBufferSourceNode — a pre-rendered buffer can never
// glitch in the real-time audio callback the way a per-sample ScriptProcessor
// or AudioWorklet doing this same math live could on a slow device.
//
// Pitch accuracy is non-negotiable (learners tune to this tone): every
// partial is an exact integer multiple of `freq`, so the fundamental YIN
// detects is `freq` itself, not a value the envelope or decay shape can
// drift.

const TWO_PI = Math.PI * 2;

// schema.js FAMILIES: keys, fretted, bowed, wind, brass, voice, percussion,
// free-reed. A family not listed here (including any future addition to
// schema.js FAMILIES) falls back to 'sustain' via recipeForFamily, so a new
// instrument always gets a sensible voice rather than silence or a throw.
const FAMILY_RECIPE = {
  keys: 'struck',
  fretted: 'pluck',
  percussion: 'pluck',
  bowed: 'sustain',
  wind: 'sustain',
  'free-reed': 'sustain',
  voice: 'sustain',
  brass: 'brass',
};

// Extra brightness (upper-partial weight) per family for the 'sustain'
// recipe; brass gets its own, higher value below. Absent, sustain uses a
// moderate default.
const BRIGHTNESS = {
  bowed: 0.5,
  wind: 0.4,
  'free-reed': 0.45,
  voice: 0.35,
};
const DEFAULT_BRIGHTNESS = 0.4;
const BRASS_BRIGHTNESS = 0.9;

// A rendered buffer is never longer than the `seconds` a caller actually
// asked for (src/app.js `tone()` sizes the mic's deaf window off the
// buffer's own length -- see F5, src/audio/deaf-window.js -- so a floor
// bigger than a real short note, e.g. a fretted play-along's 0.05-0.12s
// notes, src/ui/editor.js:450 and src/ui/songs.js:302, would make the app
// stop listening for longer than the arrangement's own note). This
// EPSILON_SECONDS floor only guards against a zero/negative `seconds`
// producing a zero-length buffer; it is far below the shortest real
// duration any caller passes. Instrument character comes from each
// recipe's relative partial mix and decay/attack SHAPE, not from an
// absolute minimum ring-out time -- a short arranged note legitimately
// sounds like a short, damped pluck/strike/sustain, the way a real
// instrument stopped early would.
const EPSILON_SECONDS = 0.01;

export function recipeForFamily(family) {
  return FAMILY_RECIPE[family] || 'sustain';
}

// The ACTUAL length (seconds) of the buffer renderVoice() will produce for
// the requested `seconds`. src/app.js `tone()` calls this (or just reads
// the rendered buffer's own length) to size the deaf window to the voice's
// real audible tail -- which by construction is never longer than
// `seconds` itself, matching the pre-synthesis behaviour where the deaf
// window was sized off the caller's own `dur`.
export function voiceDurationSeconds(family, seconds) {
  return Math.max(seconds || 0, EPSILON_SECONDS);
}

// Ramps the LAST `seconds` of a buffer down to 0 -- used by the pluck/struck
// recipes so cutting the buffer off at the caller's requested duration (no
// floor to let the natural decay finish) never produces an audible click at
// the boundary. Fits inside the existing buffer; never extends it.
function applyTailFade(buf, sampleRate, seconds) {
  const fadeSamples = Math.min(buf.length, Math.round(seconds * sampleRate));
  const start = buf.length - fadeSamples;
  for (let i = 0; i < fadeSamples; i++) {
    buf[start + i] *= 1 - i / fadeSamples;
  }
}

function makeBuffer(seconds, sampleRate) {
  return new Float32Array(Math.max(1, Math.round(seconds * sampleRate)));
}

// Normalizes a partial-gain list so their sum is 1 -- the worst-case
// constructive-interference peak (all partials momentarily in phase) is
// then exactly `volume`, keeping every recipe in the same loudness ballpark
// regardless of how many partials it mixes.
function normalize(gains) {
  const sum = gains.reduce((a, b) => a + b, 0) || 1;
  return gains.map((g) => g / sum);
}

// Linear ramp 0 -> 1 over `seconds` from the start of the buffer, then 1 --
// a soft onset so the buffer's first sample is never a hard click.
function onsetRamp(t, seconds) {
  if (seconds <= 0) return 1;
  return t >= seconds ? 1 : t / seconds;
}

// -- plucked/fretted/percussion: fast-decay partials, each higher partial
// dying faster than the one below it -- a Karplus-Strong-flavoured stand-in
// that keeps the fundamental exact (no noise burst to smear pitch) while
// still reading as struck-and-ringing rather than sustained.
export function renderPluck(freq, sampleRate, seconds, volume = 0.22) {
  const buf = makeBuffer(seconds, sampleRate);
  const gains = normalize([1, 0.55, 0.3, 0.18, 0.1]);
  const decayRate = 3.2;
  for (let i = 0; i < buf.length; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let p = 0; p < gains.length; p++) {
      s += gains[p] * Math.sin(TWO_PI * freq * (p + 1) * t) * Math.exp(-decayRate * (p + 1) * t);
    }
    buf[i] = s * volume * onsetRamp(t, 0.002);
  }
  // A short note is cut off before the natural exponential decay reaches
  // silence (no floor extends it to let that finish) -- fade the tail
  // instead of truncating hard, so ending the buffer never clicks.
  applyTailFade(buf, sampleRate, Math.min(0.01, seconds * 0.3));
  return buf;
}

// -- keyboard: a brighter, slower-decaying struck envelope than pluck.
export function renderStruck(freq, sampleRate, seconds, volume = 0.22) {
  const buf = makeBuffer(seconds, sampleRate);
  const gains = normalize([1, 0.4, 0.22, 0.12]);
  const decayRate = 1.6;
  for (let i = 0; i < buf.length; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let p = 0; p < gains.length; p++) {
      s += gains[p] * Math.sin(TWO_PI * freq * (p + 1) * t) * Math.exp(-decayRate * (p + 1) * t);
    }
    buf[i] = s * volume * onsetRamp(t, 0.004);
  }
  applyTailFade(buf, sampleRate, Math.min(0.01, seconds * 0.3));
  return buf;
}

// -- bowed/wind/free-reed/voice/brass: soft attack, near-steady sustain,
// short release. `brightness` controls how much upper-partial energy is
// mixed in (brass uses a much higher value than the others).
export function renderSustain(freq, sampleRate, seconds, volume = 0.22, brightness = DEFAULT_BRIGHTNESS) {
  const dur = Math.max(seconds, EPSILON_SECONDS);
  // Attack/release scale down for a short note rather than imposing an
  // absolute floor: a fixed 0.05s attack + 0.08s release used to force
  // every sustained note to at least 0.18s regardless of what was asked
  // for, which is exactly the deaf-window-outlives-the-note regression
  // this module now guards against (see voiceDurationSeconds above).
  const attack = Math.min(0.05, dur * 0.3);
  const release = Math.min(0.08, dur * 0.3);
  const buf = makeBuffer(dur, sampleRate);
  const gains = normalize([1, brightness / 2, brightness / 3, brightness / 4]);
  const releaseStart = dur - release;
  for (let i = 0; i < buf.length; i++) {
    const t = i / sampleRate;
    let env;
    if (t < attack) env = t / attack;
    else if (t < releaseStart) env = 1;
    else env = Math.max(0, (dur - t) / release);
    let s = 0;
    for (let p = 0; p < gains.length; p++) s += gains[p] * Math.sin(TWO_PI * freq * (p + 1) * t);
    buf[i] = s * volume * env;
  }
  return buf;
}

export function renderBrass(freq, sampleRate, seconds, volume = 0.22) {
  return renderSustain(freq, sampleRate, seconds, volume, BRASS_BRIGHTNESS);
}

// Renders the family-appropriate voice. Never throws: an unknown/missing
// family resolves through recipeForFamily's 'sustain' fallback, so a
// mis-registered or future instrument still gets sound.
export function renderVoice(family, freq, sampleRate, seconds, volume = 0.22) {
  const recipe = recipeForFamily(family);
  const dur = voiceDurationSeconds(family, seconds);
  if (recipe === 'pluck') return renderPluck(freq, sampleRate, dur, volume);
  if (recipe === 'struck') return renderStruck(freq, sampleRate, dur, volume);
  if (recipe === 'brass') return renderBrass(freq, sampleRate, dur, volume);
  const brightness = BRIGHTNESS[family] !== undefined ? BRIGHTNESS[family] : DEFAULT_BRIGHTNESS;
  return renderSustain(freq, sampleRate, dur, volume, brightness);
}
