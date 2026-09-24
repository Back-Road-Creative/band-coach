// Drum-hit classifier (src/audio/drum-classify.js): the microphone path of the drum-kit
// trainer needs to say which of kick / snare / hi-hat it heard at each onset. MIDI drums
// are exact; a mic in front of an acoustic kit is not, so this is measured here against
// synthesized hits at three levels, a rock beat, silence and a sustained guitar-like note.
//
// All signals are deterministic (seeded PRNG from audio-analysis-fixtures.mjs, never
// Math.random). "Decays ~N ms" below means the amplitude envelope exp(-t/tau) reaches
// -40 dB (1%) at N ms, i.e. tau = N / ln(100).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrumClassifier, classifyHits } from '../../src/audio/drum-classify.js';
import { makeRng } from './audio-analysis-fixtures.mjs';

const SR = 44100;
const FRAME = 2048;
const HOP = 512;
const tauFor = (ms) => ms / 1000 / Math.log(100);

// RBJ-cookbook second-order filter, run in place over `buf`.
function biquad(buf, type, f0, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f0) / SR, cw = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  const b1 = type === 'lp' ? 1 - cw : -(1 + cw), b0 = type === 'lp' ? (1 - cw) / 2 : (1 + cw) / 2, b2 = b0;
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y; buf[i] = y;
  }
  return buf;
}

function noise(n, seed) {
  const rng = makeRng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

function normalizePeak(buf, peak) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
}

const LEN = Math.round(0.3 * SR);

// (a) Kick: sine whose pitch drops fast from 120 Hz to 50 Hz over ~40 ms (settling near the
// 60 Hz body), amplitude decaying ~150 ms.
function kick() {
  const out = new Float32Array(LEN), tau = tauFor(150);
  let phase = 0;
  for (let i = 0; i < LEN; i++) {
    const t = i / SR;
    const f = 50 + 70 * Math.exp(-t / 0.01); // 120 Hz at t=0, ~50 Hz by 40 ms
    phase += (2 * Math.PI * f) / SR;
    out[i] = Math.exp(-t / tau) * Math.sin(phase);
  }
  return normalizePeak(out, 1);
}

// (b) Snare: 180 Hz + 330 Hz tone burst decaying ~120 ms, plus white noise band-limited to
// 1-8 kHz decaying ~150 ms.
function snare(seed = 7) {
  const out = new Float32Array(LEN), tTone = tauFor(120), tNoise = tauFor(150);
  const n = noise(LEN, seed);
  biquad(n, 'hp', 1000); biquad(n, 'hp', 1000); biquad(n, 'lp', 8000); biquad(n, 'lp', 8000);
  normalizePeak(n, 1);
  for (let i = 0; i < LEN; i++) {
    const t = i / SR;
    const tone = 0.5 * (Math.sin(2 * Math.PI * 180 * t) + Math.sin(2 * Math.PI * 330 * t));
    out[i] = Math.exp(-t / tTone) * tone + 0.8 * Math.exp(-t / tNoise) * n[i];
  }
  return normalizePeak(out, 1);
}

// (c) Hi-hat: white noise high-passed above 5 kHz, decaying ~60 ms.
function hihat(seed = 11) {
  const n = noise(LEN, seed), tau = tauFor(60);
  biquad(n, 'hp', 5000); biquad(n, 'hp', 5000);
  for (let i = 0; i < LEN; i++) n[i] *= Math.exp(-i / SR / tau);
  return normalizePeak(n, 1);
}

// Isolated hit placed after a short silent pre-roll, scaled to a peak level in dBFS.
function isolated(hit, dbfs, preroll = 256) {
  const out = new Float32Array(preroll + hit.length);
  const g = Math.pow(10, dbfs / 20);
  for (let i = 0; i < hit.length; i++) out[preroll + i] = hit[i] * g;
  return out;
}

const HITS = { kick, snare, hihat };
const LEVELS = [-6, -18, -30];
const measured = []; // filled as tests run; printed when DRUM_REPORT is set (numbers quoted in the module header)
process.on('exit', () => { if (process.env.DRUM_REPORT) console.log(measured.join('\n')); });

for (const [name, make] of Object.entries(HITS)) {
  for (const db of LEVELS) {
    test(`isolated ${name} at ${db} dBFS classifies as ${name} with confidence >= 0.6`, () => {
      const clf = createDrumClassifier({ sampleRate: SR, frameSize: FRAME });
      const r = clf.classify(isolated(make(), db).subarray(0, FRAME));
      measured.push(`${name}@${db}: kind=${r.kind} conf=${r.confidence.toFixed(3)} low=${r.bands.low.toFixed(3)} mid=${r.bands.mid.toFixed(3)} high=${r.bands.high.toFixed(3)}`);
      assert.equal(r.kind, name, `bands ${JSON.stringify(r.bands)}`);
      assert.ok(r.confidence >= 0.6, `confidence ${r.confidence}`);
      const sum = r.bands.low + r.bands.mid + r.bands.high;
      assert.ok(Math.abs(sum - 1) < 1e-6, `bands are shares of the in-band energy, sum ${sum}`);
    });
  }
}

