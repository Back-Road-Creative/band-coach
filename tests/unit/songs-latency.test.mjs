import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songLatencyMs, latencyAdjusted } from '../../src/ui/songs/session-helpers.js';

test('songLatencyMs reads the stored offset, limited to 0..300 ms', () => {
  assert.equal(songLatencyMs({ latencyMs: 200 }), 200);
  assert.equal(songLatencyMs({}), 0);
  assert.equal(songLatencyMs(null), 0);
  assert.equal(songLatencyMs({ latencyMs: 'x' }), 0);
  assert.equal(songLatencyMs({ latencyMs: -30 }), 0);
  assert.equal(songLatencyMs({ latencyMs: 900 }), 300);
});

test('latencyAdjusted shifts events earlier and keeps their other fields', () => {
  const evts = [{ midi: 60, atSec: 0.25, source: 'midi' }];
  assert.equal(latencyAdjusted(evts, 0), evts);
  const out = latencyAdjusted(evts, 200);
  assert.ok(Math.abs(out[0].atSec - 0.05) < 1e-9);
  assert.equal(out[0].source, 'midi');
  assert.equal(evts[0].atSec, 0.25);
});
