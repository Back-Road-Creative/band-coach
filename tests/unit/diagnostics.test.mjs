import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoticeGate, NOTICE_GAP_MS, isBenignError, buildDiagnostics } from '../../src/core/diagnostics.js';

test('the notice gate lets the first notice through, then holds the rest for the gap', () => {
  const gate = createNoticeGate(1000);
  assert.equal(gate.allow(5000), true, 'first notice shows');
  assert.equal(gate.allow(5001), false, 'a second one a moment later is held');
  assert.equal(gate.allow(5999), false, 'still inside the gap');
  assert.equal(gate.allow(6000), true, 'allowed again once the gap has passed');
  assert.equal(gate.allow(6500), false, 'and the gap restarts from that notice');
});

test('a clock that goes backwards never locks the notice out for good', () => {
  const gate = createNoticeGate(1000);
  assert.equal(gate.allow(10000), true);
  assert.equal(gate.allow(2000), true, 'time went backwards: show it rather than stay silent');
});

test('the default gap is long enough that a runaway fault cannot flood the screen', () => {
  assert.ok(NOTICE_GAP_MS >= 10000);
});

test('ResizeObserver loop noise is benign; a real error is not', () => {
  assert.equal(isBenignError('ResizeObserver loop completed with undelivered notifications.'), true);
  assert.equal(isBenignError('ResizeObserver loop limit exceeded'), true);
  assert.equal(isBenignError('x is not a function'), false);
  assert.equal(isBenignError(''), false);
});

test('buildDiagnostics lists version, browser, error messages and capability states', () => {
  const text = buildDiagnostics({
    version: '1.2.3',
    userAgent: 'TestAgent/9',
    errors: [{ message: 'boom one', where: 'window', time: 1 }, { message: 'boom two', where: 'listen', time: 2 }],
    capabilities: { microphone: true, midi: false },
  });
  assert.match(text, /Band Coach 1\.2\.3/);
  assert.match(text, /TestAgent\/9/);
  assert.match(text, /boom one/);
  assert.match(text, /boom two/);
  assert.match(text, /microphone: available/);
  assert.match(text, /midi: missing/);
});

test('buildDiagnostics says plainly when nothing has gone wrong', () => {
  const text = buildDiagnostics({ version: '1', userAgent: 'x', errors: [], capabilities: {} });
  assert.match(text, /No errors/i);
});

test('buildDiagnostics reads messages only: stacks and extra fields never reach the text', () => {
  const text = buildDiagnostics({
    version: '1', userAgent: 'x', capabilities: {},
    errors: [{ message: 'plain', where: 'window', time: 1, stack: 'STACK-LINE at app.js', deviceId: 'DEV-SECRET', title: 'My Secret Song' }],
  });
  assert.doesNotMatch(text, /STACK-LINE|DEV-SECRET|My Secret Song/);
});

test('buildDiagnostics blanks file paths and links inside an error message and caps its length', () => {
  const text = buildDiagnostics({
    version: '1', userAgent: 'x', capabilities: {},
    errors: [
      { message: 'failed at file:///home/jane/Music/my-song.mid now', where: 'a', time: 1 },
      { message: 'could not read C:\\Users\\jane\\Desktop\\song.mp3 ok', where: 'b', time: 2 },
      { message: 'long ' + 'z'.repeat(1000), where: 'c', time: 3 },
    ],
  });
  assert.doesNotMatch(text, /jane|my-song|song\.mp3/);
  assert.ok(text.length < 1500, 'a 1000-character message is shortened (got ' + text.length + ')');
});