test('classify() is level-independent: the same hit at -6 and -30 dBFS gives the same band shares', () => {
  const clf = createDrumClassifier({ sampleRate: SR, frameSize: FRAME });
  const a = clf.classify(isolated(snare(), -6).subarray(0, FRAME));
  const loud = { ...a.bands };
  const b = clf.classify(isolated(snare(), -30).subarray(0, FRAME));
  for (const k of ['low', 'mid', 'high']) assert.ok(Math.abs(loud[k] - b.bands[k]) < 1e-3, `${k}: ${loud[k]} vs ${b.bands[k]}`);
});

test('classify() reuses one result object (zero allocation per call) and zero-pads a short frame', () => {
  const clf = createDrumClassifier({ sampleRate: SR, frameSize: FRAME });
  const r1 = clf.classify(isolated(kick(), -6).subarray(0, FRAME));
  const r2 = clf.classify(isolated(hihat(), -6).subarray(0, 1024));
  assert.equal(r1, r2);
  assert.equal(r2.kind, 'hihat');
});

test('a silent frame is unsure (null), never a guess', () => {
  const clf = createDrumClassifier({ sampleRate: SR, frameSize: FRAME });
  const r = clf.classify(new Float32Array(FRAME));
  assert.equal(r.kind, null);
  assert.equal(r.confidence, 0);
});

test('createDrumClassifier rejects a missing sampleRate or a non-power-of-two frameSize', () => {
  assert.throws(() => createDrumClassifier({ frameSize: FRAME }));
  assert.throws(() => createDrumClassifier({ sampleRate: SR, frameSize: 1000 }));
});

// (d) Rock beat at 100 bpm, two bars: hat every eighth, kick on 1 and 3, snare on 2 and 4.
// Coinciding hits are summed. Priority rule under test: kick+hat -> 'kick', snare+hat -> 'snare'
// (the drum a learner is asked to play on that beat is the kick or snare; the hat rides on
// every eighth anyway).
function rockBeat() {
  const eighth = 60 / 100 / 2;
  const n = Math.round((16 * eighth + 0.5) * SR);
  const out = new Float32Array(n);
  const expected = [];
  const add = (hit, start, gain) => { for (let i = 0; i < hit.length && start + i < n; i++) out[start + i] += hit[i] * gain; };
  const k = kick(), s = snare(), h = hihat();
  for (let e = 0; e < 16; e++) {
    const start = Math.round((0.1 + e * eighth) * SR);
    add(h, start, 0.3);
    let kind = 'hihat';
    if (e % 4 === 0) { add(k, start, 0.8); kind = 'kick'; }
    if (e % 4 === 2) { add(s, start, 0.6); kind = 'snare'; }
    expected.push({ t: start / SR, kind });
  }
  return { pcm: out, expected };
}

// peakDb null = as synthesized (peak ~1.1: kick 0.8 + hat 0.3 summed); otherwise rescaled so
// the loudest sample sits at that level -- a quiet mic or low input gain.
for (const peakDb of [null, -30]) {
  test(`a two-bar rock beat at 100 bpm${peakDb === null ? '' : ` at ${peakDb} dBFS peak`} yields 16 onsets (+-1) with the right drum on every beat`, () => {
    const { pcm, expected } = rockBeat();
    if (peakDb !== null) normalizePeak(pcm, Math.pow(10, peakDb / 20));
    const hits = classifyHits(pcm, { sampleRate: SR, frameSize: FRAME, hop: HOP });
    measured.push(`rock beat ${peakDb}: ${hits.length} hits; ${hits.map((h) => `${h.t.toFixed(3)}:${h.kind}:${h.confidence.toFixed(2)}`).join(' ')}`);
    assert.ok(Math.abs(hits.length - 16) <= 1, `expected 16 +-1 onsets, got ${hits.length}`);
    for (const exp of expected) {
      const near = hits.find((h) => Math.abs(h.t - exp.t) < 0.03);
      assert.ok(near, `no hit within 30 ms of ${exp.kind} at ${exp.t.toFixed(3)}s`);
      assert.equal(near.kind, exp.kind, `at ${exp.t.toFixed(3)}s`);
    }
  });
}

test('silence yields no hits', () => {
  assert.deepEqual(classifyHits(new Float32Array(SR), { sampleRate: SR, frameSize: FRAME, hop: HOP }), []);
});

test('a steady noise floor (mic hiss) gives at most its one start onset, not a stream of hits', () => {
  for (const amp of [0.3, 0.1, 0.01, 0.001]) { // a loud fan or hiss down to a quiet one
    const pcm = noise(3 * SR, 3);
    for (let i = 0; i < pcm.length; i++) pcm[i] *= amp;
    const hits = classifyHits(pcm, { sampleRate: SR, frameSize: FRAME, hop: HOP });
    assert.ok(hits.length <= 1, `noise at ${amp}: ${JSON.stringify(hits)}`);
  }
});

test('a sustained 440 Hz sine (a held guitar note) is not heard as a kick or snare more than once', () => {
  const n = 2 * SR, pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; pcm[i] = 0.5 * Math.min(1, t / 0.02) * Math.sin(2 * Math.PI * 440 * t); }
  const hits = classifyHits(pcm, { sampleRate: SR, frameSize: FRAME, hop: HOP });
  measured.push(`440 Hz sine: ${JSON.stringify(hits)}`);
  assert.ok(hits.filter((h) => h.kind === 'kick' || h.kind === 'snare').length <= 1, JSON.stringify(hits));
});

