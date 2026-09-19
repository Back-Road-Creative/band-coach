// CURRENT BEHAVIOUR: __coach.yin(buf, sr, fmin, fmax) (band-coach.html:197) is
// a pure pitch detector. Feeding it synthetic sine buffers must return a
// frequency within 1% of the true pitch, and silence must return freq: 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launchPage } from '../helpers/browser.mjs';

const htmlPath = fileURLToPath(new URL('../../band-coach.html', import.meta.url));
const SR = 48000;
const N = 4096;

test('yin recovers known frequencies within 1% and reports silence as freq 0', async (t) => {
  const page = await launchPage(htmlPath);
  t.after(() => page.close());

  for (const f of [82.41, 110, 440]) {
    const result = await page.evaluate(`
      (function () {
        const n = ${N}, sr = ${SR}, f = ${f};
        const buf = new Float32Array(n);
        for (let i = 0; i < n; i++) buf[i] = 0.5 * Math.sin(2 * Math.PI * f * i / sr);
        return window.__coach.yin(buf, sr, 30, 2000);
      })()
    `);
    const err = Math.abs(result.freq - f) / f;
    assert.ok(err < 0.01, `yin(${f}) returned ${result.freq}, error ${(err * 100).toFixed(2)}%`);
  }

  const silence = await page.evaluate(`
    (function () {
      const buf = new Float32Array(${N});
      return window.__coach.yin(buf, ${SR}, 30, 2000);
    })()
  `);
  assert.equal(silence.freq, 0, 'silence must report freq: 0');
});
