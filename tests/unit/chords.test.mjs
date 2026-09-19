import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chroma, judgeChord } from '../../src/audio/chords.js';

// ---------- synthetic spectra ----------
// Everything here is deterministic: no files, no network, no Math.random.
//
// Convention: each harmonic contributes power (not amplitude) proportional
// to 1/h — i.e. "harmonics 2..6 with 1/n amplitudes" is modelled as the
// bin's power weight directly, not squared again. This is the choice that
// actually reproduces plan F6's stated thresholds (score>72%, each pc>6%)
// for a single note against the CURRENT (pre-fix) rule; squaring 1/n again
// (treating 1/n as a voltage-style amplitude converted to power) produces a
// milder result that clears the score threshold but not the per-tone floor
// on the major third. Measured both ways while building this fixture set;
// picked the one that matches the plan's literal claim.
const SR = 48000, FFT = 8192;

function noteSeries(midi, nHarm = 6) {
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const comps = [];
  for (let h = 1; h <= nHarm; h++) comps.push({ freq: f0 * h, power: 1 / h });
  return comps;
}
function chordComps(rootMidi, semitoneOffsets) {
  return semitoneOffsets.flatMap(iv => noteSeries(rootMidi + iv));
}
// Renders a list of {freq, power} components into a dB-per-bin spectrum
// shaped like AnalyserNode.getFloatFrequencyData (length = fftSize / 2).
function spectrum(components, { sr = SR, fftSize = FFT } = {}) {
  const n = fftSize / 2, hz = sr / fftSize;
  const power = new Float64Array(n);
  for (const { freq, power: p } of components) {
    const bin = Math.round(freq / hz);
    if (bin >= 0 && bin < n) power[bin] += p;
  }
  const db = new Float64Array(n);
  for (let i = 0; i < n; i++) db[i] = power[i] > 0 ? 10 * Math.log10(power[i]) : -160;
  return db;
}
const pc = m => ((Math.round(m) % 12) + 12) % 12;

// One triad per string/fret-friendly root, majors and minors, matching the
// pitch classes src/app.js's CHORDS table already uses.
const TRIADS = {
  C: { root: 60, ivs: [0, 4, 7] },
  G: { root: 55, ivs: [0, 4, 7] },
  D: { root: 62, ivs: [0, 4, 7] },
  A: { root: 57, ivs: [0, 4, 7] },
  E: { root: 52, ivs: [0, 4, 7] },
  F: { root: 53, ivs: [0, 4, 7] },
  Am: { root: 57, ivs: [0, 3, 7] },
  Em: { root: 52, ivs: [0, 3, 7] },
  Dm: { root: 50, ivs: [0, 3, 7] },
};

function targetPcsOf({ root, ivs }) {
  return ivs.map(iv => pc(root + iv));
}

// ---------- F6 characterization: a single note's own harmonics ----------
test('CURRENT BEHAVIOUR (flaw F6): a lone note passes as a full major triad', () => {
  const db = spectrum(noteSeries(60)); // a single C4, harmonics 1..6
  const c = chroma(db, SR);
  const j = judgeChord({ chroma: c, targetPcs: targetPcsOf(TRIADS.C) });
  // This asserts the DESIRED behaviour (a bare note must not read as a
  // full triad). Run against the still-buggy extraction it is RED: the old
  // rule's score/each pass. See the report for the captured red output.
  assert.equal(j.ok, false, `a single note must not score as a full C major triad (got score=${j.score}, missing=${j.missing})`);
});

// ---------- fixture table: right triad, wrong shapes ----------
for (const [name, chord] of Object.entries(TRIADS)) {
  const pcs = targetPcsOf(chord);

  test(`${name}: the right triad passes`, () => {
    const db = spectrum(chordComps(chord.root, chord.ivs));
    const c = chroma(db, SR);
    const j = judgeChord({ chroma: c, targetPcs: pcs });
    assert.equal(j.ok, true, `${name} triad should pass (score=${j.score}, missing=${j.missing})`);
  });

  test(`${name}: the root alone fails`, () => {
    const db = spectrum(noteSeries(chord.root));
    const c = chroma(db, SR);
    const j = judgeChord({ chroma: c, targetPcs: pcs });
    assert.equal(j.ok, false, `${name} root alone must not pass as the full triad (score=${j.score}, missing=${j.missing})`);
  });

  test(`${name}: a root+fifth power chord fails the triad target`, () => {
    const db = spectrum(chordComps(chord.root, [0, 7]));
    const c = chroma(db, SR);
    const j = judgeChord({ chroma: c, targetPcs: pcs });
    assert.equal(j.ok, false, `${name} power chord (no third) must fail (score=${j.score}, missing=${j.missing})`);
  });

  test(`${name}: the parallel major/minor fails`, () => {
    const otherIvs = chord.ivs[1] === 3 ? [0, 4, 7] : [0, 3, 7];
    const wrongPcs = otherIvs.map(iv => pc(chord.root + iv));
    const db = spectrum(chordComps(chord.root, chord.ivs)); // the actual chord
    const c = chroma(db, SR);
    const j = judgeChord({ chroma: c, targetPcs: wrongPcs }); // judged against its parallel
    assert.equal(j.ok, false, `${name} must not also satisfy its parallel major/minor (score=${j.score})`);
  });

  test(`${name}: the right triad plus one loud wrong note fails`, () => {
    const wrongNote = noteSeries(chord.root + 2); // a major second above the root, full volume
    const db = spectrum(chordComps(chord.root, chord.ivs).concat(wrongNote));
    const c = chroma(db, SR);
    const j = judgeChord({ chroma: c, targetPcs: pcs });
    assert.equal(j.ok, false, `${name} plus a loud wrong note must fail (score=${j.score}, extra=${j.extra})`);
  });

  test(`${name}: the right triad in a different inversion/octave spread passes`, () => {
    const spread = [
      ...noteSeries(chord.root),
      ...noteSeries(chord.root + chord.ivs[1] + 12), // third up an octave
      ...noteSeries(chord.root + chord.ivs[2] - 12), // fifth down an octave
    ];
    const db = spectrum(spread);
    const c = chroma(db, SR);
    const j = judgeChord({ chroma: c, targetPcs: pcs });
    assert.equal(j.ok, true, `${name} spread across octaves should still pass (score=${j.score}, missing=${j.missing})`);
  });
}

// ---------- printed score table (threshold was chosen from this) ----------
test('score distribution table (informational, always passes)', () => {
  const rows = [];
  for (const [name, chord] of Object.entries(TRIADS)) {
    const pcs = targetPcsOf(chord);
    const score = (comps) => {
      const c = chroma(spectrum(comps), SR);
      return judgeChord({ chroma: c, targetPcs: pcs }).score.toFixed(3);
    };
    rows.push({
      chord: name,
      rightTriad: score(chordComps(chord.root, chord.ivs)),
      rootAlone: score(noteSeries(chord.root)),
      powerChord: score(chordComps(chord.root, [0, 7])),
      plusWrongNote: score(chordComps(chord.root, chord.ivs).concat(noteSeries(chord.root + 2))),
    });
  }
  console.log('\nchord judging score table (right triad vs each failure mode):');
  console.table(rows);
  assert.ok(true);
});
