// WAV loops and the observation recorder for tests/release/acceptance-live-capture*.test.mjs.
// Chromium loops a fake-audio file, so each file is one 8 s loop: leading silence (the app's
// first room measurement and its input diagnosis both hear it), then the event, then the
// tail. Built on pluck-wav.mjs, which is not edited: pluck() only appends trailing silence,
// so the lead-in is prepended here.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluck, writePluckWav } from '../../helpers/pluck-wav.mjs';

export const SAMPLE_RATE = 48000;
export const LOOP_SECONDS = 8;
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// A loop of `LOOP_SECONDS`. `plucks`: [{ at (seconds into the loop), midis: [..] (summed at
// 1/length each, so a two-note mix is two plucks at 0.5), gain, decay, noiseFloorRms }].
// Every pluck rings until the end of the loop or the next pluck's start.
export function buildLoop(plucks, { noiseFloorRms = 0 } = {}) {
  const total = Math.round(LOOP_SECONDS * SAMPLE_RATE);
  const out = new Float32Array(total);
  if (noiseFloorRms > 0) out.set(pluck(midiHz(60), SAMPLE_RATE, LOOP_SECONDS, { gain: 0, noiseFloorRms }).subarray(0, total));
  plucks.forEach((p, k) => {
    const start = Math.round(p.at * SAMPLE_RATE);
    const end = k + 1 < plucks.length ? Math.round(plucks[k + 1].at * SAMPLE_RATE) : total;
    const share = 1 / p.midis.length;
    p.midis.forEach((m, j) => {
      const note = pluck(midiHz(m), SAMPLE_RATE, (end - start) / SAMPLE_RATE, { gain: (p.gain ?? 1) * share, decay: p.decay ?? 0.996, seed: 1 + j });
      for (let i = 0; i < note.length && start + i < end; i++) out[start + i] += note[i];
    });
  });
  return out;
}

// Writes the loop to a fresh temp dir and returns the path (the value for launchPage's fakeAudioFile).
export function writeLoopWav(name, plucks, opts) {
  return writePluckWav(join(mkdtempSync(join(tmpdir(), 'band-coach-live-')), `${name}.wav`), buildLoop(plucks, opts), SAMPLE_RATE);
}

// Observation only: one MutationObserver on the two lines a learner reads, installed before the
// page exists and attached at DOMContentLoaded. A record is { el, text, cls, t (ms) } per change;
// a repeated identical say() replaces the text node, so it records again.
export const FEEDBACK_RECORDER = `
  (function () {
    window.__bcLines = [];
    function attach() {
      ['feedback', 'coach'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        new MutationObserver(function () {
          window.__bcLines.push({ el: id, text: el.textContent, cls: el.className, t: performance.now() });
        }).observe(el, { childList: true, characterData: true, subtree: true });
      });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach); else attach();
  })();
`;
