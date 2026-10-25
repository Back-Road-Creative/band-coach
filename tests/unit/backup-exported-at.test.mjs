// A restore asks before replacing progress; the question names the day the
// backup was made, so importProgress hands back exportedAt (ms) when the file
// carries a real date, and null when it does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportProgress, importProgress } from '../../src/core/progress-file.js';

const db = { v: 1, prefs: {}, mods: {}, sessions: [], events: [] };

test('a backup made by exportProgress carries its date through import', () => {
  const when = Date.UTC(2026, 2, 14, 12, 0, 0);
  const r = importProgress(JSON.stringify(exportProgress(db, { now: when })));
  assert.equal(r.ok, true);
  assert.equal(r.exportedAt, when);
});

test('a backup with no date, or a date that is not one, imports with exportedAt null', () => {
  const env = exportProgress(db, { now: 0 });
  for (const exportedAt of [undefined, 'yesterday', 42, null, '']) {
    const r = importProgress(JSON.stringify({ ...env, exportedAt }));
    assert.equal(r.ok, true, String(exportedAt));
    assert.equal(r.exportedAt, null, String(exportedAt));
  }
});
