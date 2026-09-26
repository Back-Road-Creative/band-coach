// src/ui/fingerings.js's diagramKindFor: the pure routing decision that
// picks which DOM diagram builder a computeHow() result gets, kept separate
// from the DOM builders themselves (which need a real `document`, browser-
// tested only in tests/characterization/w-fingerings.test.mjs). Regression
// coverage for the bug the audit found: every keyed-woodwind instrument
// (flute, clarinet, oboe, both saxes) fell through diagramFor's old
// catch-all straight to the VOICE renderer ("Sing this pitch — no
// fingering needed."), because there was no explicit 'keyed-woodwind'
// branch and the default case assumed anything unmatched was voice.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diagramKindFor } from '../../src/ui/fingerings.js';
import { howKindFor, computeHow } from '../../src/ui/fingerings/how.js';
import flute from '../../src/instruments/flute.js';
import clarinetBb from '../../src/instruments/clarinet-bb.js';
import oboe from '../../src/instruments/oboe.js';
import saxAlto from '../../src/instruments/sax-alto-eb.js';
import saxTenor from '../../src/instruments/sax-tenor-bb.js';
import voice from '../../src/instruments/voice.js';
import gtr from '../../src/instruments/gtr.js';

test('diagramKindFor: every keyed-woodwind instrument routes to keyed-woodwind, never voice', () => {
  for (const rec of [flute, clarinetBb, oboe, saxAlto, saxTenor]) {
    const how = computeHow(rec, rec.range.low);
    assert.equal(howKindFor(rec), 'keyed-woodwind');
    assert.equal(diagramKindFor(how), 'keyed-woodwind');
    assert.notEqual(diagramKindFor(how), 'voice');
  }
});

test('diagramKindFor: the voice family still routes to voice', () => {
  const how = computeHow(voice, voice.range.low);
  assert.equal(diagramKindFor(how), 'voice');
});

test('diagramKindFor: a recognised kind (fretboard) passes through unchanged', () => {
  const how = computeHow(gtr, gtr.range.low);
  assert.equal(diagramKindFor(how), 'fretboard');
});

test('diagramKindFor: a missing or unrecognised how, or an unknown kind, is "unavailable" — never voice, never a throw', () => {
  assert.equal(diagramKindFor(null), 'unavailable');
  assert.equal(diagramKindFor(undefined), 'unavailable');
  assert.equal(diagramKindFor({ kind: 'some-future-family' }), 'unavailable');
  assert.notEqual(diagramKindFor({ kind: 'some-future-family' }), 'voice');
});
