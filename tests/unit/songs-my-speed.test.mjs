import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSpeedLedger, speedFor, withSpeed, recordClean, bestForSong, atSpeed } from '../../src/ui/songs/my-speed.js';

test('sanitizeSpeedLedger keeps only safe keys and in-range speeds', () => {
  const raw = {
    'hcb|melody': { speed: 70, best: 65 },
    'bad key|melody': { speed: 70 },
    ['__proto__']: { speed: 70 },
    'hcb|lead': { speed: 30, best: 200 },
    'hcb|odd': { speed: 72 },
    'hcb|arr': [],
  };
  assert.deepEqual(sanitizeSpeedLedger(raw), { 'hcb|melody': { speed: 70, best: 65 }, 'hcb|odd': { speed: 70, best: null } });
  assert.deepEqual(sanitizeSpeedLedger(null), {});
  assert.deepEqual(sanitizeSpeedLedger([1]), {});
});

test('speedFor defaults to full speed; withSpeed ignores out-of-range values', () => {
  assert.equal(speedFor({}, 'hcb|melody'), 100);
  const l = withSpeed({}, 'hcb|melody', 60);
  assert.equal(speedFor(l, 'hcb|melody'), 60);
  assert.equal(withSpeed(l, 'hcb|melody', 40), l);
});

test('recordClean stores only a better speed and says what it beat', () => {
  const first = recordClean({}, 'hcb|melody', 70);
  assert.deepEqual(first.record, { speed: 70, prev: null });
  assert.equal(recordClean(first.ledger, 'hcb|melody', 70).record, null);
  assert.equal(recordClean(first.ledger, 'hcb|melody', 60).record, null);
  const up = recordClean(first.ledger, 'hcb|melody', 80);
  assert.deepEqual(up.record, { speed: 80, prev: 70 });
  assert.equal(bestForSong({ ...up.ledger, 'hcb|bass': { speed: 100, best: 90 }, 'other|melody': { speed: 100, best: 100 } }, 'hcb'), 90);
  assert.equal(bestForSong({}, 'hcb'), null);
});

test('atSpeed scales timed steps and leaves untimed ones alone', () => {
  assert.equal(atSpeed(100, 70), 70);
  assert.equal(atSpeed(75, 70), 53);
  assert.equal(atSpeed(0, 70), 0);
  assert.equal(atSpeed(100, 100), 100);
});
