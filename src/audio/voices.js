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

// The shortest a rendered buffer is allowed to be per recipe, in seconds --
// long enough for the recipe's own decay/release shape to read as that
// instrument rather than being clipped short by a very brief `dur` request.
const MIN_SECONDS = { pluck: 0.5, struck: 0.9, sustain: 0.18, brass: 0.18 };

export function recipeForFamily(family) {
  return FAMILY_RECIPE[family] || 'sustain';
}

// The ACTUAL length (seconds) of the buffer renderVoice() will produce for
// this family and requested `seconds`. src/app.js `tone()` calls this (or
// just reads the rendered buffer's own length) to size the deaf window to
// the voice's real audible tail, never just the nominal `dur` argument.
export function voiceDurationSeconds(family, seconds) {
  const recipe = recipeForFamily(family);
  const floor = MIN_SECONDS[recipe] !== undefined ? MIN_SECONDS[recipe] : MIN_SECONDS.sustain;
  return Math.max(seconds || 0, floor);
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
  return buf;
}

// -- bowed/wind/free-reed/voice/brass: soft attack, near-steady sustain,
// short release. `brightness` controls how much upper-partial energy is
// mixed in (brass uses a much higher value than the others).
export function renderSustain(freq, sampleRate, seconds, volume = 0.22, brightness = DEFAULT_BRIGHTNESS) {
  const attack = 0.05, release = 0.08;
  const dur = Math.max(seconds, attack + release + 0.05);
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
