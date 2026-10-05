// The "sound stopped" pause card (audio-interrupt-recover) is shown on the
// shared Pause/Resume button, whose label takeBreak() writes in English only.
// A Spanish string that quotes that literal label goes stale the day the
// button is localized, so the es text must describe the button without it.
// (en/es key parity for these ids is already carried by i18n-locales.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { es } from '../../src/core/i18n.js';

test('the Spanish stopped-sound text does not quote the English button label', () => {
  assert.equal(typeof es['audio.stoppedWhy'], 'string', 'es is missing audio.stoppedWhy');
  assert.doesNotMatch(es['audio.stoppedWhy'], /\bResume\b/, 'the es text must not name the English-only Resume label');
});
