import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeafWindow } from '../../src/audio/deaf-window.js';

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('not deaf before any sound has played', () => {
  const clock = fakeClock();
  const w = createDeafWindow({ now: clock.now });
  assert.equal(w.isDeaf(), false);
});

test('deaf during the sound', () => {
  const clock = fakeClock();
  const w = createDeafWindow({ now: clock.now });
  w.open(500);
  clock.advance(100);
  assert.equal(w.isDeaf(), true, 'still inside the 500ms sound');
});

test('deaf through the default tail after the sound ends', () => {
  const clock = fakeClock();
  const w = createDeafWindow({ now: clock.now });
  w.open(500);
  clock.advance(500); // sound just ended
  assert.equal(w.isDeaf(), true, 'default 250ms tail has not elapsed yet');
  clock.advance(200); // 700ms total, still inside the 250ms tail
  assert.equal(w.isDeaf(), true);
});

test('hearing again once the sound and its tail have fully elapsed', () => {
  const clock = fakeClock();
  const w = createDeafWindow({ now: clock.now });
  w.open(500);
  clock.advance(751); // 500ms sound + 250ms default tail + 1ms
  assert.equal(w.isDeaf(), false);
});

test('a custom tail is honoured', () => {
  const clock = fakeClock();
  const w = createDeafWindow({ now: clock.now });
  w.open(100, 1000);
  clock.advance(1099);
  assert.equal(w.isDeaf(), true, 'still inside the 1000ms custom tail');
  clock.advance(2);
  assert.equal(w.isDeaf(), false);
});

test('overlapping opens extend the window, never shorten it', () => {
  const clock = fakeClock();
  const w = createDeafWindow({ now: clock.now });
  w.open(1000); // deaf until t=1250
  clock.advance(200);
  w.open(100); // would end at 200+100+250=550, well before 1250 — must NOT shorten
  assert.equal(w.until(), 1250, 'a shorter overlapping open must not pull the window in');

  clock.advance(100); // t=300
  w.open(2000); // ends at 300+2000+250=2550 — this DOES extend it
  assert.equal(w.until(), 2550, 'a longer overlapping open extends the window');
});

test('a fresh open after the window has fully closed starts a new window from now', () => {
  const clock = fakeClock();
  const w = createDeafWindow({ now: clock.now });
  w.open(100); // deaf until t=350
  clock.advance(1000); // t=1000, long past closed
  assert.equal(w.isDeaf(), false);
  w.open(50);
  assert.equal(w.until(), 1000 + 50 + 250);
  assert.equal(w.isDeaf(), true);
});

test('now defaults to performance.now when not injected', () => {
  const w = createDeafWindow();
  assert.equal(w.isDeaf(), false);
  w.open(50);
  assert.equal(w.isDeaf(), true);
});
